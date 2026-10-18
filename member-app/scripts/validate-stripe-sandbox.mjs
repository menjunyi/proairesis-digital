import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import Stripe from 'stripe';
import {SSMClient,GetParameterCommand,PutParameterCommand} from '@aws-sdk/client-ssm';
import {createBilling} from '../server/adapters.mjs';
import {MemoryStore,change} from '../server/store.mjs';
import {blankEntitlement,billingView,createService,TERMS_VERSION} from '../server/service.mjs';

const ACCOUNT='037169690315',REGION='ap-southeast-2',PROFILE='proairesis-management';
const STRIPE_ACCOUNT='acct_1UPXnSRvysAJPVoo';
const KEY_PARAM='/roleclue/member-app/sandbox/stripe-secret-key';
const CONFIG_PARAM='/roleclue/member-app/sandbox/billing-config';
const execFileAsync=promisify(execFile);
const check=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:undefined;
export const monthlySandboxOfferMetadata=(runId,userSub,priceId)=>({
  app:'roleclue',synthetic_test:'true',run_id:runId,roleclue_user_id:userSub,roleclue_plan:'monthly',
  roleclue_price_id:priceId,roleclue_offer:'monthly-aud20-50-v2',terms_version:TERMS_VERSION,
});
export function argumentsFor(argv){
  const result={command:'inspect'};
  for(let i=0;i<argv.length;i++){
    const arg=argv[i];
    if(['inspect','setup','validate','checkout'].includes(arg)){check(result.command==='inspect'&&!result.explicitCommand,'ARGUMENTS');result.command=arg;result.explicitCommand=true;}
    else if(arg==='--apply'){check(!result.apply,'ARGUMENTS');result.apply=true;}
    else if(arg==='--run-id'){check(!result.runId&&/^[a-z0-9-]{8,60}$/.test(argv[i+1]??''),'RUN_ID');result.runId=argv[++i];}
    else if(arg==='--help')result.help=true;
    else check(false,'ARGUMENTS');
  }
  if(result.command!=='inspect'&&!result.help)check(result.apply===true,'APPLY_REQUIRED');
  if(['validate','checkout'].includes(result.command))check(result.runId,'RUN_ID_REQUIRED');
  return result;
}

export async function connect(deps={}){
  const identity=deps.identity??JSON.parse((await execFileAsync('/Users/junyi/.local/bin/aws',['sts','get-caller-identity','--profile',PROFILE,'--region',REGION,'--output','json','--no-cli-pager'],{timeout:20000,maxBuffer:16384})).stdout);
  check(identity.Account===ACCOUNT,'AWS_ACCOUNT_MISMATCH');
  const ssm=deps.ssm??new SSMClient({region:REGION,profile:PROFILE,maxAttempts:2});
  const key=(await ssm.send(new GetParameterCommand({Name:KEY_PARAM,WithDecryption:true}))).Parameter?.Value;
  check(typeof key==='string'&&/^sk_test_[A-Za-z0-9]+$/.test(key),'SANDBOX_KEY_REQUIRED');
  const stripe=deps.stripe??new Stripe(key,{apiVersion:'2026-09-30.endive',maxNetworkRetries:1,timeout:10000});
  const account=await stripe.accounts.retrieve();check(account.id===STRIPE_ACCOUNT,'STRIPE_ACCOUNT_MISMATCH');
  let config={schema:1,mode:'sandbox',stripeAccount:STRIPE_ACCOUNT,awsAccount:ACCOUNT,region:REGION,keyParameter:KEY_PARAM};
  try{const existing=JSON.parse((await ssm.send(new GetParameterCommand({Name:CONFIG_PARAM,WithDecryption:true}))).Parameter.Value);check(existing.mode==='sandbox'&&existing.stripeAccount===STRIPE_ACCOUNT&&existing.awsAccount===ACCOUNT,'CONFIG_ACCOUNT_MISMATCH');config=existing;}catch(error){if(error.name!=='ParameterNotFound')throw error;}
  async function save(value){
    check(value.mode==='sandbox'&&value.stripeAccount===STRIPE_ACCOUNT&&value.awsAccount===ACCOUNT,'CONFIG_ACCOUNT_MISMATCH');
    const json=JSON.stringify(value);check(Buffer.byteLength(json)<=4096,'CONFIG_TOO_LARGE');
    await ssm.send(new PutParameterCommand({Name:CONFIG_PARAM,Type:'SecureString',Tier:'Standard',KeyId:'alias/aws/ssm',Overwrite:true,Value:json,Description:'RoleClue sandbox-only Stripe configuration and synthetic acceptance evidence; never use for live billing.'}));
    const saved=(await ssm.send(new GetParameterCommand({Name:CONFIG_PARAM,WithDecryption:true}))).Parameter?.Value;
    check(saved===json,'PRIVATE_READBACK_FAILED');
  }
  return {stripe,account,config,save};
}

