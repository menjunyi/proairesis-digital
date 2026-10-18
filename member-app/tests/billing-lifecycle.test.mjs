import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBilling} from '../server/adapters.mjs';
import {blankEntitlement,billingView,createService,TERMS_VERSION} from '../server/service.mjs';
import {createHttpHandler} from '../server/handler.mjs';
import {MemoryStore,change} from '../server/store.mjs';

const user={sub:'alice',email:'alice@example.test'};
const env={NODE_ENV:'production',STRIPE_SECRET_KEY_PARAM:'synthetic',STRIPE_WEBHOOK_SECRET_PARAM:'synthetic',STRIPE_PRICE_ID:'price_twenty_v2',STRIPE_STARTER_PRICE_ID:'price_starter',STRIPE_PORTAL_CONFIGURATION_ID:'bpc_roleclue',SITE_URL:'https://app.example.test'};
const now=Math.floor(Date.now()/1000);
const monthlyMetadata={roleclue_user_id:'alice',roleclue_plan:'monthly',roleclue_price_id:env.STRIPE_PRICE_ID,roleclue_offer:'monthly-aud20-50-v2',terms_version:TERMS_VERSION};
const subscription=()=>({id:'sub_alice',customer:'cus_alice',currency:'aud',created:now-100,status:'active',cancel_at_period_end:false,metadata:monthlyMetadata,items:{data:[{price:{id:env.STRIPE_PRICE_ID},quantity:1,current_period_start:now-100,current_period_end:now+86400}]},latest_invoice:'in_current'});
const price=()=>({id:env.STRIPE_PRICE_ID,active:true,currency:'aud',unit_amount:2000,recurring:{interval:'month',interval_count:1,usage_type:'licensed'}});
const starterPrice=()=>({id:env.STRIPE_STARTER_PRICE_ID,active:true,currency:'aud',unit_amount:100,recurring:null});
const event=type=>JSON.stringify({id:'evt_synthetic',type,data:{object:{customer:'cus_alice',metadata:{roleclue_user_id:'mallory'}}}});
const disputeEvent=type=>JSON.stringify({id:`evt_${type}`,type,data:{object:{id:'dp_synthetic',charge:'ch_current'}}});
const portalConfiguration=()=>({
  id:env.STRIPE_PORTAL_CONFIGURATION_ID,active:true,is_default:true,livemode:true,default_return_url:'https://app.example.test/',
  business_profile:{privacy_policy_url:'https://app.example.test/privacy.html',terms_of_service_url:'https://app.example.test/terms.html'},
  features:{
    customer_update:{allowed_updates:[],enabled:false},invoice_history:{enabled:true},
    payment_method_update:{enabled:true,payment_method_configuration:null},
    subscription_cancel:{cancellation_reason:{enabled:false,feedback_options:[],options:['too_expensive','missing_features','switched_service','unused','other']},enabled:true,mode:'at_period_end',proration_behavior:'none'},
    subscription_update:{billing_cycle_anchor:'unchanged',default_allowed_updates:[],enabled:false,proration_behavior:'none',schedule_at_period_end:{conditions:[]},trial_update_behavior:'end_trial'},
  },
});

function monthlyInvoice(sub,id='in_current'){
  const item=sub.items.data.find(candidate=>candidate.price.id===env.STRIPE_PRICE_ID)??sub.items.data[0],start=item.current_period_start,end=item.current_period_end;
  return {id,status:'paid',customer:sub.customer,currency:'aud',collection_method:'charge_automatically',billing_reason:'subscription_cycle',automatic_tax:{enabled:false},
    amount_due:2000,amount_paid:2000,amount_remaining:0,amount_overpaid:0,amount_paid_off_stripe:0,subtotal:2000,total:2000,total_excluding_tax:2000,
    starting_balance:0,ending_balance:0,pre_payment_credit_notes_amount:0,post_payment_credit_notes_amount:0,discounts:[],total_discount_amounts:[],total_pretax_credit_amounts:[],default_tax_rates:[],total_taxes:[],
    period_start:start-3600,period_end:end-3600,parent:{type:'subscription_details',subscription_details:{subscription:sub.id,metadata:monthlyMetadata}},
    lines:{data:[{id:'il_current',invoice:id,currency:'aud',amount:2000,subtotal:2000,quantity:1,period:{start,end},subscription:sub.id,parent:{type:'subscription_item_details',subscription_item_details:{subscription:sub.id,subscription_item:'si_current',invoice_item:null,proration:false,proration_details:null}},pricing:{type:'price_details',price_details:{price:env.STRIPE_PRICE_ID,product:'prod_monthly'},unit_amount_decimal:'2000'},discounts:[],discount_amounts:[],pretax_credit_amounts:[],taxes:[]}],has_more:false}};
}

async function fixture(overrides={}){
  const store=new MemoryStore(),entitlement={...blankEntitlement(),customerId:'cus_alice',subscriptionId:'sub_alice',status:'active',free:{used:1,reserved:0},paid:{key:`sub_alice:${now-100}`,used:7,reserved:0}};
  await store.transact([change('USER#alice','ENTITLEMENT',null,entitlement),change('BILLING#customers','cus_alice',null,{userSub:'alice'})]);
  const state={sub:subscription(),invoice:{},payments:[],charge:{id:'ch_current',customer:'cus_alice',currency:'aud',amount:2000,amount_captured:2000,paid:true,status:'succeeded',captured:true,refunded:false,disputed:false,payment_intent:'pi_current'},intent:{id:'pi_current',customer:'cus_alice',currency:'aud',amount:2000,amount_received:2000,status:'succeeded',latest_charge:'ch_current'},checkout:[],expired:[],portals:[],portalRetrievals:[],portalConfiguration:portalConfiguration(),prices:price()};
  state.payments=[{id:'inpay_current',status:'paid',invoice:'in_current',currency:'aud',amount_requested:2000,amount_paid:2000,payment:{type:'payment_intent',payment_intent:'pi_current'}}];
  const client={
    subscriptions:{async list(){return {data:state.sub?[state.sub]:[],has_more:false};},async retrieve(){return state.completedSub??state.sub;}},
    invoicePayments:{async list({invoice}){return {data:state.paymentsByInvoice?.[invoice]??state.payments,has_more:false};}},
    paymentIntents:{async retrieve(){return {...state.intent,latest_charge:state.charge};}},
    charges:{async retrieve(){return state.charge;}},
    invoices:{async retrieve(id){const currentId=typeof state.sub?.latest_invoice==='string'?state.sub.latest_invoice:state.sub?.latest_invoice?.id;return {...monthlyInvoice(state.sub,id),...(id===currentId?state.invoice:{}),...state.invoiceById?.[id]};},async list(){return {data:state.invoiceHistory??[],has_more:false};}},
    prices:{async retrieve(id){return id===env.STRIPE_STARTER_PRICE_ID?starterPrice():state.prices;}},
    checkout:{sessions:{async list(){return {data:[],has_more:false};},async create(params,options){state.checkout.push({params,options});return {id:'cs_synthetic',url:'https://checkout.stripe.com/synthetic',expires_at:params.expires_at,automatic_tax:params.automatic_tax};},async expire(id){state.expired.push(id);return {id,status:'expired'};},async retrieve(){return {id:'cs_synthetic',mode:'subscription',customer:'cus_alice',client_reference_id:'alice',status:state.checkoutStatus??'open',expires_at:now+3600,subscription:state.checkoutSubscriptionId??'sub_alice',automatic_tax:{enabled:false},metadata:{roleclue_plan:'monthly',roleclue_price_id:env.STRIPE_PRICE_ID,terms_version:TERMS_VERSION},line_items:{data:[{price:{id:env.STRIPE_PRICE_ID},quantity:1}]}};}}},
    billingPortal:{configurations:{async retrieve(id){state.portalRetrievals.push(id);return state.portalConfiguration;}},sessions:{async create(params){state.portals.push(params);return {url:'https://billing.stripe.com/synthetic'};}}},
    webhooks:{constructEvent(raw,signature){if(signature!=='valid')throw Error('Invalid');return JSON.parse(raw);}},
    ...overrides,
  };
  const billing=await createBilling(env,{client,webhookSecret:'synthetic'});
  const service=createService({store,billing,feed:{async status(){return {status:'unconfigured'};}},provider:{available:()=>false}});
  return {store,state,billing,service,client};
}

