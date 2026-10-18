import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,change} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHttpHandler,processAiAuthorityReview,processDailyBillingReconciliation,processDailyRefresh,processGenerationBatch} from '../server/handler.mjs';
import {normalizeJob} from '../server/matching.mjs';

const alice={sub:'alice',email:'alice@example.test'},bob={sub:'bob',email:'bob@example.test'};
const profileFor=user=>({name:user.sub,email:user.email,resumeText:'Built TypeScript and React products. Deployed AWS services, maintained SQL data and used Git for reliable team delivery.',skills:['TypeScript','React','AWS','SQL','Git'],roleFamilies:['software'],yearsExperience:5,situation:'actively-looking',location:'Sydney',workRights:'visa',needsSponsorship:'later',clearance:'unknown',preferences:{locations:[],locationsRequired:false,includeRemote:true,workplaceTypes:[],employmentTypes:[],roleTitles:[],minimumSalary:null,salaryPeriod:'year',seniority:[],relocation:false,limitations:''},confirmed:true,consentAt:'2026-10-01T00:00:00.000Z',termsAcceptedAt:'2026-10-01T00:00:00.000Z',termsVersion:'test'});
const jobsFor=(prefix,count=40)=>Array.from({length:count},(_,index)=>normalizeJob({id:`${prefix}-${index}`,title:`Software Engineer ${index}`,company:`${prefix} Employer`,country:'AU',roleFamily:'software',location:'Sydney, Australia',url:`https://example.test/${prefix}/${index}`,description:'Build Australian software products with TypeScript and React. Deploy reliable AWS services, maintain SQL databases and use Git for code review. The team expects applicants to describe relevant delivery experience.',skills:['TypeScript','React','AWS','SQL','Git'],requirements:{citizenship:'unknown',sponsorship:'unknown',clearance:'unknown'}},'freehire:greenhouse'));
const feed={status:async()=>({status:'not-configured',lastUpdatedAt:null}),jobs:async()=>[],refresh:async()=>({skipped:true})};

async function fixture(){
  const store=new MemoryStore();
  await store.transact([change('USER#alice','PROFILE',null,profileFor(alice)),change('USER#bob','PROFILE',null,profileFor(bob))]);
  const calls={alice:0,bob:0},bobJobs=jobsFor('bob');let failing=false,legacyFailing=false,aliceJobs=jobsFor('alice');const queued=[];
  const guestSearch={available:async()=>true,async search(profile){calls[profile.email.startsWith('alice')?'alice':'bob']++;if(failing)throw Object.assign(Error('Source unavailable'),{status:503,code:'JOB_SEARCH_UNAVAILABLE'});return {jobs:profile.email.startsWith('alice')?aliceJobs:bobJobs,source:{name:'Freehire',status:'ready',fetchedAt:new Date().toISOString()}};}};
  const legacyFeed={status:async()=>{if(legacyFailing)throw Error('Legacy source unavailable');return feed.status();},jobs:async()=>{if(legacyFailing)throw Error('Legacy source unavailable');return feed.jobs();},refresh:feed.refresh};
  const service=createService({store,feed:legacyFeed,guestSearch,dispatch:async message=>{queued.push(message);}});
  return {store,service,calls,queued,setFailing:value=>{failing=value;},setLegacyFailing:value=>{legacyFailing=value;},setAliceJobs:value=>{aliceJobs=value;}};
}

async function makeStale(store,sub='alice'){
  const row=await store.get(`USER#${sub}`,'RECOMMENDATION_STATE');
  await store.transact([change(row.pk,row.sk,row,{...row.value,refreshedAt:new Date(Date.now()-21*60*60*1000).toISOString(),retryAfter:null})]);
}

test('daily recommendation caches are tenant-bound, capped at 30 and reused until stale',async()=>{
  const {store,service,calls}=await fixture();
  const first=await service.opportunities(alice);assert.equal(first.opportunities.length,30);assert.equal(first.feed.status,'ready');assert.equal(calls.alice,1);
  await service.opportunities(alice);assert.equal(calls.alice,1);
  const other=await service.opportunities(bob);assert.equal(other.opportunities.length,30);assert.equal(calls.bob,1);
  assert.ok(first.opportunities.every(item=>item.job.company==='alice Employer'));
  assert.ok(other.opportunities.every(item=>item.job.company==='bob Employer'));
  await assert.rejects(()=>service.decision(bob,first.opportunities[0].job.id,{decision:'interested'}),error=>error.code==='JOB_NOT_FOUND');
  assert.equal((await store.list('USER#alice','RECOMMENDATION_JOB#')).length,30);
  assert.equal((await store.list('USER#bob','RECOMMENDATION_JOB#')).length,30);
  const registry=await store.list('RECOMMENDATION_REGISTRY');assert.deepEqual(registry.map(row=>row.sk),['alice','bob']);assert.ok(registry.every(row=>Object.keys(row.value).join(',')==='userSub'));
  await makeStale(store);await service.opportunities(alice);assert.equal(calls.alice,2);
});