async function setup(context){
  const {stripe,save}=context;let {config}=context;
  const metadata={app:'roleclue',scope:'sandbox',synthetic_test:'true'};
  const monthlyDescription='Sandbox: 50 successful cover-letter generations per monthly billing period.';
  let product=config.productId?await stripe.products.retrieve(config.productId):await stripe.products.create({name:'RoleClue Plus',description:monthlyDescription,metadata},{idempotencyKey:'roleclue-sandbox-product-v1'});
  check(product.livemode===false&&product.metadata.app==='roleclue','PRODUCT_SCOPE');
  if(product.description!==monthlyDescription)product=await stripe.products.update(product.id,{description:monthlyDescription,metadata},{idempotencyKey:'roleclue-sandbox-product-v2-monthly-50'});
  config={...config,productId:product.id};await save(config);
  const price=config.monthly50PriceId?await stripe.prices.retrieve(config.monthly50PriceId):await stripe.prices.create({product:product.id,currency:'aud',unit_amount:2000,recurring:{interval:'month',interval_count:1,usage_type:'licensed'},tax_behavior:'inclusive',lookup_key:'roleclue-plus-sandbox-aud20-monthly-50-v2',metadata:{...metadata,successful_generations:'50',catalog_version:'starter-50-v2'}},{idempotencyKey:'roleclue-sandbox-price-v2-monthly-50'});
  check(price.livemode===false&&price.currency==='aud'&&price.unit_amount===2000&&price.recurring?.interval==='month'&&price.recurring.interval_count===1&&price.metadata.successful_generations==='50','PRICE_SCOPE');
  const starterDescription='Sandbox: two lifetime cover-letter generations, one successful purchase per eligible account.';
  let starterProduct=config.starterProductId?await stripe.products.retrieve(config.starterProductId):await stripe.products.create({name:'RoleClue Starter',description:starterDescription,metadata},{idempotencyKey:'roleclue-sandbox-starter-product-v1'});
  check(starterProduct.livemode===false&&starterProduct.metadata.app==='roleclue','PRODUCT_SCOPE');
  if(starterProduct.description!==starterDescription)starterProduct=await stripe.products.update(starterProduct.id,{description:starterDescription,metadata},{idempotencyKey:'roleclue-sandbox-starter-product-v1-description'});
  const starterPrice=config.starterPriceId?await stripe.prices.retrieve(config.starterPriceId):await stripe.prices.create({product:starterProduct.id,currency:'aud',unit_amount:100,tax_behavior:'inclusive',lookup_key:'roleclue-starter-sandbox-aud1-two-lifetime-v1',metadata:{...metadata,successful_generations:'2',catalog_version:'starter-50-v2'}},{idempotencyKey:'roleclue-sandbox-price-v1-starter-2'});
  check(starterPrice.livemode===false&&starterPrice.currency==='aud'&&starterPrice.unit_amount===100&&!starterPrice.recurring&&starterPrice.metadata.successful_generations==='2','PRICE_SCOPE');
  config={...config,priceId:price.id,monthly50PriceId:price.id,starterProductId:starterProduct.id,starterPriceId:starterPrice.id,currency:'aud',amount:2000,interval:'month',successfulGenerations:50,starterAmount:100,starterSuccessfulGenerations:2,taxBehavior:'inclusive',automaticTaxEnabled:false};await save(config);
  const portal=config.portalConfigurationId?await stripe.billingPortal.configurations.retrieve(config.portalConfigurationId):await stripe.billingPortal.configurations.create({name:'RoleClue sandbox membership',business_profile:{headline:'RoleClue membership',privacy_policy_url:'https://app.proairesis.digital/privacy.html',terms_of_service_url:'https://app.proairesis.digital/terms.html'},default_return_url:'http://localhost:3002/?billing=return#account',features:{customer_update:{enabled:false},invoice_history:{enabled:true},payment_method_update:{enabled:true},subscription_cancel:{enabled:true,mode:'at_period_end',proration_behavior:'none'},subscription_update:{enabled:false}},metadata},{idempotencyKey:'roleclue-sandbox-portal-v1'});
  check(portal.livemode===false&&portal.features.subscription_cancel.enabled&&portal.features.subscription_cancel.mode==='at_period_end'&&!portal.features.subscription_update.enabled,'PORTAL_SCOPE');
  config={...config,portalConfigurationId:portal.id,portalIsDefault:portal.is_default,configuredAt:new Date().toISOString()};await save(config);
  context.config=config;return {configured:true,productId:product.id,priceId:price.id,starterProductId:starterProduct.id,starterPriceId:starterPrice.id,portalConfigurationId:portal.id,portalIsDefault:portal.is_default,privateReadbackVerified:true};
}