test('billing stays disabled unless both fixed catalog prices and the pinned portal are configured',async()=>{
  assert.equal(await createBilling({...env,STRIPE_STARTER_PRICE_ID:''}),null);
  assert.equal(await createBilling({...env,STRIPE_PRICE_ID:''}),null);
  assert.equal(await createBilling({...env,STRIPE_PORTAL_CONFIGURATION_ID:''}),null);
  assert.equal(await createBilling({...env,STRIPE_PORTAL_CONFIGURATION_ID:'invalid'}),null);
});

test('active subscription requires a verified paid invoice and retains usage while payment is pending',async()=>{
  const {state,store,billing}=await fixture();
  state.invoice.status='open';
  await billing.webhook(event('checkout.session.completed'),'valid',store);
  let e=(await store.get('USER#alice','ENTITLEMENT')).value;
  assert.equal(e.status,'payment_pending');assert.equal(e.subscriptionStatus,'active');assert.equal(billingView(e).canGenerate,false);assert.equal(e.paid.used,7);
  state.invoice.status='paid';
  await billing.webhook(event('invoice.paid'),'valid',store);
  e=(await store.get('USER#alice','ENTITLEMENT')).value;
  assert.equal(billingView(e).remaining,43);assert.equal(e.paid.used,7);
});

test('monthly entitlement requires exact canonical A$20 Stripe settlement evidence',async t=>{
  const cases=[
    ['foreign invoice customer',state=>{state.invoice.customer='cus_other';}],
    ['foreign invoice subscription',state=>{const base=monthlyInvoice(state.sub);state.invoice.parent={...base.parent,subscription_details:{...base.parent.subscription_details,subscription:'sub_other'}};}],
    ['foreign immutable account metadata',state=>{const base=monthlyInvoice(state.sub);state.invoice.parent={...base.parent,subscription_details:{...base.parent.subscription_details,metadata:{...monthlyMetadata,roleclue_user_id:'mallory'}}};}],
    ['discount',state=>{state.invoice.discounts=['di_1'];state.invoice.total_discount_amounts=[{amount:100,discount:'di_1'}];}],
    ['credit balance',state=>{state.invoice.starting_balance=-100;state.invoice.amount_due=1900;state.invoice.amount_paid=1900;}],
    ['off-Stripe payment',state=>{state.invoice.amount_paid_off_stripe=2000;}],
    ['automatic tax',state=>{state.invoice.automatic_tax={enabled:true};}],
    ['wrong invoice line price',state=>{const base=monthlyInvoice(state.sub);base.lines.data[0].pricing.price_details.price='price_other';state.invoice.lines=base.lines;}],
    ['missing InvoicePayment',state=>{state.payments=[];}],
    ['external payment record',state=>{state.payments=[{...state.payments[0],payment:{type:'payment_record',payment_record:'ipr_external'}}];}],
    ['foreign PaymentIntent',state=>{state.intent.customer='cus_other';}],
    ['uncaptured charge',state=>{state.charge.captured=false;state.charge.amount_captured=0;}],
  ];
  for(const [name,mutate] of cases)await t.test(name,async()=>{
    const {state,store,billing}=await fixture();mutate(state);await billing.reconcile(user.sub,store);
    const entitlement=(await store.get('USER#alice','ENTITLEMENT')).value;
    assert.equal(entitlement.status,'payment_pending');assert.equal(entitlement.paid.used,7);assert.equal(entitlement.paid.reserved,0);assert.equal(billingView(entitlement).canGenerate,false);
  });
});

test('a zero-value paid invoice does not count as a successful Plus payment',async()=>{
  const {state,store,billing}=await fixture();
  Object.assign(state.invoice,{amount_due:0,amount_paid:0,subtotal:0,total:0,total_excluding_tax:0});state.payments=[];
  await billing.reconcile(user.sub,store);
  const entitlement=(await store.get('USER#alice','ENTITLEMENT')).value;
  assert.equal(entitlement.subscriptionEverPaid,false);assert.equal(billingView(entitlement).canPurchaseStarter,true);assert.equal(billingView(entitlement).canGenerate,false);
});

test('a current-price subscription without metadata stays managed but receives no allowance',async()=>{
  const {state,store,billing,service}=await fixture();
  state.sub.metadata={};
  const row=await store.get('USER#alice','ENTITLEMENT');await store.transact([change(row.pk,row.sk,row,{...row.value,subscriptionId:null,status:'none',subscriptionStatus:'none'})]);
  const base=monthlyInvoice(state.sub);state.invoice.parent={...base.parent,subscription_details:{...base.parent.subscription_details,metadata:{}}};
  await billing.reconcile(user.sub,store);
  const view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);
  assert.equal(view.hasSubscription,true);assert.equal(view.canGenerate,false);assert.equal(view.remaining,0);
  assert.match((await service.checkout(user,{termsAccepted:true})).url,/billing\.stripe\.com/);
  await assert.rejects(service.deleteAccount(user,{confirmation:'DELETE'}),error=>error.code==='CANCEL_SUBSCRIPTION_FIRST');
});

