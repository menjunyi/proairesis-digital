import test from 'node:test';
import assert from 'node:assert/strict';
import {createBilling} from '../server/adapters.mjs';
import {MemoryStore,change} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
const env={STRIPE_SECRET_KEY_PARAM:'test',STRIPE_WEBHOOK_SECRET_PARAM:'test',STRIPE_PRICE_ID:'price_monthly',STRIPE_STARTER_PRICE_ID:'price_starter',STRIPE_PORTAL_CONFIGURATION_ID:'bpc_test'};
const charge={id:'ch_test',customer:'cus_alice',created:1790000000,amount:100,currency:'aud',paid:true,captured:true,status:'succeeded',receipt_url:'https://pay.stripe.com/receipts/test',billing_details:{email:'private@example.com'},payment_method_details:{card:{last4:'4242'}}};
async function fixture(data=[charge],owner='alice'){
 const store=new MemoryStore(),calls=[];
 await store.transact([change('USER#alice','ENTITLEMENT',null,{customerId:'cus_alice'}),change('BILLING#customers','cus_alice',null,{userSub:owner})]);
 const billing=await createBilling(env,{client:{charges:{async list(params){calls.push(params);return {data,has_more:true};}}}});
 return {store,billing,calls};
}
test('payment history returns existing one-time receipt and excludes personal payment details',async()=>{
 const {store,billing,calls}=await fixture();const result=await billing.history({sub:'alice'},store);
 assert.deepEqual(calls,[{customer:'cus_alice',limit:20}]);assert.equal(result.payments[0].amount,100);assert.equal(result.payments[0].status,'paid');assert.equal(result.payments[0].receiptUrl,charge.receipt_url);assert.equal(result.hasMore,true);
 assert.doesNotMatch(JSON.stringify(result),/private@example|4242/);
});
test('payment history refuses another users customer mapping before Stripe access',async()=>{
 const {store,billing,calls}=await fixture([charge],'bob');await assert.rejects(()=>billing.history({sub:'alice'},store),/ownership/);assert.equal(calls.length,0);
});
test('payment history rejects mixed-customer responses',async()=>{
 const {store,billing}=await fixture([{...charge,customer:'cus_bob'}]);await assert.rejects(()=>billing.history({sub:'alice'},store),/ownership/);
});
test('payment history handles missing billing account, refunds and unsafe receipt links',async()=>{
 const {store,billing,calls}=await fixture([{...charge,amount_refunded:50,receipt_url:'https://example.com/fake'}]);
 assert.deepEqual(await billing.history({sub:'bob'},store),{payments:[],hasMore:false});assert.equal(calls.length,0);
 const result=await billing.history({sub:'alice'},store);assert.equal(result.payments[0].status,'partially_refunded');assert.equal(result.payments[0].refundedAmount,50);assert.equal(result.payments[0].receiptUrl,null);
});
test('service checks account deletion before returning payment history',async()=>{
 const {store,billing,calls}=await fixture();await store.transact([change('USER#alice','DELETING',null,{started:true})]);
 const service=createService({store,billing});await assert.rejects(()=>service.paymentHistory({sub:'alice'}),error=>error.code==='ACCOUNT_DELETING');assert.equal(calls.length,0);
});
