import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {blankEntitlement,createService,GENERATION_OUTBOX_PK} from '../server/service.mjs';
import {change,MemoryStore} from '../server/store.mjs';

const alice={sub:'alice',email:'alice@example.test'},bob={sub:'bob',email:'bob@example.test'};
const createdAt='2026-10-19T00:00:00.000Z';
const job={id:'job-one',source:'user-provided',title:'Software Engineer',company:'Synthetic Employer',location:'Sydney, Australia',description:'Build and operate TypeScript services for Australian customers.',url:'https://example.test/jobs/one'};
const profile={email:alice.email,confirmed:true,resumeText:'Experienced TypeScript engineer.',consentAt:createdAt,roleFamilies:['software'],location:'Sydney, Australia'};
const letter='Dear hiring team, I am interested in the Software Engineer role. My resume shows relevant TypeScript delivery experience for production services. I would welcome the opportunity to discuss this experience with your team. Kind regards, Alice.';

function starterEntitlement(){
  const entitlement=blankEntitlement();
  entitlement.starter={key:'starter-purchase',purchaseId:'pi_starter',status:'active',everPaid:true,used:0,reserved:0};
  return entitlement;
}
function application(id='job-one'){return {id,job:{...job,id},status:'interested',notes:'',createdAt,updatedAt:createdAt};}
async function fixture(){
  const store=new MemoryStore(),queued=[];
  await store.transact([
    change('USER#alice','PROFILE',null,profile),
    change('USER#alice','ENTITLEMENT',null,starterEntitlement()),
    change('USER#alice','APP#job-one',null,application()),
    change('USER#bob','PROFILE',null,{...profile,email:bob.email}),
    change('USER#bob','APP#job-one',null,application()),
  ]);
  const service=createService({
    store,
    feed:{async status(){return {status:'not-configured'};},async jobs(){return []; }},
    provider:{async available(){return true;},async generate(){return letter;}},
    dispatch:async payload=>queued.push(payload),
  });
  return {store,service,queued};
}

test('concurrent tabs share one active reservation and applications expose only the tenant pending summary',async()=>{
  const {store,service,queued}=await fixture();
  const results=await Promise.all(Array.from({length:8},()=>service.generate(alice,job.id,randomUUID())));
  assert.equal(new Set(results.map(result=>result.generation.id)).size,1);
  assert.ok(results.every(result=>result.generation.status==='pending'));
  const generationId=results[0].generation.id;
  assert.equal((await store.list('USER#alice','GEN#')).length,1);
  assert.equal((await store.get('USER#alice','ENTITLEMENT')).value.starter.reserved,1);
  assert.equal((await store.get('USER#alice','APP#job-one')).value.pendingGenerationId,generationId);
  assert.equal(queued.filter(item=>item.kind==='generate').length,1);

  const page=await service.applications(alice),pending=page.applications[0].pendingGeneration;
  assert.deepEqual(pending,{id:generationId,appId:'job-one',status:'pending',createdAt:results[0].generation.createdAt});
  assert.equal('pendingGenerationId'in page.applications[0],false);
  assert.equal('bucket'in pending,false);
  assert.equal((await service.applications(bob)).applications[0].pendingGeneration,undefined);

  await service.runGeneration(alice.sub,generationId);
  const completed=(await service.applications(alice)).applications[0];
  assert.equal(completed.pendingGeneration,undefined);
  assert.equal(completed.letters.length,1);
  assert.equal((await store.get('USER#alice','APP#job-one')).value.pendingGenerationId,undefined);
  assert.deepEqual((await store.get('USER#alice','ENTITLEMENT')).value.starter,{key:'starter-purchase',purchaseId:'pi_starter',status:'active',everPaid:true,used:1,reserved:0});
});

test('a deployed pending generation without an application pointer is recovered and blocks a second reservation',async()=>{
  const {store,service}=await fixture(),generationId='a'.repeat(64),tenantHash=createHash('sha256').update(alice.sub).digest('hex');
  const entitlementRow=await store.get('USER#alice','ENTITLEMENT'),entitlement=entitlementRow.value;
  entitlement.starter.reserved=1;
  await store.transact([
    change('USER#alice','ENTITLEMENT',entitlementRow,entitlement),
    change('USER#alice',`GEN#${generationId}`,null,{id:generationId,appId:'job-one',status:'pending',createdAt,bucket:'starter',periodKey:'starter-purchase',profileSnapshot:profile,jobSnapshot:job,dispatchedAt:createdAt}),
    change(GENERATION_OUTBOX_PK,`${tenantHash}#${generationId}`,null,{version:1,userSub:alice.sub,tenantHash,generationId,createdAt}),
  ]);

  const restored=(await service.applications(alice)).applications[0].pendingGeneration;
  assert.equal(restored.id,generationId);
  const retried=await service.generate(alice,job.id,randomUUID());
  assert.equal(retried.generation.id,generationId);
  assert.equal((await store.list('USER#alice','GEN#')).length,1);
  assert.equal((await store.get('USER#alice','ENTITLEMENT')).value.starter.reserved,1);
  assert.equal((await store.get('USER#alice','APP#job-one')).value.pendingGenerationId,generationId);
});

test('analytics retains original generation context through async persistence, fail-open retry, and public export',async()=>{
 const {createAnalytics}=await import('../server/analytics.mjs');const {store}=await fixture(),analytics=createAnalytics({store,secret:'synthetic-key'}),a=await analytics.session({consent:true,visitor:randomUUID(),session:randomUUID()}),b=await analytics.session({consent:true,visitor:randomUUID(),session:randomUUID()}),ca=await analytics.context(a.token),cb=await analytics.context(b.token);
 let outage=true;const tracking={...analytics,outcome:async(...args)=>{if(outage)throw Error('synthetic analytics outage');return analytics.outcome(...args);}};
 const service=createService({store,analytics:tracking,feed:{status:async()=>({}),jobs:async()=>[]},provider:{available:async()=>true,generate:async()=>letter},dispatch:async()=>{}});
 const pending=await service.generate({...alice,analyticsContext:ca},job.id,randomUUID());assert.equal(pending.generation.analyticsContext,undefined);
 const reused=await service.generate({...alice,analyticsContext:cb},job.id,randomUUID());assert.equal(reused.generation.id,pending.generation.id);
 const oldError=console.error;console.error=()=>{};try{await service.runGeneration(alice.sub,pending.generation.id);}finally{console.error=oldError;}
 const persisted=await store.get('USER#alice',`GEN#${pending.generation.id}`);assert.equal(persisted.value.status,'succeeded');assert.equal(persisted.value.analyticsPending,true);assert.deepEqual(persisted.value.analyticsContext,ca);
 outage=false;const result=await service.generationResult(alice,pending.generation.id);assert.equal(result.generation.status,'succeeded');assert.equal(result.generation.analyticsContext,undefined);assert.equal(result.generation.analyticsPending,undefined);
 const exported=await service.exportAccount(alice);assert.ok(!JSON.stringify(exported).includes('analyticsContext'));assert.ok(!JSON.stringify(exported).includes('ANALYTICS#sessions'));
 const original=await store.get(ca.pk,ca.sk),other=await store.get(cb.pk,cb.sk);assert.ok(original.value.stages.letter_succeeded);assert.equal(other.value.stages.letter_succeeded,undefined);assert.equal((await store.get('USER#alice','ENTITLEMENT')).value.starter.used,1);
});