test('refund revokes paid credit but keeps the subscription managed and prevents a second subscription or deletion',async()=>{
  const {state,store,billing,service}=await fixture();
  state.charge.refunded=true;
  await billing.webhook(event('charge.refunded'),'valid',store);
  const e=(await store.get('USER#alice','ENTITLEMENT')).value,view=billingView(e);
  assert.equal(e.status,'refunded');assert.equal(e.subscriptionStatus,'active');assert.equal(view.hasSubscription,true);assert.equal(view.canManageBilling,true);assert.equal(view.canGenerate,false);
  assert.match((await service.checkout(user,{termsAccepted:true})).url,/billing\.stripe\.com/);assert.equal(state.checkout.length,0);
  await assert.rejects(service.deleteAccount(user,{confirmation:'DELETE'}),error=>error.code==='CANCEL_SUBSCRIPTION_FIRST');
});

test('direct-charge full refunds are checked while partial refunds do not consume or reset usage',async()=>{
  const {state,store,billing}=await fixture();
  state.payments=[{...state.payments[0],payment:{type:'charge',charge:'ch_current'}}];
  state.charge.amount_refunded=500;
  await billing.reconcile(user.sub,store);
  assert.equal((await store.get('USER#alice','ENTITLEMENT')).value.status,'active');
  state.charge.refunded=true;
  await billing.reconcile(user.sub,store);
  const e=(await store.get('USER#alice','ENTITLEMENT')).value;
  assert.equal(e.status,'refunded');assert.equal(e.paid.used,7);
});

test('every dispute lifecycle webhook immediately reconciles from canonical Stripe state',async t=>{
  const cases=[
    ['charge.dispute.updated',true,'disputed'],
    ['charge.dispute.funds_withdrawn',true,'disputed'],
    ['charge.dispute.closed',false,'active'],
    ['charge.dispute.funds_reinstated',false,'active'],
  ];
  for(const [type,disputed,expected] of cases)await t.test(type,async()=>{
    const {state,store,billing}=await fixture();state.charge.disputed=disputed;
    const row=await store.get('USER#alice','ENTITLEMENT');
    await store.transact([change(row.pk,row.sk,row,{...row.value,status:disputed?'active':'disputed'})]);
    await billing.webhook(disputeEvent(type),'valid',store);
    assert.equal((await store.get('USER#alice','ENTITLEMENT')).value.status,expected);
  });
});

test('period-end cancellation retains current credit until canonical cancellation, and unpaid states cannot generate',async()=>{
  const {state,store,billing}=await fixture();
  state.sub.cancel_at_period_end=true;
  await billing.reconcile(user.sub,store);
  let view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);
  assert.equal(view.plan,'monthly');assert.equal(view.cancelAtPeriodEnd,true);assert.equal(view.remaining,43);
  for(const status of ['past_due','unpaid','incomplete','paused','trialing','canceled']){
    state.sub.status=status;
    await billing.reconcile(user.sub,store);
    view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);
    assert.equal(view.canGenerate,false,status);assert.equal(view.hasSubscription,status!=='canceled',status);
  }
});

test('renewal resets allowance only for the verified new period; duplicate reconciliation retains reservations',async()=>{
  const {state,store,billing}=await fixture();
  state.sub.items.data[0].current_period_start=now;
  await billing.reconcile(user.sub,store);
  const row=await store.get('USER#alice','ENTITLEMENT');
  assert.equal(row.value.paid.used,0);assert.equal(billingView(row.value).remaining,50);
  row.value.paid={...row.value.paid,used:12,reserved:2};await store.transact([change('USER#alice','ENTITLEMENT',row,row.value)]);
  await billing.reconcile(user.sub,store);
  assert.equal(billingView((await store.get('USER#alice','ENTITLEMENT')).value).remaining,36);
});

test('missing or malformed Stripe billing periods never activate paid access',async()=>{
  const {state,store,billing}=await fixture();
  for(const [start,end] of [[undefined,undefined],[now,now-1],[now,Infinity]]){
    Object.assign(state.sub.items.data[0],{current_period_start:start,current_period_end:end});
    await billing.reconcile(user.sub,store);
    const e=(await store.get('USER#alice','ENTITLEMENT')).value;
    assert.equal(e.status,'payment_pending');assert.equal(billingView(e).canGenerate,false);
  }
});

test('checkout binds current terms and account returns, uses the server price and stable idempotency identity',async()=>{
  const {state,billing,store}=await fixture();
  const row=await store.get('USER#alice','ENTITLEMENT');await store.transact([change('USER#alice','ENTITLEMENT',row,{...row.value,subscriptionId:null,status:'none'})]);
  const request={requestKey:'fixed-synthetic-key',expiresAt:Date.now()+3600000,acceptedAt:new Date().toISOString(),termsVersion:TERMS_VERSION};
  await billing.checkout(user,store,request);
  const {params,options}=state.checkout[0];
  assert.equal(params.metadata.terms_version,TERMS_VERSION);assert.equal(params.metadata.terms_accepted_at,request.acceptedAt);assert.equal(params.metadata.roleclue_plan,'monthly');
  assert.deepEqual(params.line_items,[{price:env.STRIPE_PRICE_ID,quantity:1}]);assert.equal(params.customer,'cus_alice');
  assert.equal(params.success_url,'https://app.example.test/?checkout=success&plan=monthly#account');assert.equal(params.cancel_url,'https://app.example.test/?checkout=cancelled#account');
  assert.equal(options.idempotencyKey,'roleclue-checkout-v3-auto-tax-disabled-monthly-aud20-50-v2-fixed-synthetic-key');assert.notEqual(options.idempotencyKey,'roleclue-checkout-fixed-synthetic-key');assert.equal(params.consent_collection.terms_of_service,'required');assert.equal(params.payment_method_types,undefined);assert.equal(params.payment_method_collection,'always');assert.equal(params.subscription_data.trial_period_days,undefined);assert.deepEqual(params.automatic_tax,{enabled:false});assert.equal(params.line_items[0].tax_rates,undefined);assert.equal(params.subscription_data.default_tax_rates,undefined);assert.equal(params.allow_promotion_codes,false);assert.equal(params.discounts,undefined);
  await billing.portal(user,store);
  assert.deepEqual(state.portalRetrievals,[env.STRIPE_PORTAL_CONFIGURATION_ID]);
  assert.equal(state.portals[0].configuration,env.STRIPE_PORTAL_CONFIGURATION_ID);
  assert.equal(state.portals[0].return_url,'https://app.example.test/?billing=return#account');
});

