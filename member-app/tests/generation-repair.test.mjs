import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {MemoryStore,change} from '../server/store.mjs';
import {blankEntitlement,createService,GENERATION_OUTBOX_PK} from '../server/service.mjs';
import {processGenerationBatch,processGenerationRepair} from '../server/handler.mjs';
import {normalizeJob} from '../server/matching.mjs';

const user={sub:'alice',email:'alice@example.test'};
const job=normalizeJob({id:'repair-job',title:'Software Engineer',company:'Example',country:'AU',roleFamily:'software',location:'Sydney',url:'https://example.test/jobs/repair',skills:['TypeScript','AWS'],description:'Build reliable Australian technology services with TypeScript and AWS. Document production systems and maintain secure software delivery.',requirements:{citizenship:'unknown',sponsorship:'unknown',clearance:'unknown'}},'test');
const profile={name:'Alice',email:user.email,resumeText:'Built TypeScript services on AWS and documented production delivery.',skills:['TypeScript','AWS'],roleFamilies:['software'],yearsExperience:5,situation:'actively-looking',location:'Sydney',workRights:'visa',needsSponsorship:'unknown',clearance:'unknown',preferences:{},confirmed:true,consentAt:new Date().toISOString(),termsAcceptedAt:new Date().toISOString()};
const letter='Dear hiring team, I am interested in the Software Engineer role. My TypeScript and AWS work supports the stated requirements, including documented production delivery. I would welcome a discussion about this role. Kind regards, Alice.';
const oldIso=()=>new Date(Date.now()-10*60*1000).toISOString();
const outboxKey=(sub,id)=>`${createHash('sha256').update(sub).digest('hex')}#${id}`;
const starter=()=>{const value=blankEntitlement();value.starter={key:'starter-period',purchaseId:'pi_starter',status:'active',everPaid:true,used:0,reserved:0};return value;};
const record=(messageId,payload)=>({eventSource:'aws:sqs',messageId,body:JSON.stringify(payload)});

async function fixture({dispatch,provider}={}){
  const store=new MemoryStore();
  await store.transact([change('USER#alice','PROFILE',null,profile),change('USER#alice','ENTITLEMENT',null,starter())]);
  let providerCalls=0;
  const selectedProvider=provider??{available:async()=>true,async generate(){providerCalls++;return letter;}};
  const wrappedProvider={available:selectedProvider.available,async generate(...args){if(provider)providerCalls++;return selectedProvider.generate(...args);}};
  const feed={async status(){return {status:'ready'};},async jobs(){return [job];}};
  const service=createService({store,feed,provider:wrappedProvider,dispatch});
  await service.decision(user,job.id,{decision:'interested'});
  return {store,service,providerCalls:()=>providerCalls};
}

test('scheduled repair recovers an abandoned dispatch without browser polling and cleans the outbox on success',async()=>{
  const queued=[];let dispatchCalls=0;
  const f=await fixture({dispatch:async payload=>{if(payload.kind==='generate'&&++dispatchCalls===1)throw Error('response lost');queued.push(payload);}});
  const pending=await f.service.generate(user,job.id,randomUUID());
  assert.equal(pending.generation.pendingReason,'DISPATCH_OUTCOME_UNKNOWN');
  assert.equal((await f.store.list(GENERATION_OUTBOX_PK)).length,1);
  const row=await f.store.get('USER#alice',`GEN#${pending.generation.id}`);
  await f.store.transact([change(row.pk,row.sk,row,{...row.value,dispatchLeaseUntil:oldIso()})]);
  const repaired=await processGenerationRepair(f.service,{log:()=>{}});
  assert.equal(repaired.requeued,1);
  assert.equal(dispatchCalls,2);
  assert.equal(queued.length,1);
  assert.deepEqual(await processGenerationBatch(f.service,{Records:[record('recovered',queued[0])]}),{batchItemFailures:[]});
  assert.equal((await f.service.generationResult(user,pending.generation.id)).generation.status,'succeeded');
  assert.equal(f.providerCalls(),1);
  assert.deepEqual(await f.store.list(GENERATION_OUTBOX_PK),[]);
});

test('scheduled repair backfills and recovers a pre-deployment pending generation without browser activity',async()=>{
  const queued=[];const f=await fixture({dispatch:async payload=>queued.push(payload)});
  const pending=await f.service.generate(user,job.id,randomUUID());
  queued.length=0;
  const generation=await f.store.get('USER#alice',`GEN#${pending.generation.id}`),registry=(await f.store.list(GENERATION_OUTBOX_PK))[0];
  await f.store.transact([
    change(generation.pk,generation.sk,generation,{...generation.value,dispatchedAt:oldIso()}),
    {pk:registry.pk,sk:registry.sk,expected:registry.revision,remove:true},
  ]);
  const repaired=await processGenerationRepair(f.service,{log:()=>{}});
  assert.equal(repaired.backfill.enrolled,1);
  assert.equal(repaired.requeued,1);
  assert.equal(queued.length,1);
  assert.deepEqual(await processGenerationBatch(f.service,{Records:[record('legacy-recovered',queued[0])]}),{batchItemFailures:[]});
  assert.equal((await f.service.generationResult(user,pending.generation.id)).generation.status,'succeeded');
  assert.equal(f.providerCalls(),1);
  assert.deepEqual(await f.store.list(GENERATION_OUTBOX_PK),[]);
});