async function fixture(context,customer,userSub){
  const store=new MemoryStore(),user={sub:userSub};
  const entitlement={...blankEntitlement(),customerId:customer.id};
  await store.transact([change(`USER#${userSub}`,'ENTITLEMENT',null,entitlement),change('BILLING#customers',customer.id,null,{userSub})]);
  const billing=await createBilling({NODE_ENV:'test',STRIPE_SECRET_KEY_PARAM:KEY_PARAM,STRIPE_WEBHOOK_SECRET_PARAM:'sandbox-not-used-by-reconciliation',STRIPE_PRICE_ID:context.config.priceId,STRIPE_STARTER_PRICE_ID:context.config.starterPriceId,STRIPE_PORTAL_CONFIGURATION_ID:context.config.portalConfigurationId,SITE_URL:'http://localhost:3002'},{client:context.stripe});
  const service=createService({store,billing,feed:{async status(){return {status:'unconfigured'};}},provider:{available:()=>false}});
  const reconcile=async()=>{await billing.reconcile(userSub,store);return billingView((await store.get(`USER#${userSub}`,'ENTITLEMENT')).value);};
  return {store,user,billing,service,reconcile};
}

async function checkout(context,runId){
  const {stripe,save}=context;check(context.config.priceId&&context.config.starterPriceId&&context.config.portalConfigurationId,'SETUP_REQUIRED');
  const userSub=`roleclue-sandbox-hosted-${runId}`;
  const previous=context.config.hostedCheckout;
  if(previous?.runId===runId&&previous.sessionId){
    const session=await stripe.checkout.sessions.retrieve(previous.sessionId);
    check(session.livemode===false&&session.customer===previous.customerId&&session.client_reference_id===userSub,'CHECKOUT_SCOPE');
    return {hostedCheckoutReady:session.status==='open',reused:true,sessionId:session.id,customerId:previous.customerId,status:session.status,expiresAt:session.expires_at};
  }
  const customer=await stripe.customers.create({name:'RoleClue synthetic hosted-checkout QA',metadata:{app:'roleclue',synthetic_test:'true',run_id:runId,roleclue_user_id:userSub}},{idempotencyKey:`roleclue-sandbox-hosted-customer-${runId}`});
  check(customer.livemode===false,'CUSTOMER_SCOPE');
  const attempt={runId,customerId:customer.id,userSub,status:'preparing',attemptedAt:new Date().toISOString()};
  await save({...context.config,hostedCheckout:attempt});
  const f=await fixture(context,customer,userSub);
  try{await f.service.checkout(f.user,{termsAccepted:true});}catch(error){
    if(/terms.of.service|terms_of_service/i.test(error.message??'')){await save({...context.config,hostedCheckout:{...attempt,status:'blocked_terms_url'}});throw Object.assign(new Error('CHECKOUT_TERMS_URL_REQUIRED'),{code:'CHECKOUT_TERMS_URL_REQUIRED'});}
    if(/activat|business.?name|business.?address/i.test(error.message??'')){await save({...context.config,hostedCheckout:{...attempt,status:'blocked_account_details'}});throw Object.assign(new Error('CHECKOUT_ACCOUNT_DETAILS_REQUIRED'),{code:'CHECKOUT_ACCOUNT_DETAILS_REQUIRED'});}
    throw error;
  }
  const record=(await f.store.get(`USER#${userSub}`,'CHECKOUT')).value;
  check(record.sessionId?.startsWith('cs_test_'),'CHECKOUT_SCOPE');
  const session=await stripe.checkout.sessions.retrieve(record.sessionId);
  check(session.livemode===false&&session.amount_total===2000&&session.currency==='aud'&&session.consent_collection?.terms_of_service==='required'&&session.automatic_tax?.enabled===false&&session.total_details?.amount_tax===0,'CHECKOUT_SCOPE');
  const hostedCheckout={runId,customerId:customer.id,userSub,sessionId:session.id,expiresAt:session.expires_at,createdAt:new Date().toISOString(),status:session.status,termsRequired:true};
  await save({...context.config,hostedCheckout});
  return {hostedCheckoutReady:true,sessionId:session.id,customerId:customer.id,amountTotal:session.amount_total,currency:session.currency,expiresAt:session.expires_at,privateReadbackVerified:true};
}

