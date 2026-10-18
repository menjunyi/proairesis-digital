import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,change} from '../server/store.mjs';
import {blankEntitlement,createService} from '../server/service.mjs';
import {processGenerationBatch} from '../server/handler.mjs';

const record=(messageId,payload)=>({eventSource:'aws:sqs',messageId,body:JSON.stringify(payload)});

async function registeredService(count=1){
  const store=new MemoryStore(),queued=[],reconciled=[];
  for(let first=0;first<count;first+=25){
    const changes=[];
    for(let index=first;index<Math.min(count,first+25);index++){
      const suffix=String(index).padStart(4,'0'),userSub=`user-${suffix}`,customerId=`cus_A${suffix}`;
      changes.push(change('BILLING#customers',customerId,null,{userSub}));
      changes.push(change(`USER#${userSub}`,'ENTITLEMENT',null,{...blankEntitlement(),customerId}));
    }
    await store.transact(changes);
  }
  const billing={async reconcile(userSub){reconciled.push(userSub);}};
  const service=createService({store,billing,dispatch:async payload=>queued.push(payload)});
  return {store,queued,reconciled,service};
}

test('daily billing reconciliation is tenant-bound and skips a deleted account',async()=>{
  const {store,reconciled,service}=await registeredService(2);
  assert.deepEqual(await service.reconcileBillingForCustomer('user-0000','cus_A0000'),{reconciled:true});
  assert.deepEqual(reconciled,['user-0000']);
  await assert.rejects(()=>service.reconcileBillingForCustomer('user-0000','cus_A0001'),/ownership mismatch/);
  const deletedSub='user-0001',hash=(await import('node:crypto')).createHash('sha256').update(deletedSub).digest('hex');
  await store.transact([change('ACCOUNT#deleted',hash,null,{deleted:true})]);
  assert.deepEqual(await service.reconcileBillingForCustomer(deletedSub,'cus_A0001'),{reconciled:false,skipped:true,reason:'ACCOUNT_DELETED'});
  assert.deepEqual(reconciled,['user-0000']);
});

test('daily billing fanout paginates all registered Stripe customers without a fixed ceiling',async()=>{
  const {queued,service}=await registeredService(121);
  assert.deepEqual(await service.queueBillingReconciliations(),{queued:50,continued:true});
  for(let page=1;page<3;page++){
    const fanout=queued.filter(message=>message.kind==='billing-fanout').at(-1);
    assert.deepEqual(await processGenerationBatch(service,{Records:[record(`fanout-${page}`,fanout)]}),{batchItemFailures:[]});
  }
  const jobs=queued.filter(message=>message.kind==='billing-reconcile');
  assert.equal(jobs.length,121);
  assert.equal(new Set(jobs.map(message=>`${message.customerId}:${message.userSub}`)).size,121);
  assert.equal(queued.filter(message=>message.kind==='billing-fanout').length,2);
});

test('billing reconciliation queue messages reject added fields and retry only failed records',async()=>{
  const calls=[];
  const worker={
    async reconcileBillingForCustomer(userSub,customerId){calls.push(['reconcile',userSub,customerId]);if(userSub==='retry')throw Error('temporary');},
    async queueBillingReconciliations({after}){calls.push(['fanout',after]);},
  };
  const records=[
    record('ok',{kind:'billing-reconcile',customerId:'cus_A1000',userSub:'alice'}),
    record('retry',{kind:'billing-reconcile',customerId:'cus_A1001',userSub:'retry'}),
    record('fanout',{kind:'billing-fanout',after:'cus_A1002'}),
    record('invalid',{kind:'billing-reconcile',customerId:'cus_A1003',userSub:'mallory',email:'mallory@example.test'}),
  ];
  const previous=console.error;console.error=()=>{};
  try{assert.deepEqual(await processGenerationBatch(worker,{Records:records}),{batchItemFailures:[{itemIdentifier:'retry'},{itemIdentifier:'invalid'}]});}
  finally{console.error=previous;}
  assert.deepEqual(calls,[['reconcile','alice','cus_A1000'],['reconcile','retry','cus_A1001'],['fanout','cus_A1002']]);
});