test('billing portal fails closed when any pinned safety contract field drifts',async t=>{
  const cases=[
    ['identity',config=>{config.id='bpc_other';}],
    ['active',config=>{config.active=false;}],
    ['live mode',config=>{config.livemode=false;}],
    ['return URL',config=>{config.default_return_url='https://example.test/';}],
    ['privacy URL',config=>{config.business_profile.privacy_policy_url='https://example.test/privacy';}],
    ['terms URL',config=>{config.business_profile.terms_of_service_url='https://example.test/terms';}],
    ['customer update',config=>{config.features.customer_update.enabled=true;}],
    ['customer fields',config=>{config.features.customer_update.allowed_updates=['email'];}],
    ['invoice history',config=>{config.features.invoice_history.enabled=false;}],
    ['payment methods',config=>{config.features.payment_method_update.enabled=false;}],
    ['payment configuration',config=>{config.features.payment_method_update.payment_method_configuration='pmc_other';}],
    ['cancellation disabled',config=>{config.features.subscription_cancel.enabled=false;}],
    ['immediate cancellation',config=>{config.features.subscription_cancel.mode='immediately';}],
    ['cancellation proration',config=>{config.features.subscription_cancel.proration_behavior='create_prorations';}],
    ['cancellation reasons',config=>{config.features.subscription_cancel.cancellation_reason.enabled=true;}],
    ['cancellation reason options',config=>{config.features.subscription_cancel.cancellation_reason.options=['other'];}],
    ['subscription update',config=>{config.features.subscription_update.enabled=true;}],
    ['billing-cycle change',config=>{config.features.subscription_update.billing_cycle_anchor='reset';}],
    ['update proration',config=>{config.features.subscription_update.proration_behavior='create_prorations';}],
    ['allowed subscription changes',config=>{config.features.subscription_update.default_allowed_updates=['price'];}],
    ['scheduled subscription changes',config=>{config.features.subscription_update.schedule_at_period_end.conditions=['decreasing_item_amount'];}],
    ['trial behavior',config=>{config.features.subscription_update.trial_update_behavior='continue_trial';}],
  ];
  for(const [name,mutate] of cases)await t.test(name,async()=>{
    const {state,billing,store}=await fixture();mutate(state.portalConfiguration);
    await assert.rejects(billing.portal(user,store),error=>error.status===503&&error.message==='Billing management is not configured safely.');
    assert.equal(state.portals.length,0);
  });
});

test('same-contract checkout retries keep one versioned Stripe idempotency key',async()=>{
  const {state,billing,store}=await fixture();
  const row=await store.get('USER#alice','ENTITLEMENT');await store.transact([change('USER#alice','ENTITLEMENT',row,{...row.value,subscriptionId:null,status:'none'})]);
  const request={requestKey:'same-current-request',expiresAt:Date.now()+3600000,acceptedAt:new Date().toISOString(),termsVersion:TERMS_VERSION};
  await billing.checkout(user,store,request);await billing.checkout(user,store,request);
  assert.equal(state.checkout.length,2);
  assert.equal(state.checkout[0].options.idempotencyKey,state.checkout[1].options.idempotencyKey);
  assert.equal(state.checkout[0].options.idempotencyKey,'roleclue-checkout-v3-auto-tax-disabled-monthly-aud20-50-v2-same-current-request');
  assert.notEqual(state.checkout[0].options.idempotencyKey,'roleclue-checkout-same-current-request');
});

test('checkout expires the session and fails closed if Stripe returns automatic tax enabled',async()=>{
  const {state,billing,store,client}=await fixture();
  const row=await store.get('USER#alice','ENTITLEMENT');await store.transact([change('USER#alice','ENTITLEMENT',row,{...row.value,subscriptionId:null,status:'none'})]);
  client.checkout.sessions.create=async(params,options)=>{state.checkout.push({params,options});return {id:'cs_tax_mismatch',url:'https://checkout.stripe.com/tax-mismatch',expires_at:params.expires_at,automatic_tax:{enabled:true}};};
  await assert.rejects(billing.checkout(user,store,{requestKey:'tax-mismatch-request'}),error=>error.status===503&&error.message==='Checkout tax configuration could not be verified.');
  assert.deepEqual(state.expired,['cs_tax_mismatch']);
});

test('checkout ignores a caller-supplied stale terms version',async()=>{
  const {state,billing,store}=await fixture();
  const row=await store.get('USER#alice','ENTITLEMENT');await store.transact([change('USER#alice','ENTITLEMENT',row,{...row.value,subscriptionId:null,status:'none'})]);
  await billing.checkout(user,store,{requestKey:'stale-terms-key',expiresAt:Date.now()+3600000,acceptedAt:new Date().toISOString(),termsVersion:'old-terms'});
  assert.equal(state.checkout[0].params.metadata.terms_version,TERMS_VERSION);
  assert.equal(state.checkout[0].params.subscription_data.metadata.terms_version,TERMS_VERSION);
});

test('wrong amount, currency, interval, usage type, or inactive price cannot create checkout',async()=>{
  const {state,billing,store}=await fixture();
  for(const update of [{unit_amount:2100},{currency:'usd'},{active:false},{recurring:{interval:'year',interval_count:1}},{recurring:{interval:'month',interval_count:2}},{recurring:{interval:'month',interval_count:1,usage_type:'metered'}}]){
    state.prices={...price(),...update};
    await assert.rejects(billing.checkout(user,store),error=>error.status===503);
  }
  assert.equal(state.checkout.length,0);
});

test('subscription and invoice-payment history are paginated before reconciling entitlement',async()=>{
  const {state,billing,store,client}=await fixture();let subCalls=0,paymentCalls=0;
  client.subscriptions.list=async params=>{subCalls++;return params.starting_after?{data:[state.sub],has_more:false}:{data:[{id:'sub_other',created:1,status:'canceled',items:{data:[{price:{id:'price_other'}}]}}],has_more:true};};
  client.invoicePayments.list=async params=>{paymentCalls++;return params.starting_after?{data:[{id:'inpay_refund',status:'paid',invoice:'in_current',currency:'aud',amount_requested:2000,amount_paid:2000,payment:{type:'charge',charge:'ch_current'}}],has_more:false}:{data:[{id:'inpay_open',status:'open'}],has_more:true};};
  state.charge.refunded=true;await billing.reconcile(user.sub,store);
  assert.equal(subCalls,2);assert.equal(paymentCalls,2);assert.equal((await store.get('USER#alice','ENTITLEMENT')).value.status,'refunded');
});

test('billing refresh is authenticated, tenant-bound and throttled without granting from browser inputs',async()=>{
  const {service,state}=await fixture(),http=createHttpHandler(service);
  const request={rawPath:'/api/billing/refresh',requestContext:{http:{method:'POST'},authorizer:{jwt:{claims:{sub:user.sub,email:user.email,email_verified:'true',token_use:'id'}}}},body:JSON.stringify({customerId:'cus_mallory',status:'active'})};
  const response=await http(request);assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).billing.remaining,43);
  assert.equal((await http(request)).statusCode,429);
  assert.equal((await http({...request,requestContext:{http:{method:'POST'}}})).statusCode,401);
  assert.equal(state.checkout.length,0);
});

test('deletion rechecks Stripe so a delayed activation webhook cannot leave a paying deleted account',async()=>{
  const {service,store}=await fixture(),row=await store.get('USER#alice','ENTITLEMENT');
  await store.transact([change('USER#alice','ENTITLEMENT',row,{...row.value,subscriptionId:null,status:'none'})]);
  await assert.rejects(service.deleteAccount(user,{confirmation:'DELETE'}),error=>error.code==='CANCEL_SUBSCRIPTION_FIRST');
  assert.equal(await store.get('USER#alice','DELETING'),null);
});