async function waitClock(stripe,id){
  for(let attempt=0;attempt<20;attempt++){const clock=await stripe.testHelpers.testClocks.retrieve(id);if(clock.status==='ready')return clock;await new Promise(resolve=>setTimeout(resolve,1500));}
  throw Object.assign(new Error('CLOCK_PENDING'),{code:'CLOCK_PENDING'});
}

async function validate(context,runId,progress){
  const {stripe,save}=context;check(context.config.priceId&&context.config.starterPriceId&&context.config.portalConfigurationId,'SETUP_REQUIRED');
  check(!(context.config.validation?.runId===runId&&context.config.validation?.completedAt),'RUN_ALREADY_COMPLETE');
  const previous=context.config.validation?.runId===runId?context.config.validation:null;
  const frozenTime=previous?.frozenTime??Math.floor(Date.now()/1000);
  check(Number.isSafeInteger(frozenTime),'RUN_STATE_INVALID');
  await save({...context.config,validation:{...previous,runId,frozenTime,checks:previous?.checks??[]}});
  const metadata={app:'roleclue',synthetic_test:'true',run_id:runId};
  const offerMetadata=userSub=>monthlySandboxOfferMetadata(runId,userSub,context.config.priceId);
  const clock=await stripe.testHelpers.testClocks.create({frozen_time:frozenTime,name:`RoleClue synthetic ${runId}`},{idempotencyKey:`roleclue-clock-${runId}`});
  await save({...context.config,validation:{...previous,runId,frozenTime,clockId:clock.id,checks:previous?.checks??[]}});
  const lifecycleUserSub=`roleclue-sandbox-lifecycle-${runId}`;
  const customer=await stripe.customers.create({name:'RoleClue synthetic lifecycle QA',test_clock:clock.id,payment_method:'pm_card_visa',invoice_settings:{default_payment_method:'pm_card_visa'},metadata:{...metadata,roleclue_user_id:lifecycleUserSub}},{idempotencyKey:`roleclue-customer-${runId}`});
  check(customer.livemode===false,'CUSTOMER_SCOPE');
  let subscription=await stripe.subscriptions.create({customer:customer.id,items:[{price:context.config.priceId,quantity:1}],payment_behavior:'error_if_incomplete',collection_method:'charge_automatically',metadata:offerMetadata(lifecycleUserSub)},{idempotencyKey:`roleclue-subscription-${runId}`});
  check(subscription.livemode===false,'SUBSCRIPTION_SCOPE');
  const f=await fixture(context,customer,lifecycleUserSub),evidence={...previous,runId,frozenTime,clockId:clock.id,customerId:customer.id,subscriptionId:subscription.id,checks:previous?.checks??[]};
  const done=name=>evidence.checks.includes(name);
  const record=async name=>{if(!done(name))evidence.checks.push(name);await save({...context.config,validation:evidence});progress({check:name,status:'passed'});};
  let view=await f.reconcile();
  if(!done('paid_activation_50')){assert.equal(view.plan,'monthly');assert.equal(view.remaining,50);await record('paid_activation_50');}
  if(!done('duplicate_reconciliation_preserves_usage')){
    const row=await f.store.get(`USER#${f.user.sub}`,'ENTITLEMENT');row.value.paid.used=9;await f.store.transact([change(row.pk,row.sk,row,row.value)]);
    view=await f.reconcile();assert.equal(view.remaining,41);view=await f.reconcile();assert.equal(view.remaining,41);await record('duplicate_reconciliation_preserves_usage');
  }
  if(!done('period_end_cancellation_retains_current_access')){
    subscription=await stripe.subscriptions.update(subscription.id,{cancel_at_period_end:true},{idempotencyKey:`roleclue-period-end-${runId}`});
    view=await f.reconcile();assert.equal(view.cancelAtPeriodEnd,true);assert.equal(view.remaining,41);await record('period_end_cancellation_retains_current_access');
  }
  if(!done('configured_portal_session')){
    const portal=await stripe.billingPortal.sessions.create({customer:customer.id,configuration:context.config.portalConfigurationId,return_url:'http://localhost:3002/?billing=return#account'});
    check(typeof portal.url==='string'&&portal.configuration===context.config.portalConfigurationId,'PORTAL_SESSION');await record('configured_portal_session');
  }
  if(!done('paid_renewal_resets_50')){
    subscription=await stripe.subscriptions.update(subscription.id,{cancel_at_period_end:false},{idempotencyKey:`roleclue-restore-renewal-${runId}`});
    const end=subscription.items.data[0].current_period_end;
    await stripe.testHelpers.testClocks.advance(clock.id,{frozen_time:end+60},{idempotencyKey:`roleclue-advance-renewal-${runId}`});await waitClock(stripe,clock.id);
    subscription=await stripe.subscriptions.retrieve(subscription.id,{expand:['latest_invoice']});
    let invoice=subscription.latest_invoice;
    if(invoice.status==='draft')invoice=await stripe.invoices.finalizeInvoice(invoice.id,{auto_advance:false},{idempotencyKey:`roleclue-finalize-renewal-${runId}`});
    if(invoice.status==='open')invoice=await stripe.invoices.pay(invoice.id,{}, {idempotencyKey:`roleclue-pay-renewal-default-${runId}`});
    check(invoice.status==='paid','RENEWAL_NOT_PAID');view=await f.reconcile();assert.equal(view.remaining,50);await record('paid_renewal_resets_50');
  }
  if(!done('full_refund_revokes_access_retains_subscription')){
    subscription=await stripe.subscriptions.retrieve(subscription.id,{expand:['latest_invoice']});
    const payments=await stripe.invoicePayments.list({invoice:subscription.latest_invoice.id,limit:100});
    const intent=payments.data.find(payment=>payment.payment?.payment_intent)?.payment.payment_intent;
    check(typeof intent==='string','REFUND_PAYMENT_NOT_FOUND');
    const refund=await stripe.refunds.create({payment_intent:intent,metadata},{idempotencyKey:`roleclue-refund-${runId}`});
    check(refund.status==='succeeded','REFUND_PENDING');view=await f.reconcile();assert.equal(view.status,'refunded');assert.equal(view.canGenerate,false);assert.equal(view.hasSubscription,true);await record('full_refund_revokes_access_retains_subscription');
  }
  if(!done('refunded_subscription_blocks_account_deletion')){await assert.rejects(f.service.deleteAccount(f.user,{confirmation:'DELETE'}),error=>error.code==='CANCEL_SUBSCRIPTION_FIRST');await record('refunded_subscription_blocks_account_deletion');}
  if(!done('ended_subscription_removes_access')){await stripe.subscriptions.cancel(subscription.id,{invoice_now:false,prorate:false},{idempotencyKey:`roleclue-end-refunded-${runId}`});view=await f.reconcile();assert.equal(view.hasSubscription,false);await record('ended_subscription_removes_access');}
  const failureUserSub=`roleclue-sandbox-declined-${runId}`;
  const failureCustomer=await stripe.customers.create({name:'RoleClue synthetic declined-payment QA',metadata:{...metadata,roleclue_user_id:failureUserSub}},{idempotencyKey:`roleclue-declined-customer-empty-${runId}`});
  const failedSubscription=await stripe.subscriptions.create({customer:failureCustomer.id,items:[{price:context.config.priceId,quantity:1}],payment_behavior:'default_incomplete',collection_method:'charge_automatically',metadata:offerMetadata(failureUserSub)},{idempotencyKey:`roleclue-declined-subscription-empty-${runId}`});
  check(failedSubscription.livemode===false,'SUBSCRIPTION_SCOPE');
  const failedPayments=await stripe.invoicePayments.list({invoice:failedSubscription.latest_invoice,limit:100});
  const failedIntent=failedPayments.data.find(payment=>payment.payment?.payment_intent)?.payment.payment_intent;
  check(typeof failedIntent==='string','DECLINED_PAYMENT_NOT_FOUND');
  await assert.rejects(stripe.paymentIntents.confirm(failedIntent,{payment_method:'pm_card_chargeDeclined',return_url:'http://localhost:3002/'},{idempotencyKey:`roleclue-confirm-decline-${runId}`}),error=>error.code==='card_declined');
  const failedFixture=await fixture(context,failureCustomer,failureUserSub);
  const failureView=await failedFixture.reconcile();assert.equal(failureView.canGenerate,false);assert.notEqual(failureView.plan,'monthly');await record('failed_initial_payment_grants_no_paid_access');
  await stripe.subscriptions.cancel(failedSubscription.id,{invoice_now:false,prorate:false},{idempotencyKey:`roleclue-end-declined-${runId}`});
  evidence.failureCustomerId=failureCustomer.id;evidence.failureSubscriptionId=failedSubscription.id;evidence.completedAt=new Date().toISOString();evidence.syntheticSubscriptionsEnded=true;
  await save({...context.config,validation:evidence});
  return {validated:true,...evidence,privateReadbackVerified:true};
}