test('profile confirmation registers a user and an unconfirmed profile unregisters them',async()=>{
  const store=new MemoryStore(),draft={...profileFor(alice),confirmed:false};await store.transact([change('USER#alice','PROFILE',null,draft)]);
  const service=createService({store,feed,guestSearch:{available:async()=>true,search:async()=>({jobs:[],source:{name:'Freehire'}})}});
  await service.saveProfile(alice,{...draft,confirmed:true,termsAccepted:true});assert.deepEqual((await store.get('RECOMMENDATION_REGISTRY','alice')).value,{userSub:'alice'});
  await service.saveProfile(alice,{confirmed:false});assert.equal(await store.get('RECOMMENDATION_REGISTRY','alice'),null);
});

test('a source failure retains the last verified cache and backs off automatic retries',async()=>{
  const {store,service,calls,setFailing,setAliceJobs}=await fixture();const first=await service.opportunities(alice);await makeStale(store);setFailing(true);
  const degraded=await service.opportunities(alice);assert.equal(degraded.opportunities.length,first.opportunities.length);assert.equal(degraded.feed.status,'degraded');assert.match(degraded.feed.message,/last verified shortlist/i);assert.equal(calls.alice,2);
  await service.opportunities(alice);assert.equal(calls.alice,2);
  const forced=await service.refreshOpportunities(alice,{});assert.equal(forced.opportunities.length,30);assert.equal(forced.feed.status,'degraded');assert.equal(calls.alice,3);
  setFailing(false);setAliceJobs(jobsFor('invalid-oversized',101));const invalid=await service.refreshOpportunities(alice,{});assert.equal(invalid.opportunities.length,30);assert.equal(invalid.feed.status,'degraded');assert.equal(calls.alice,4);
});

test('cached jobs support decisions while refresh preserves decisions and application snapshots',async()=>{
  const {store,service,setAliceJobs,setLegacyFailing}=await fixture();const first=await service.opportunities(alice),interested=first.opportunities[0],ignored=first.opportunities[1];
  await service.decision(alice,interested.job.id,{decision:'interested'});await service.decision(alice,ignored.job.id,{decision:'ignored'});
  assert.equal((await service.applications(alice)).applications[0].job.availability,'available');
  setAliceJobs(jobsFor('replacement',8));await service.refreshOpportunities(alice,{});
  assert.equal((await store.get('USER#alice',`DECISION#${interested.job.id}`)).value.decision,'interested');
  const ignoredDecision=(await store.get('USER#alice',`DECISION#${ignored.job.id}`)).value;
  assert.equal(ignoredDecision.decision,'ignored');assert.equal(ignoredDecision.assessmentSnapshot.job.id,ignored.job.id);
  assert.ok((await service.opportunities(alice)).opportunities.every(item=>item.job.id!==interested.job.id&&item.job.id!==ignored.job.id));
  const ignoredAfterRefresh=await service.opportunities(alice,true);assert.equal(ignoredAfterRefresh.opportunities.some(item=>item.job.id===ignored.job.id),true);
  setLegacyFailing(true);
  const application=(await service.applications(alice)).applications[0];assert.equal(application.job.id,interested.job.id);assert.equal(application.job.availability,'unknown');
  await service.decision(alice,ignored.job.id,{decision:'undecided'});
  setLegacyFailing(false);
  assert.equal((await service.opportunities(alice,true)).opportunities.some(item=>item.job.id===ignored.job.id),false);
  assert.equal((await service.opportunities(alice)).opportunities.some(item=>item.job.id===ignored.job.id),true);
  assert.equal((await store.get('USER#alice',`DECISION#${ignored.job.id}`)).value.assessmentSnapshot.job.id,ignored.job.id);
});

test('refresh HTTP route is authenticated, forced and accepts only an empty object',async()=>{
  const {service,calls}=await fixture(),http=createHttpHandler(service),auth={jwt:{claims:{sub:alice.sub,email:alice.email,email_verified:'true',token_use:'id'}}};
  const request=body=>http({rawPath:'/api/opportunities/refresh',headers:{},body:JSON.stringify(body),requestContext:{http:{method:'POST'},authorizer:auth}});
  assert.equal((await request({unexpected:true})).statusCode,400);assert.equal(calls.alice,0);
  const response=await request({});assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).opportunities.length,30);assert.equal(calls.alice,1);
  assert.equal((await http({rawPath:'/api/opportunities/refresh',headers:{},body:'{}',requestContext:{http:{method:'POST'}}})).statusCode,401);
});