test('deletion catches a managed subscription that appears after initial reconciliation',async()=>{
  const {state,service,store,client}=await fixture();let calls=0;
  client.subscriptions.list=async()=>({data:++calls===1?[]:[state.sub],has_more:false});
  await assert.rejects(service.deleteAccount(user,{confirmation:'DELETE'}),error=>error.code==='CANCEL_SUBSCRIPTION_FIRST');
  assert.equal(calls,2);assert.equal(await store.get('USER#alice','DELETING'),null);
});

test('a completed legacy monthly checkout blocks deletion when subscription listing is stale',async()=>{
  const {state,store,service,client}=await fixture();state.sub=null;
  await store.transact([change('USER#alice','CHECKOUT',null,{plan:'monthly',sessionId:'cs_legacy_monthly',expiresAt:Date.now()-1})]);
  client.checkout.sessions.retrieve=async()=>({id:'cs_legacy_monthly',mode:'subscription',status:'complete',customer:'cus_alice',client_reference_id:'alice',subscription:'sub_legacy',metadata:{roleclue_user_id:'alice',roleclue_plan:'monthly',roleclue_price_id:'price_legacy',roleclue_offer:'monthly-aud20-40-v1',terms_version:'legacy-terms'},line_items:{data:[{price:{id:'price_legacy'},quantity:1}]}});
  client.subscriptions.retrieve=async()=>({id:'sub_legacy',customer:'cus_alice',status:'active',metadata:{roleclue_user_id:'alice',roleclue_plan:'monthly'},items:{data:[{price:{id:'price_legacy'},quantity:1}]}});
  await assert.rejects(service.deleteAccount(user,{confirmation:'DELETE'}),error=>error.code==='CANCEL_SUBSCRIPTION_FIRST');
  assert.ok(await store.get('USER#alice','ENTITLEMENT'));assert.equal(await store.get('USER#alice','DELETING'),null);
});

test('completed checkout links are replaced after a subscription ends, while open links are reused',async()=>{
  const {state,store,service}=await fixture();state.sub=null;
  const first=await service.checkout(user,{termsAccepted:true});
  assert.deepEqual(await service.checkout(user,{termsAccepted:true}),first);assert.equal(state.checkout.length,1);
  state.checkoutStatus='complete';state.sub={...subscription(),status:'canceled'};
  await service.checkout(user,{termsAccepted:true});assert.equal(state.checkout.length,2);
  assert.notEqual(state.checkout[0].options.idempotencyKey,state.checkout[1].options.idempotencyKey);
  const row=await store.get('USER#alice','CHECKOUT');assert.equal(row.value.sessionId,'cs_synthetic');assert.equal(row.value.termsVersion,TERMS_VERSION);
});

test('cached checkout ownership is verified before returning a session URL',async()=>{
  const {state,service,client}=await fixture();state.sub=null;
  await service.checkout(user,{termsAccepted:true});
  client.checkout.sessions.retrieve=async()=>({customer:'cus_other',client_reference_id:'mallory',status:'open',expires_at:now+3600});
  await assert.rejects(service.checkout(user,{termsAccepted:true}),error=>error.status===503);
  assert.equal(state.checkout.length,1);
});

test('checkout completion during verification cannot create a second subscription, including a locally expired cache',async()=>{
  for(const locallyExpired of [false,true]){
    const {state,store,service,client}=await fixture();state.sub=null;
    await service.checkout(user,{termsAccepted:true});
    if(locallyExpired){const row=await store.get('USER#alice','CHECKOUT');await store.transact([change('USER#alice','CHECKOUT',row,{...row.value,expiresAt:Date.now()-1})]);}
    client.checkout.sessions.retrieve=async()=>{
      state.sub=subscription();
      return {id:'cs_synthetic',mode:'subscription',customer:'cus_alice',client_reference_id:'alice',status:'complete',subscription:'sub_alice',expires_at:now+3600,automatic_tax:{enabled:false},metadata:{roleclue_plan:'monthly',roleclue_price_id:env.STRIPE_PRICE_ID,terms_version:TERMS_VERSION},line_items:{data:[{price:{id:env.STRIPE_PRICE_ID},quantity:1}]}};
    };
    const result=await service.checkout(user,{termsAccepted:true});
    assert.match(result.url,/billing\.stripe\.com/,String(locallyExpired));
    assert.equal(state.checkout.length,1);assert.equal(state.portals.length,1);
    assert.equal(billingView((await store.get('USER#alice','ENTITLEMENT')).value).remaining,50);
  }
});

test('completed-session subscription verification blocks duplicate checkout even before list reconciliation catches up',async()=>{
  const {state,service}=await fixture();state.sub=null;
  await service.checkout(user,{termsAccepted:true});
  state.checkoutStatus='complete';state.completedSub=subscription();
  assert.match((await service.checkout(user,{termsAccepted:true})).url,/billing\.stripe\.com/);
  assert.equal(state.checkout.length,1);
});

test('completed checkout cannot be replaced if its subscription is missing, unknown or belongs to another customer',async()=>{
  for(const kind of ['missing','unknown','foreign','wrong-price']){
    const {state,service,client}=await fixture();state.sub=null;
    await service.checkout(user,{termsAccepted:true});
    state.checkoutStatus='complete';state.completedSub=subscription();
    if(kind==='missing')client.checkout.sessions.retrieve=async()=>({id:'cs_synthetic',mode:'subscription',customer:'cus_alice',client_reference_id:'alice',status:'complete',subscription:null});
    if(kind==='unknown')state.completedSub.status='unexpected';
    if(kind==='foreign')state.completedSub.customer='cus_mallory';
    if(kind==='wrong-price')state.completedSub.items.data[0].price.id='price_other';
    await assert.rejects(service.checkout(user,{termsAccepted:true}),error=>error.status===503,kind);
    assert.equal(state.checkout.length,1,kind);
  }
});

test('provider-expired checkout is replaceable, but a local expiry cannot replace an open provider session',async()=>{
  for(const status of ['open','expired']){
    const {state,store,service}=await fixture();state.sub=null;
    const initial=await service.checkout(user,{termsAccepted:true});
    const row=await store.get('USER#alice','CHECKOUT');await store.transact([change('USER#alice','CHECKOUT',row,{...row.value,expiresAt:Date.now()-1})]);
    state.checkoutStatus=status;
    const result=await service.checkout(user,{termsAccepted:true});
    assert.equal(state.checkout.length,status==='open'?1:2);
    if(status==='open')assert.deepEqual(result,initial);
  }
});