export async function main(argv=process.argv.slice(2),deps={}){
  const options=argumentsFor(argv);
  if(options.help)return {help:'Sandbox only: inspect (read-only), setup --apply, validate --apply --run-id UNIQUE_ID, checkout --apply --run-id UNIQUE_ID. Exact AWS/Stripe/key/account guards; no production app mutation, live money or AI calls. Results are stored privately in the approved sandbox billing-config parameter.'};
  const context=await connect(deps);
  if(options.command==='inspect')return {
    sandboxVerified:true,awsAccount:ACCOUNT,stripeAccount:STRIPE_ACCOUNT,
    configPresent:Boolean(context.config.priceId&&context.config.starterPriceId&&context.config.portalConfigurationId),
    chargesEnabled:context.account.charges_enabled,
    termsUrlConfigured:Boolean(context.account.settings?.checkout?.terms_of_service_url),
    productId:context.config.productId,priceId:context.config.priceId,
    starterProductId:context.config.starterProductId,starterPriceId:context.config.starterPriceId,
    portalConfigurationId:context.config.portalConfigurationId,
    validation:context.config.validation?{
      runId:context.config.validation.runId,
      completedAt:context.config.validation.completedAt,
      checks:context.config.validation.checks??[],
      syntheticSubscriptionsEnded:context.config.validation.syntheticSubscriptionsEnded===true,
    }:null,
  };
  if(options.command==='setup')return setup(context);
  if(options.command==='checkout')return checkout(context,options.runId);
  return validate(context,options.runId,deps.progress??(value=>process.stdout.write(`${JSON.stringify(value)}\n`)));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().then(value=>process.stdout.write(`${JSON.stringify(value)}\n`)).catch(error=>{process.stderr.write(`${JSON.stringify({ok:false,errorType:safeId(error.name),code:safeId(error.code)??'SANDBOX_OPERATION_FAILED',parameter:safeId(error.param),status:error.statusCode})}\n`);process.exitCode=1;});
}
