import test from 'node:test';
import assert from 'node:assert/strict';
import {argumentsFor,connect,main} from '../scripts/validate-stripe-sandbox.mjs';

function fixture({account='037169690315',stripeAccount='acct_1UPXnSRvysAJPVoo',key='sk_test_SYNTHETICONLY',config}={}){
  const calls=[];
  return {calls,identity:{Account:account},ssm:{async send(command){calls.push(command.input.Name);if(command.input.Name.endsWith('/stripe-secret-key'))return {Parameter:{Value:key}};if(config)return {Parameter:{Value:JSON.stringify(config)}};throw Object.assign(new Error('Missing'),{name:'ParameterNotFound'});}},stripe:{accounts:{async retrieve(){calls.push('stripe-account');return {id:stripeAccount};}}}};
}

test('Stripe sandbox CLI requires explicit apply and a bounded run identifier for mutations',()=>{
  assert.equal(argumentsFor([]).command,'inspect');
  assert.throws(()=>argumentsFor(['setup']),error=>error.code==='APPLY_REQUIRED');
  assert.throws(()=>argumentsFor(['validate','--apply']),error=>error.code==='RUN_ID_REQUIRED');
  assert.throws(()=>argumentsFor(['validate','--apply','--run-id','secret token']),error=>error.code==='RUN_ID');
  assert.throws(()=>argumentsFor(['setup','--apply','--apply']),error=>error.code==='ARGUMENTS');
  assert.equal(argumentsFor(['validate','--apply','--run-id','synthetic-run-001']).runId,'synthetic-run-001');
});

test('help makes no external requests',async()=>{
  const deps=fixture();assert.ok((await main(['--help'],deps)).help);assert.equal(deps.calls.length,0);
});

test('wrong AWS account cannot retrieve a Stripe key',async()=>{
  const deps=fixture({account:'523438072936'});await assert.rejects(connect(deps),error=>error.code==='AWS_ACCOUNT_MISMATCH');assert.equal(deps.calls.length,0);
});

test('live keys and the live parent Stripe account are refused before any configuration access',async()=>{
  let deps=fixture({key:'sk_live_SYNTHETICONLY'});await assert.rejects(connect(deps),error=>error.code==='SANDBOX_KEY_REQUIRED');assert.equal(deps.calls.length,1);
  deps=fixture({stripeAccount:'acct_1UPXnE2M7eo9K7Bo'});await assert.rejects(connect(deps),error=>error.code==='STRIPE_ACCOUNT_MISMATCH');assert.equal(deps.calls.length,2);
});

test('saved configuration cannot substitute another Stripe account',async()=>{
  const deps=fixture({config:{mode:'sandbox',awsAccount:'037169690315',stripeAccount:'acct_wrong'}});await assert.rejects(connect(deps),error=>error.code==='CONFIG_ACCOUNT_MISMATCH');
});

test('read-only inspection never returns credentials or writes configuration',async()=>{
  const deps=fixture();const result=await main(['inspect'],deps);
  assert.equal(result.sandboxVerified,true);assert.equal(result.configPresent,false);assert.equal(JSON.stringify(result).includes('SYNTHETICONLY'),false);
  assert.deepEqual(deps.calls,['/roleclue/member-app/sandbox/stripe-secret-key','stripe-account','/roleclue/member-app/sandbox/billing-config']);
});