test('an open checkout from the old catalog is expired and replaced instead of reused',async()=>{
  const {state,service,client}=await fixture();state.sub=null;
  await service.checkout(user,{termsAccepted:true});
  client.checkout.sessions.retrieve=async()=>({id:'cs_synthetic',mode:'subscription',customer:'cus_alice',client_reference_id:'alice',status:'open',expires_at:now+3600,automatic_tax:{enabled:false},metadata:{roleclue_plan:'monthly',roleclue_price_id:'price_old',terms_version:'old-terms'},line_items:{data:[{price:{id:'price_old'},quantity:1}]}});
  await service.checkout(user,{termsAccepted:true});
  assert.deepEqual(state.expired,['cs_synthetic']);assert.equal(state.checkout.length,2);assert.notEqual(state.checkout[0].options.idempotencyKey,state.checkout[1].options.idempotencyKey);
});

test('an open automatic-tax checkout is expired and replaced with an explicit tax-disabled session',async()=>{
  const {state,service,client}=await fixture();state.sub=null;
  await service.checkout(user,{termsAccepted:true});
  client.checkout.sessions.retrieve=async()=>({id:'cs_synthetic',mode:'subscription',customer:'cus_alice',client_reference_id:'alice',status:'open',expires_at:now+3600,automatic_tax:{enabled:true},metadata:{roleclue_plan:'monthly',roleclue_price_id:env.STRIPE_PRICE_ID,terms_version:TERMS_VERSION},line_items:{data:[{price:{id:env.STRIPE_PRICE_ID},quantity:1}]}});
  await service.checkout(user,{termsAccepted:true});
  assert.deepEqual(state.expired,['cs_synthetic']);assert.equal(state.checkout.length,2);assert.deepEqual(state.checkout[1].params.automatic_tax,{enabled:false});assert.notEqual(state.checkout[0].options.idempotencyKey,state.checkout[1].options.idempotencyKey);
});

test('a pre-session checkout reservation from old terms gets a new request identity',async()=>{
  const {state,store,service}=await fixture();state.sub=null;
  await store.transact([change('USER#alice','CHECKOUT',null,{plan:'monthly',requestKey:'old-request-key',expiresAt:Date.now()+3600000,acceptedAt:new Date().toISOString(),termsVersion:'old-terms'})]);
  await service.checkout(user,{termsAccepted:true});
  const request=(await store.get('USER#alice','CHECKOUT')).value;
  assert.equal(request.termsVersion,TERMS_VERSION);assert.notEqual(request.requestKey,'old-request-key');
  assert.equal(state.checkout[0].params.metadata.terms_version,TERMS_VERSION);
});

test('a completed failed subscription may be retried only after its ended state is verified',async()=>{
  const {state,service}=await fixture();state.sub=null;
  await service.checkout(user,{termsAccepted:true});
  state.checkoutStatus='complete';state.sub={...subscription(),status:'incomplete_expired'};
  await service.checkout(user,{termsAccepted:true});
  assert.equal(state.checkout.length,2);
});

test('unverified cached checkout URLs fail closed instead of using a weaker adapter fallback',async()=>{
  const {state,store,service}=await fixture();state.sub=null;
  await service.checkout(user,{termsAccepted:true});
  const row=await store.get('USER#alice','CHECKOUT'),{sessionId:_sessionId,...withoutIdentity}=row.value;
  await store.transact([change('USER#alice','CHECKOUT',row,withoutIdentity)]);
  await assert.rejects(service.checkout(user,{termsAccepted:true}),error=>error.status===503);
  assert.equal(state.checkout.length,1);
});

async function starterFixture(){
  const store=new MemoryStore(),entitlement={...blankEntitlement(),customerId:'cus_starter'};
  await store.transact([change('USER#alice','ENTITLEMENT',null,entitlement),change('BILLING#customers','cus_starter',null,{userSub:'alice'})]);
  const starterMetadata={roleclue_plan:'starter',roleclue_user_id:'alice',roleclue_price_id:env.STRIPE_STARTER_PRICE_ID,roleclue_offer:'starter-aud1-2-lifetime-v1',terms_version:TERMS_VERSION};
  const state={created:[],sessions:[],session:{},charge:{id:'ch_starter',customer:'cus_starter',currency:'aud',amount:100,amount_captured:100,paid:true,status:'succeeded',captured:true,payment_intent:'pi_starter',refunded:false,disputed:false},intent:{id:'pi_starter',customer:'cus_starter',status:'succeeded',currency:'aud',amount:100,amount_received:100,metadata:starterMetadata,latest_charge:'ch_starter'}};
  const fullSession=()=>({id:'cs_starter',mode:'payment',status:'complete',payment_status:state.intent.status==='succeeded'?'paid':'unpaid',customer:'cus_starter',client_reference_id:'alice',currency:'aud',amount_subtotal:100,amount_total:100,total_details:{amount_discount:0,amount_shipping:0,amount_tax:0},created:now,automatic_tax:{enabled:false},metadata:starterMetadata,line_items:{data:[{price:{id:env.STRIPE_STARTER_PRICE_ID},quantity:1}],has_more:false},payment_intent:'pi_starter',expires_at:now+3600,...state.session});
  const client={
    subscriptions:{async list(){return {data:[],has_more:false};}},
    prices:{async retrieve(id){return id===env.STRIPE_STARTER_PRICE_ID?starterPrice():price();}},
    checkout:{sessions:{async list(){return {data:state.sessions.map(session=>({id:session.id,mode:session.mode,created:session.created,metadata:session.metadata})),has_more:false};},async retrieve(id){assert.equal(id,'cs_starter');return fullSession();},async create(params,options){state.created.push({params,options});return {id:'cs_starter',url:'https://checkout.stripe.com/starter',expires_at:params.expires_at,automatic_tax:params.automatic_tax};}}},
    paymentIntents:{async retrieve(){return {...state.intent,latest_charge:state.charge};}},
    charges:{async retrieve(){return state.charge;}},
    billingPortal:{configurations:{async retrieve(){return portalConfiguration();}},sessions:{async create(){return {url:'https://billing.stripe.com/starter'};}}},
    webhooks:{constructEvent(raw,signature){if(signature!=='valid')throw Error('Invalid');return JSON.parse(raw);}},
  };
  const billing=await createBilling(env,{client,webhookSecret:'synthetic'});
  const service=createService({store,billing,feed:{async status(){return {status:'unconfigured'};}},provider:{available:()=>false}});
  return {store,state,billing,service,client,fullSession};
}