test('generation creation and concurrent repair are idempotent and duplicate queue messages call the provider once',async()=>{
  const queued=[];const key=randomUUID(),f=await fixture({dispatch:async payload=>queued.push(payload)});
  const first=await f.service.generate(user,job.id,key),replay=await f.service.generate(user,job.id,key);
  assert.equal(replay.generation.id,first.generation.id);
  assert.equal((await f.store.list(GENERATION_OUTBOX_PK)).length,1);
  assert.equal(queued.length,1);
  const row=await f.store.get('USER#alice',`GEN#${first.generation.id}`);
  await f.store.transact([change(row.pk,row.sk,row,{...row.value,dispatchedAt:oldIso()})]);
  const repairs=await Promise.all([f.service.repairPendingGenerations(),f.service.repairPendingGenerations()]);
  assert.equal(repairs.reduce((total,result)=>total+result.requeued,0),1);
  assert.equal(queued.filter(payload=>payload.kind==='generate').length,2);
  const messages=queued.filter(payload=>payload.kind==='generate').map((payload,index)=>record(`duplicate-${index}`,payload));
  assert.deepEqual(await processGenerationBatch(f.service,{Records:messages}),{batchItemFailures:[]});
  assert.equal(f.providerCalls(),1);
  assert.equal((await f.service.generationResult(user,first.generation.id)).generation.status,'succeeded');
  assert.deepEqual(await f.store.list(GENERATION_OUTBOX_PK),[]);
});

test('generation repair paginates the durable outbox and sends continuation work to the generation queue',async()=>{
  const store=new MemoryStore(),queued=[];
  for(let first=0;first<121;first+=20){
    const changes=[];
    for(let index=first;index<Math.min(121,first+20);index++){
      const sub=`tenant-${String(index).padStart(4,'0')}`,id=createHash('sha256').update(`generation-${index}`).digest('hex'),createdAt=oldIso();
      changes.push(change(`USER#${sub}`,`GEN#${id}`,null,{id,status:'pending',createdAt,dispatchedAt:oldIso()}));
      changes.push(change(GENERATION_OUTBOX_PK,outboxKey(sub,id),null,{version:1,userSub:sub,tenantHash:createHash('sha256').update(sub).digest('hex'),generationId:id,createdAt}));
    }
    await store.transact(changes);
  }
  const service=createService({store,dispatch:async payload=>queued.push(payload)});
  const first=await service.repairPendingGenerations();
  assert.deepEqual({examined:first.examined,requeued:first.requeued,continued:first.continued},{examined:50,requeued:50,continued:true});
  for(let page=1;page<3;page++){
    const fanout=queued.filter(payload=>payload.kind==='generation-repair-fanout').at(-1);
    assert.deepEqual(await processGenerationBatch(service,{Records:[record(`repair-page-${page}`,fanout)]}),{batchItemFailures:[]});
  }
  const generationMessages=queued.filter(payload=>payload.kind==='generate');
  assert.equal(generationMessages.length,121);
  assert.equal(new Set(generationMessages.map(payload=>`${payload.userSub}:${payload.generationId}`)).size,121);
  assert.equal(queued.filter(payload=>payload.kind==='generation-repair-fanout').length,2);
});

test('definitive completion and stale terminal records remove durable outbox entries',async()=>{
  const queued=[];const f=await fixture({dispatch:async payload=>queued.push(payload),provider:{available:async()=>true,async generate(){throw Error('definitive provider failure');}}});
  const pending=await f.service.generate(user,job.id,randomUUID());
  assert.equal((await f.store.list(GENERATION_OUTBOX_PK)).length,1);
  assert.deepEqual(await processGenerationBatch(f.service,{Records:[record('definitive',queued[0])]}),{batchItemFailures:[]});
  const finished=await f.service.generationResult(user,pending.generation.id);
  assert.equal(finished.generation.status,'failed');
  assert.equal(finished.billing.reserved,0);
  assert.deepEqual(await f.store.list(GENERATION_OUTBOX_PK),[]);

  const terminalId='f'.repeat(64),terminalKey=outboxKey(user.sub,terminalId),createdAt=oldIso();
  await f.store.transact([
    change('USER#alice',`GEN#${terminalId}`,null,{id:terminalId,status:'failed',createdAt,completedAt:createdAt}),
    change(GENERATION_OUTBOX_PK,terminalKey,null,{version:1,userSub:user.sub,tenantHash:createHash('sha256').update(user.sub).digest('hex'),generationId:terminalId,createdAt}),
  ]);
  const cleaned=await f.service.repairPendingGenerations();
  assert.equal(cleaned.cleaned,1);
  assert.equal(await f.store.get(GENERATION_OUTBOX_PK,terminalKey),null);
});