test('confirmed users are queued daily, recommendation messages are strict and deletion unregisters',async()=>{
  const {store,service,queued}=await fixture();await service.account(alice);await service.account(bob);
  const scheduled=await processDailyRefresh(service,feed);assert.equal(scheduled.recommendations.queued,2);assert.deepEqual(queued.map(item=>item.kind),['recommendation-refresh','recommendation-refresh']);
  const calls=[];const worker={async runGeneration(sub,id){calls.push(['generation',sub,id]);},async refreshRecommendationsForSub(sub){calls.push(['recommendation',sub]);}};const generationId='a'.repeat(64),records=[
    {eventSource:'aws:sqs',messageId:'generation',body:JSON.stringify({kind:'generate',userSub:'alice',generationId})},
    {eventSource:'aws:sqs',messageId:'recommendation',body:JSON.stringify({kind:'recommendation-refresh',userSub:'bob'})},
    {eventSource:'aws:sqs',messageId:'invalid',body:JSON.stringify({kind:'recommendation-refresh',userSub:'bob',email:'bob@example.test'})},
  ];
  const previous=console.error;console.error=()=>{};try{assert.deepEqual(await processGenerationBatch(worker,{Records:records}),{batchItemFailures:[{itemIdentifier:'invalid'}]});}finally{console.error=previous;}
  assert.deepEqual(calls,[['generation','alice',generationId],['recommendation','bob']]);
  await service.deleteAccount(alice,{confirmation:'DELETE'});assert.equal(await store.get('RECOMMENDATION_REGISTRY','alice'),null);assert.ok(await store.get('RECOMMENDATION_REGISTRY','bob'));
});

test('daily recommendation fanout is paginated and continues through SQS without a registry ceiling',async()=>{
  const store=new MemoryStore(),queued=[];
  for(let first=0;first<121;first+=25){
    const changes=[];for(let index=first;index<Math.min(121,first+25);index++){const sub=`user-${String(index).padStart(4,'0')}`;changes.push(change('RECOMMENDATION_REGISTRY',sub,null,{userSub:sub}));}
    await store.transact(changes);
  }
  const service=createService({store,feed,guestSearch:{available:async()=>true},dispatch:async message=>queued.push(message)});
  const first=await service.queueRecommendationRefreshes();assert.deepEqual(first,{queued:50,continued:true});
  for(let page=1;page<3;page++){
    const fanout=queued.filter(message=>message.kind==='recommendation-fanout').at(-1);
    const record={eventSource:'aws:sqs',messageId:`fanout-${page}`,body:JSON.stringify(fanout)};
    assert.deepEqual(await processGenerationBatch(service,{Records:[record]}),{batchItemFailures:[]});
  }
  const refreshes=queued.filter(message=>message.kind==='recommendation-refresh');
  assert.equal(refreshes.length,121);assert.equal(new Set(refreshes.map(message=>message.userSub)).size,121);
  assert.equal(queued.filter(message=>message.kind==='recommendation-fanout').length,2);
});

test('daily scheduler still queues user refreshes when the legacy feed refresh fails',async()=>{
  const {service,queued}=await fixture();await service.account(alice);const brokenFeed={async refresh(){throw Error('legacy source failed');}};
  await assert.rejects(()=>processDailyRefresh(service,brokenFeed),/legacy source failed/);assert.deepEqual(queued,[{kind:'recommendation-refresh',userSub:'alice'}]);
});

test('daily workflows emit heartbeat logs only after successful fanout',async()=>{
  const logs=[];
  const recommendations={async refresh(){return {ok:true};}},service={
    async queueRecommendationRefreshes(){return {queued:3,continued:false};},
    async queueBillingReconciliations(){return {queued:2,continued:true};},
  };
  await processDailyRefresh(service,recommendations,value=>logs.push(value));
  await processDailyBillingReconciliation(service,value=>logs.push(value));
  assert.deepEqual(logs,[
    '{"event":"daily_refresh_completed","queued":3,"continued":false}',
    '{"event":"daily_billing_reconciliation_completed","queued":2,"continued":true}',
  ]);
});

test('AI authority review emits the exact operational event without service initialization',()=>{
  const logs=[];assert.deepEqual(processAiAuthorityReview(value=>logs.push(value)),{ok:true});assert.deepEqual(logs,['{"event":"ai_authority_review_required","pricingExpiresAt":"2026-11-11T13:00:00.000Z"}']);
});