test('starter checkout is a fixed A$1 payment with dashboard-managed methods and no trial, discount or renewal',async()=>{
  const {state,billing,store}=await starterFixture();
  const request={plan:'starter',requestKey:'starter-synthetic-key',expiresAt:Date.now()+3600000,acceptedAt:new Date().toISOString(),termsVersion:TERMS_VERSION};
  await billing.checkout(user,store,request);
  const {params,options}=state.created[0];
  assert.equal(params.mode,'payment');assert.deepEqual(params.line_items,[{price:env.STRIPE_STARTER_PRICE_ID,quantity:1}]);assert.equal(params.payment_method_types,undefined);
  assert.equal(params.success_url,'https://app.example.test/?checkout=success&plan=starter#account');
  assert.equal(params.payment_method_collection,undefined);assert.equal(params.subscription_data,undefined);assert.deepEqual(params.automatic_tax,{enabled:false});assert.equal(params.line_items[0].tax_rates,undefined);assert.equal(params.allow_promotion_codes,false);assert.equal(params.discounts,undefined);
  assert.equal(params.metadata.roleclue_offer,'starter-aud1-2-lifetime-v1');assert.equal(params.metadata.terms_version,TERMS_VERSION);assert.deepEqual(params.payment_intent_data.metadata,params.metadata);
  assert.equal(options.idempotencyKey,'roleclue-checkout-v3-auto-tax-disabled-starter-aud1-2-lifetime-v1-starter-synthetic-key');
  assert.notEqual(options.idempotencyKey,'roleclue-checkout-starter-synthetic-key');
});

test('verified paid starter session grants two lifetime generations once and duplicate reconciliation keeps usage',async()=>{
  const {state,store,billing,service}=await starterFixture();state.sessions=[{id:'cs_starter',mode:'payment',created:now,metadata:{roleclue_plan:'starter'}}];
  await billing.reconcile(user.sub,store);
  const row=await store.get('USER#alice','ENTITLEMENT');let view=billingView(row.value);
  assert.equal(view.plan,'starter');assert.equal(view.limit,2);assert.equal(view.remaining,2);assert.equal(view.canPurchaseStarter,false);assert.equal(row.value.starter.everPaid,true);
  row.value.starter.used=1;row.value.starter.reserved=1;await store.transact([change(row.pk,row.sk,row,row.value)]);await billing.reconcile(user.sub,store);
  view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);assert.equal(view.used,1);assert.equal(view.reserved,1);assert.equal(view.remaining,0);
  await assert.rejects(service.checkout(user,{plan:'starter',termsAccepted:true}),error=>error.code==='STARTER_NOT_ELIGIBLE');
});

test('a paid object with stale terms or mismatched provider metadata cannot grant Starter',async()=>{
  const {state,store,billing}=await starterFixture();state.sessions=[{id:'cs_starter',mode:'payment',created:now,metadata:{roleclue_plan:'starter'}}];state.intent.metadata={...state.intent.metadata,terms_version:'old-terms'};
  await billing.reconcile(user.sub,store);
  const view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);assert.equal(view.plan,'free');assert.equal(view.canGenerate,false);assert.equal(view.canPurchaseStarter,true);
});

test('Starter entitlement requires an exact successful captured A$1 Stripe charge',async t=>{
  const cases=[
    ['missing charge',state=>{state.charge=null;}],
    ['foreign charge customer',state=>{state.charge.customer='cus_other';}],
    ['wrong charge currency',state=>{state.charge.currency='usd';}],
    ['wrong charge amount',state=>{state.charge.amount=99;}],
    ['uncaptured charge',state=>{state.charge.captured=false;state.charge.amount_captured=0;}],
    ['foreign PaymentIntent link',state=>{state.charge.payment_intent='pi_other';}],
  ];
  for(const [name,mutate] of cases)await t.test(name,async()=>{
    const {state,store,billing}=await starterFixture();state.sessions=[{id:'cs_starter',mode:'payment',created:now,metadata:{roleclue_plan:'starter'}}];mutate(state);
    await billing.reconcile(user.sub,store);
    const view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);
    assert.equal(view.plan,'free');assert.equal(view.canGenerate,false);assert.equal(view.canPurchaseStarter,true);
  });
});

test('Starter entitlement requires the exact tax-disabled undiscounted A$1 Checkout offer',async t=>{
  const cases=[
    ['automatic tax',state=>{state.session={automatic_tax:{enabled:true}};}],
    ['wrong subtotal',state=>{state.session={amount_subtotal:90};}],
    ['discount',state=>{state.session={total_details:{amount_discount:10,amount_shipping:0,amount_tax:0}};}],
    ['tax',state=>{state.session={total_details:{amount_discount:0,amount_shipping:0,amount_tax:10}};}],
    ['shipping',state=>{state.session={total_details:{amount_discount:0,amount_shipping:10,amount_tax:0}};}],
    ['truncated line items',state=>{state.session={line_items:{data:[{price:{id:env.STRIPE_STARTER_PRICE_ID},quantity:1}],has_more:true}};}],
  ];
  for(const [name,mutate] of cases)await t.test(name,async()=>{
    const {state,store,billing}=await starterFixture();state.sessions=[{id:'cs_starter',mode:'payment',created:now,metadata:{roleclue_plan:'starter'}}];mutate(state);
    await billing.reconcile(user.sub,store);
    const view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);
    assert.equal(view.plan,'free');assert.equal(view.canGenerate,false);assert.equal(view.canPurchaseStarter,true);
  });
});

test('account deletion blocks every unsettled Starter PaymentIntent from canonical Stripe state',async t=>{
  for(const status of ['processing','requires_action','requires_capture','requires_confirmation','unknown_future_state'])await t.test(status,async()=>{
    const {state,store,service,fullSession}=await starterFixture();state.intent.status=status;state.sessions=[fullSession()];
    await store.transact([change('USER#alice','CHECKOUT',null,{plan:'starter',sessionId:'cs_starter',expiresAt:Date.now()-1})]);
    await assert.rejects(service.deleteAccount(user,{confirmation:'DELETE'}),error=>error.code==='CHECKOUT_PENDING');
    assert.ok(await store.get('USER#alice','ENTITLEMENT'));assert.equal(await store.get('ACCOUNT#deleted',createHash('sha256').update('alice').digest('hex')),null);
  });
});

test('canonical Starter processing blocks deletion without a local checkout record',async()=>{
  const {state,store,service,fullSession}=await starterFixture();state.intent.status='processing';state.sessions=[fullSession()];
  await assert.rejects(service.deleteAccount(user,{confirmation:'DELETE'}),error=>error.code==='CHECKOUT_PENDING');
  assert.ok(await store.get('USER#alice','ENTITLEMENT'));
});

test('terminal failed or canceled Starter settlement permits deletion after provider verification',async t=>{
  for(const status of ['requires_payment_method','canceled'])await t.test(status,async()=>{
    const {state,store,service,fullSession}=await starterFixture();state.intent.status=status;state.sessions=[fullSession()];
    await store.transact([change('USER#alice','CHECKOUT',null,{plan:'starter',sessionId:'cs_starter',expiresAt:Date.now()+3600000})]);
    assert.deepEqual(await service.deleteAccount(user,{confirmation:'DELETE'}),{deleted:true});assert.deepEqual(await store.list('USER#alice'),[]);
  });
});