test('provider-started unknown work is never dispatched or generated again and emits a reconciliation event',async()=>{
  const queued=[];const f=await fixture({dispatch:async payload=>queued.push(payload),provider:{available:async()=>true,async generate(){throw Object.assign(Error('provider timeout'),{uncertain:true});}}});
  const pending=await f.service.generate(user,job.id,randomUUID());
  const previous=console.error;console.error=()=>{};
  try{assert.deepEqual(await processGenerationBatch(f.service,{Records:[record('provider-unknown',queued[0])]}),{batchItemFailures:[{itemIdentifier:'provider-unknown'}]});}
  finally{console.error=previous;}
  const row=await f.store.get('USER#alice',`GEN#${pending.generation.id}`);
  await f.store.transact([change(row.pk,row.sk,row,{...row.value,leaseExpiresAt:oldIso()})]);
  const logs=[],result=await processGenerationRepair(f.service,{log:value=>logs.push(JSON.parse(value))});
  assert.equal(result.requeued,0);
  assert.equal(result.reconciliationRequired.length,1);
  assert.equal(logs[0].event,'generation_reconciliation_required');
  assert.equal(logs[0].source,'scheduled-repair');
  assert.equal(logs[0].userSub,undefined);
  assert.equal(queued.filter(payload=>payload.kind==='generate').length,1);
  await assert.rejects(()=>f.service.runGeneration(user.sub,pending.generation.id),error=>error.code==='PROVIDER_OUTCOME_UNKNOWN');
  assert.equal(f.providerCalls(),1);
  assert.equal((await f.store.list(GENERATION_OUTBOX_PK)).length,1);
});

test('dispatch repair failures are alarmable without logging a tenant subject',async()=>{
  let dispatchCalls=0;const f=await fixture({dispatch:async()=>{dispatchCalls++;throw Error('queue unavailable');}});
  const pending=await f.service.generate(user,job.id,randomUUID());
  const row=await f.store.get('USER#alice',`GEN#${pending.generation.id}`);
  await f.store.transact([change(row.pk,row.sk,row,{...row.value,dispatchLeaseUntil:oldIso()})]);
  const logs=[],result=await processGenerationRepair(f.service,{log:value=>logs.push(JSON.parse(value))});
  assert.equal(result.failures.length,1);
  assert.equal(logs[0].event,'generation_dispatch_repair_failed');
  assert.equal(logs[0].code,'DISPATCH_OUTCOME_UNKNOWN');
  assert.equal(logs[0].userSub,undefined);
  assert.match(logs[0].tenantHash,/^[a-f0-9]{64}$/);
  assert.equal(dispatchCalls,2);
});

test('a malformed cross-tenant registry row is not followed or dispatched',async()=>{
  const store=new MemoryStore(),queued=[],id='a'.repeat(64),aliceHash=createHash('sha256').update('alice').digest('hex'),bobKey=outboxKey('bob',id);
  await store.transact([
    change(GENERATION_OUTBOX_PK,bobKey,null,{version:1,userSub:'alice',tenantHash:aliceHash,generationId:id,createdAt:oldIso()}),
  ]);
  const service=createService({store,dispatch:async payload=>queued.push(payload)}),logs=[];
  const result=await processGenerationRepair(service,{log:value=>logs.push(JSON.parse(value))});
  assert.equal(result.failures[0].code,'INVALID_OUTBOX_RECORD');
  assert.equal(queued.length,0);
  assert.ok(await store.get(GENERATION_OUTBOX_PK,bobKey));
  assert.equal(logs[0].event,'generation_dispatch_repair_failed');
  assert.equal(logs[0].userSub,undefined);
});

test('an opaque repair cursor paginates beyond a maximum-length malformed outbox key',async()=>{
  const store=new MemoryStore(),queued=[],sub='later-7',id='b'.repeat(64),createdAt=oldIso(),changes=[];
  for(let index=0;index<49;index++)changes.push(change(GENERATION_OUTBOX_PK,`0${String(index).padStart(4,'0')}`,null,{invalid:true}));
  changes.push(change(GENERATION_OUTBOX_PK,'a'.repeat(1024),null,{invalid:true}));
  changes.push(change(`USER#${sub}`,`GEN#${id}`,null,{id,status:'pending',createdAt,dispatchedAt:oldIso()}));
  changes.push(change(GENERATION_OUTBOX_PK,outboxKey(sub,id),null,{version:1,userSub:sub,tenantHash:createHash('sha256').update(sub).digest('hex'),generationId:id,createdAt}));
  for(let index=0;index<changes.length;index+=20)await store.transact(changes.slice(index,index+20));
  const service=createService({store,dispatch:async payload=>queued.push(payload)});
  const first=await processGenerationRepair(service,{log:()=>{}});
  assert.equal(first.examined,50);
  assert.equal(first.continued,true);
  const fanout=queued.find(payload=>payload.kind==='generation-repair-fanout');
  assert.match(fanout.cursor,/^[A-Za-z0-9_-]+$/);
  assert.ok(fanout.cursor.length>512);
  assert.deepEqual(await processGenerationBatch(service,{Records:[record('long-cursor',fanout)]}),{batchItemFailures:[]});
  assert.ok(queued.some(payload=>payload.kind==='generate'&&payload.userSub===sub&&payload.generationId===id));
});