test('a succeeded Starter payment is reconciled before account deletion',async()=>{
  const {state,store,billing,service,fullSession}=await starterFixture();state.sessions=[fullSession()];
  await store.transact([change('USER#alice','CHECKOUT',null,{plan:'starter',sessionId:'cs_starter',expiresAt:Date.now()-1})]);
  const original=billing.deletionState.bind(billing);let reconciled=false;
  billing.deletionState=async(...args)=>{const entitlement=(await store.get('USER#alice','ENTITLEMENT')).value;reconciled=entitlement.starter.everPaid===true&&entitlement.starter.purchaseId==='pi_starter';return original(...args);};
  assert.deepEqual(await service.deleteAccount(user,{confirmation:'DELETE'}),{deleted:true});assert.equal(reconciled,true);
});

test('legacy Starter offers still block deletion until settlement becomes terminal',async()=>{
  const {state,store,service,fullSession}=await starterFixture();state.intent.status='processing';
  state.session={metadata:{...fullSession().metadata,roleclue_offer:'starter-aud1-legacy',terms_version:'legacy-terms'},line_items:{data:[{price:{id:'price_starter_legacy'},quantity:1}]}};
  state.sessions=[fullSession()];
  await assert.rejects(service.deleteAccount(user,{confirmation:'DELETE'}),error=>error.code==='CHECKOUT_PENDING');assert.ok(await store.get('USER#alice','ENTITLEMENT'));
});

test('a succeeded legacy Starter payment is terminal and permits deletion without current-offer credit',async()=>{
  const {state,store,service,fullSession}=await starterFixture();
  state.session={metadata:{...fullSession().metadata,roleclue_offer:'starter-aud1-legacy',terms_version:'legacy-terms'},line_items:{data:[{price:{id:'price_starter_legacy'},quantity:1}]}};
  state.sessions=[fullSession()];
  assert.deepEqual(await service.deleteAccount(user,{confirmation:'DELETE'}),{deleted:true});
  assert.deepEqual(await store.list('USER#alice'),[]);
});

test('a succeeded legacy Starter intent for another customer cannot authorize deletion',async()=>{
  const {state,store,service,fullSession}=await starterFixture();state.intent.customer='cus_other';
  state.session={metadata:{...fullSession().metadata,roleclue_offer:'starter-aud1-legacy',terms_version:'legacy-terms'},line_items:{data:[{price:{id:'price_starter_legacy'},quantity:1}]}};
  state.sessions=[fullSession()];
  await assert.rejects(service.deleteAccount(user,{confirmation:'DELETE'}),error=>error.status===503);
  assert.ok(await store.get('USER#alice','ENTITLEMENT'));assert.equal(await store.get('USER#alice','DELETING'),null);
});

test('monthly allowance is consumed before starter and unused starter credit returns after the subscription ends',async()=>{
  const {state,store,billing}=await starterFixture();state.sessions=[{id:'cs_starter',mode:'payment',created:now,metadata:{roleclue_plan:'starter'}}];await billing.reconcile(user.sub,store);
  let row=await store.get('USER#alice','ENTITLEMENT');row.value.starter.used=1;row.value.status='active';row.value.subscriptionStatus='active';row.value.subscriptionId='sub_monthly';row.value.periodEnd=new Date(Date.now()+86400000).toISOString();row.value.paid={key:'sub_monthly:period',used:49,reserved:0};await store.transact([change(row.pk,row.sk,row,row.value)]);
  let view=billingView(row.value);assert.equal(view.plan,'monthly');assert.equal(view.remaining,1);assert.equal(row.value.starter.used,1);
  row=await store.get('USER#alice','ENTITLEMENT');row.value.status='canceled';row.value.subscriptionStatus='canceled';await store.transact([change(row.pk,row.sk,row,row.value)]);
  view=billingView(row.value);assert.equal(view.plan,'starter');assert.equal(view.remaining,1);
});

test('full starter refund or dispute revokes unused access without restoring starter eligibility',async()=>{
  for(const eventType of ['refund.updated','charge.dispute.created']){
    const {state,store,billing}=await starterFixture();state.sessions=[{id:'cs_starter',mode:'payment',created:now,metadata:{roleclue_plan:'starter'}}];await billing.reconcile(user.sub,store);
    if(eventType==='refund.updated')state.charge.refunded=true;else state.charge.disputed=true;
    const object=eventType==='refund.updated'?{charge:'ch_starter'}:{charge:'ch_starter'};
    await billing.webhook(JSON.stringify({id:`evt_${eventType}`,type:eventType,data:{object}}),'valid',store);
    const view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);
    assert.equal(view.canGenerate,false,eventType);assert.equal(view.canPurchaseStarter,false,eventType);assert.equal(view.starterStatus,eventType==='refund.updated'?'refunded':'disputed',eventType);assert.equal(view.status,view.starterStatus,eventType);
  }
});

test('a successful subscription payment permanently removes starter eligibility',async()=>{
  const {store,billing,service}=await fixture();await billing.reconcile(user.sub,store);
  const view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);assert.equal(view.subscriptionEverPaid,true);assert.equal(view.canPurchaseStarter,false);
  await assert.rejects(service.checkout(user,{plan:'starter',termsAccepted:true}),error=>error.code==='STARTER_NOT_ELIGIBLE');
});

test('historical paid invoices keep starter ineligible when the latest subscription invoice is unpaid',async()=>{
  const {state,store,billing,service}=await fixture();state.sub.latest_invoice='in_latest';state.invoice.status='open';state.invoiceHistory=[{id:'in_older_paid',status:'paid'}];
  state.paymentsByInvoice={in_latest:[],in_older_paid:[{...state.payments[0],id:'inpay_older',invoice:'in_older_paid'}]};
  await billing.reconcile(user.sub,store);
  const view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);assert.equal(view.subscriptionEverPaid,true);assert.equal(view.canPurchaseStarter,false);
  await assert.rejects(service.checkout(user,{plan:'starter',termsAccepted:true}),error=>error.code==='STARTER_NOT_ELIGIBLE');
});

test('a locally linked paid subscription on the previous catalog price stays managed without metadata and permanently blocks Starter',async()=>{
  const {state,store,billing,service}=await fixture();state.sub.items.data[0].price.id='price_previous_monthly';state.sub.metadata={};
  await billing.reconcile(user.sub,store);
  const view=billingView((await store.get('USER#alice','ENTITLEMENT')).value);
  assert.equal(view.subscriptionEverPaid,true);assert.equal(view.canPurchaseStarter,false);assert.equal(view.hasSubscription,true);assert.equal(view.canGenerate,false);
  await assert.rejects(service.checkout(user,{plan:'starter',termsAccepted:true}),error=>error.code==='STARTER_NOT_ELIGIBLE');
  assert.match((await service.checkout(user,{plan:'monthly',termsAccepted:true})).url,/billing\.stripe\.com/);
  await assert.rejects(service.deleteAccount(user,{confirmation:'DELETE'}),error=>error.code==='CANCEL_SUBSCRIPTION_FIRST');
});
