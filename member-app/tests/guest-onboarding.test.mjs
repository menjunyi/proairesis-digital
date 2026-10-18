import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MemoryStore, change} from '../server/store.mjs';
import {createService,GUEST_MAX_RESUME} from '../server/service.mjs';
import {createHttpHandler} from '../server/handler.mjs';
import {normalizeJob} from '../server/matching.mjs';
import {suggestProfileFromResume} from '../server/profile-extraction.mjs';

const sourceIp='203.0.113.24';
const resume=`Alice Example
Sydney NSW
Software Engineer

More than 5 years of professional experience building TypeScript and React applications. Deployed AWS services, maintained SQL databases and used Git for code review.`;
const parsed={text:resume,skills:['TypeScript','React','AWS','SQL','Git'],warnings:['Review extracted details before matching. Work rights and personal circumstances must be supplied by you.']};
const jobDescription='Build Australian software products with TypeScript and React. Deploy reliable AWS services, maintain SQL databases and use Git for code review. The engineering team documents delivery and expects applicants to explain relevant project experience.';
const jobs=Array.from({length:7},(_,index)=>normalizeJob({id:`job-${index}`,title:`Software Engineer ${index}`,company:'Direct Employer',country:'AU',roleFamily:'software',location:'Sydney, Australia',url:`https://boards.greenhouse.io/direct/jobs/${1000+index}`,description:jobDescription,skills:['TypeScript','React','AWS','SQL','Git'],requirements:{citizenship:'unknown',sponsorship:'unknown',clearance:'unknown'}},'freehire:greenhouse'));
const feed={status:async()=>({status:'not-configured'}),jobs:async()=>[]};
const guestSearch={available:async()=>true,search:async()=>({jobs,source:{name:'Freehire',status:'ready'}})};
const user={sub:'alice',email:'alice@example.test'},other={sub:'bob',email:'bob@example.test'};

async function setup({entitlement,...options}={}){
  const store=new MemoryStore();if(entitlement)await store.transact([change('USER#alice','ENTITLEMENT',null,entitlement)]);
  const service=createService({store,feed,guestSearch,guestRateSecret:'guest-rate-test-secret-32-bytes-long',extract:async()=>parsed,provider:{available:async()=>false},...options});
  return {store,service};
}

async function confirmedGuest(service){
  const started=await service.startGuest({situation:'actively-looking',location:'',remote:false},sourceIp);
  const uploaded=await service.guestResume({token:started.token,consent:true,filename:'resume.pdf',contentType:'application/pdf',dataBase64:Buffer.from('%PDF-test').toString('base64')},sourceIp);
  const profile={...uploaded.profile,name:'Alice Example',location:'Sydney, Australia',roleFamilies:['software'],workRights:'visa-limited',needsSponsorship:'later',visaLimitations:'Maximum 40 hours per week',confirmed:true};
  const saved=await service.saveGuestProfile({token:started.token,profile,termsAccepted:true,reviewed:true},sourceIp);
  return {started,uploaded,saved};
}

test('resume suggestions reduce typing without inferring eligibility or visa facts',()=>{
  const suggestion=suggestProfileFromResume(resume);
  assert.equal(suggestion.values.name,'Alice Example');assert.equal(suggestion.values.location,'Sydney');
  assert.equal(suggestion.values.yearsExperience,5);assert.ok(suggestion.values.skills.includes('TypeScript'));
  assert.ok(suggestion.values.roleFamilies.includes('software'));
  assert.deepEqual(suggestion.notInferred,['workRights','visaStatus','needsSponsorship','clearance','personalLimitations']);
  assert.equal('workRights' in suggestion.values,false);assert.equal('needsSponsorship' in suggestion.values,false);
});

test('resume extraction does not mistake an Australian location for a person name',()=>{
  const suggestion=suggestProfileFromResume('Sydney Australia\nSoftware Engineer\nBuilt TypeScript and React systems.');
  assert.equal(suggestion.values.name,'');
  assert.equal(suggestion.values.location,'Sydney Australia');
});

test('guest intake fails before resume collection when live search is not approved',async()=>{
  const store=new MemoryStore(),service=createService({store,feed,guestRateSecret:'guest-rate-test-secret-32-bytes-long',guestSearch:{available:async()=>false}});
  await assert.rejects(
    ()=>service.startGuest({situation:'exploring',location:'Sydney',remote:false},sourceIp),
    error=>error.status===503&&error.code==='JOB_SEARCH_NOT_CONFIGURED'&&/No resume was uploaded/.test(error.message),
  );
  assert.equal(store.items.size,0);
});

test('guest resume upload accepts 4 MiB and rejects the next byte before extraction',async()=>{
  let extracts=0;const {service}=await setup({extract:async()=>{extracts++;return parsed;}});
  const started=await service.startGuest({situation:'actively-looking',location:'Sydney',remote:false},'203.0.113.60');
  const request={token:started.token,consent:true,filename:'resume.pdf',contentType:'application/pdf'};
  const accepted=await service.guestResume({...request,dataBase64:Buffer.alloc(GUEST_MAX_RESUME,1).toString('base64')},'203.0.113.60');
  assert.equal(accepted.guest.stage,'profile');assert.equal(extracts,1);
  await assert.rejects(
    ()=>service.guestResume({...request,dataBase64:Buffer.alloc(GUEST_MAX_RESUME+1,1).toString('base64')},'203.0.113.60'),
    error=>error.status===413&&error.code==='RESUME_TOO_LARGE',
  );
  assert.equal(extracts,1);
});

test('guest flow stores only a token hash, returns five high-fit roles, preserves ignore and claims once',async()=>{
  const {store,service}=await setup(),{started,uploaded}=await confirmedGuest(service);
  assert.equal(uploaded.guest.profile.workRights,'unknown');
  assert.ok([...store.items.keys()].every(key=>!key.includes(started.token)));
  const tokenHash=createHash('sha256').update(started.token).digest('hex');
  assert.ok(await store.get(`GUEST#${tokenHash}`,'SESSION'));
  const searched=await service.searchGuest({token:started.token},sourceIp);
  assert.equal(searched.opportunities.length,5);assert.equal(searched.guest.opportunities.length,5);assert.equal(searched.guest.search.highFitCount,7);
  assert.ok(searched.opportunities.every(match=>match.score>=75&&match.job.australia&&match.job.roleFamily==='software'));
  const ignoredId=searched.opportunities[0].job.id,afterIgnore=await service.ignoreGuest({token:started.token,jobId:ignoredId},sourceIp);
  assert.equal(afterIgnore.opportunities.some(match=>match.job.id===ignoredId),false);assert.equal(afterIgnore.opportunities.length,5);
  const refreshed=await service.searchGuest({token:started.token},sourceIp),guestPkBeforeClaim=`GUEST#${tokenHash}`;
  assert.equal(refreshed.opportunities.some(match=>match.job.id===ignoredId),false);
  assert.ok(await store.get(guestPkBeforeClaim,`JOB#${ignoredId}`));
  const interestedId=refreshed.opportunities[0].job.id,claimed=await service.claimGuest(user,{token:started.token,interestedJobId:interestedId},sourceIp);
  assert.equal(claimed.application.id,interestedId);assert.equal(claimed.continuation.status,'awaiting-payment');
  assert.equal(claimed.savedOpportunityCount,5);
  await assert.rejects(()=>service.completeContinuation(user,{applicationId:interestedId}),error=>error.status===402);
  assert.equal((await store.get('USER#alice','PROFILE')).value.email,user.email);
  assert.equal((await store.get('USER#alice',`DECISION#${interestedId}`)).value.decision,'interested');
  assert.deepEqual((await store.get('RECOMMENDATION_REGISTRY','alice')).value,{userSub:'alice'});
  assert.ok(await store.get('USER#alice',`IMPORTED_JOB#${interestedId}`));assert.ok(await store.get('USER#alice',`APP#${interestedId}`));
  assert.equal((await service.applications(user)).applications[0].job.availability,'available');
  assert.equal((await store.list('USER#alice','IMPORTED_JOB#')).length,5);
  const guestPk=`GUEST#${tokenHash}`,scrubbed=(await store.get(guestPk,'SESSION')).value;
  assert.equal(scrubbed.profile,undefined);assert.equal(scrubbed.suggestions,undefined);assert.equal(scrubbed.resumeWarnings,undefined);assert.equal((await store.list(guestPk,'JOB#')).length,0);
  const claimedSession=await service.readGuest({token:started.token},sourceIp);assert.equal(claimedSession.profile,null);assert.deepEqual(claimedSession.opportunities,[]);
  const claimReference=(await store.list('USER#alice','GUEST_CLAIM#'))[0];assert.equal(claimReference.value.guestPartition,guestPk);
  const remaining=await service.opportunities(user);assert.equal(remaining.opportunities.length,5);
  assert.ok(remaining.opportunities.every(item=>item.job.id!==interestedId));
  const ignored=await service.opportunities(user,true);assert.equal(ignored.opportunities.length,1);assert.equal(ignored.opportunities[0].job.id,ignoredId);
  const replay=await service.claimGuest(user,{token:started.token,interestedJobId:interestedId},sourceIp);
  assert.equal(replay.application.id,interestedId);assert.equal((await store.list('USER#alice','APP#')).length,1);
  await assert.rejects(()=>service.abandonGuest(user,{token:started.token},sourceIp),error=>error.code==='GUEST_ALREADY_CLAIMED');
  await assert.rejects(()=>service.claimGuest(other,{token:started.token,interestedJobId:interestedId},'203.0.113.25'),error=>error.code==='GUEST_ALREADY_CLAIMED');
});

test('guest claim stays below the transaction limit after fifty ignored and thirty current roles',async()=>{
  const {store,service}=await setup(),{started}=await confirmedGuest(service);
  const searched=await service.searchGuest({token:started.token},sourceIp);
  const template=searched.opportunities[0],guestPk=`GUEST#${createHash('sha256').update(started.token).digest('hex')}`;
  const ignoredIds=Array.from({length:50},(_,index)=>`ignored-${index}`),currentIds=Array.from({length:30},(_,index)=>`current-${index}`);
  const sessionRow=await store.get(guestPk,'SESSION'),session={...sessionRow.value,stage:'opportunities',ignoredJobIds:ignoredIds,opportunityIds:currentIds};
  const rows=[...ignoredIds,...currentIds].map(id=>change(guestPk,`JOB#${id}`,null,{assessment:{...template,job:{...template.job,id,url:`https://boards.greenhouse.io/direct/jobs/${encodeURIComponent(id)}`}},searchedAt:new Date().toISOString()}));
  await store.transact([change(guestPk,'SESSION',sessionRow,session),...rows]);
  const claimed=await service.claimGuest(user,{token:started.token,interestedJobId:currentIds[0]},sourceIp);
  assert.equal(claimed.application.id,currentIds[0]);
  assert.equal((await store.list('USER#alice','DECISION#')).filter(row=>row.value.decision==='ignored').length,30);
  assert.equal((await store.list(guestPk,'JOB#')).length,0);
});

test('account deletion removes every linked guest partition before identity revocation',async()=>{
  let identityCalls=0;const context={store:null,guestPk:null};const identity={async remove(){identityCalls++;assert.deepEqual(await context.store.list('USER#alice'),[]);assert.deepEqual(await context.store.list(context.guestPk),[]);}},fixture=await setup({identity}),{store,service}=fixture,{started}=await confirmedGuest(service),searched=await service.searchGuest({token:started.token},sourceIp),id=searched.opportunities[0].job.id,guestPk=`GUEST#${createHash('sha256').update(started.token).digest('hex')}`;context.store=store;context.guestPk=guestPk;await service.claimGuest(user,{token:started.token,interestedJobId:id},sourceIp);assert.ok(await store.get(guestPk,'SESSION'));await service.deleteAccount(user,{confirmation:'DELETE'});assert.deepEqual(await store.list(guestPk),[]);assert.equal(identityCalls,1);
});

test('existing account can abandon a conflicting guest continuation without copying guest data',async()=>{
  const {store,service}=await setup(),{started,saved}=await confirmedGuest(service),searched=await service.searchGuest({token:started.token},sourceIp);
  const id=searched.opportunities[0].job.id;
  const existing={...saved.profile,email:user.email,resumeText:'Alice Existing\nMelbourne VIC\nData Engineer\nTen years building Python data platforms.',location:'Melbourne, Australia',roleFamilies:['data'],guestClaimedAt:undefined};
  await store.transact([change('USER#alice','PROFILE',null,existing)]);
  await assert.rejects(()=>service.claimGuest(user,{token:started.token,interestedJobId:id},sourceIp),error=>error.code==='ACCOUNT_PROFILE_EXISTS');

  const handler=createHttpHandler(service),response=await handler({rawPath:'/api/guest/abandon',rawQueryString:'',headers:{},body:JSON.stringify({token:started.token}),requestContext:{http:{method:'POST',sourceIp},authorizer:{jwt:{claims:{sub:user.sub,email:user.email,email_verified:'true',token_use:'id'}}}}});
  assert.equal(response.statusCode,200);const first=JSON.parse(response.body);
  assert.equal(first.abandoned,true);assert.equal(first.account.profile.resumeText,existing.resumeText);
  assert.equal(first.account.continuation,null);
  const guestRow=await store.get(`GUEST#${createHash('sha256').update(started.token).digest('hex')}`,'SESSION');
  assert.equal(guestRow.value.stage,'abandoned');assert.ok(guestRow.value.abandonedAt);assert.equal(guestRow.value.profile,undefined);
  assert.equal(await store.get('USER#alice',`IMPORTED_JOB#${id}`),null);assert.equal(await store.get('USER#alice',`APP#${id}`),null);
  assert.equal(await store.get('USER#alice',`DECISION#${id}`),null);assert.equal(await store.get('USER#alice','CONTINUATION'),null);

  const replay=await service.abandonGuest(user,{token:started.token},sourceIp);
  assert.equal(replay.abandoned,true);assert.equal(replay.account.profile.resumeText,existing.resumeText);
  const scrubbed=(await store.get(`GUEST#${createHash('sha256').update(started.token).digest('hex')}`,'SESSION')).value;
  assert.equal(scrubbed.profile,undefined);assert.equal(scrubbed.resumeWarnings,undefined);assert.equal((await store.list(guestRow.pk,'JOB#')).length,0);
  const reference=(await store.list('USER#alice','GUEST_CLAIM#'))[0];assert.equal(reference.value.guestPartition,guestRow.pk);assert.equal(reference.value.abandoned,true);
  await assert.rejects(()=>service.abandonGuest(other,{token:started.token},'203.0.113.25'),error=>error.code==='GUEST_ALREADY_RESOLVED');
  await assert.rejects(()=>service.claimGuest(user,{token:started.token,interestedJobId:id},sourceIp),error=>error.code==='GUEST_ALREADY_RESOLVED');
  await assert.rejects(()=>service.ignoreGuest({token:started.token,jobId:id},sourceIp),error=>error.code==='GUEST_ALREADY_RESOLVED');
});

test('account deletion removes an abandoned guest resume partition',async()=>{
  const {store,service}=await setup(),{started,saved}=await confirmedGuest(service),searched=await service.searchGuest({token:started.token},sourceIp);
  const existing={...saved.profile,email:user.email,resumeText:'A different confirmed account resume.',location:'Melbourne, Australia',roleFamilies:['data']};
  await store.transact([change('USER#alice','PROFILE',null,existing)]);
  await service.abandonGuest(user,{token:started.token},sourceIp);
  const guestPk=`GUEST#${createHash('sha256').update(started.token).digest('hex')}`;
  assert.ok(await store.get(guestPk,'SESSION'));assert.ok(searched.opportunities.length);
  await service.deleteAccount(user,{confirmation:'DELETE'});
  assert.deepEqual(await store.list(guestPk),[]);
});

test('guest situation makes the chosen area essential and remote an inclusive alternative',async()=>{
  const {service}=await setup();
  const started=await service.startGuest({situation:'exploring',location:'Melbourne',remote:true},'203.0.113.40');
  const uploaded=await service.guestResume({token:started.token,consent:true,filename:'resume.pdf',contentType:'application/pdf',dataBase64:Buffer.from('%PDF-test').toString('base64')},'203.0.113.40');
  assert.deepEqual(uploaded.profile.preferences.locations,['Melbourne']);
  assert.equal(uploaded.profile.preferences.locationsRequired,true);
  assert.equal(uploaded.profile.preferences.includeRemote,true);
  assert.deepEqual(uploaded.profile.preferences.workplaceTypes,[]);
});

test('continuation becomes ready only after authoritative billing state can generate',async()=>{
  const {store,service}=await setup(),{started}=await confirmedGuest(service),searched=await service.searchGuest({token:started.token},sourceIp);
  const id=searched.opportunities[0].job.id;await service.claimGuest(user,{token:started.token,interestedJobId:id},sourceIp);
  assert.equal((await service.account(user)).continuation.status,'awaiting-payment');
  const entitlement={free:{used:0,reserved:0},starter:{key:'starter-key',purchaseId:'pi_paid',status:'active',everPaid:true,used:0,reserved:0},paid:{key:null,used:0,reserved:0},subscriptionEverPaid:false,status:'none',customerId:'cus_test',subscriptionId:null,periodStart:null,periodEnd:null};
  await store.transact([change('USER#alice','ENTITLEMENT',null,entitlement)]);
  const account=await service.account(user);assert.equal(account.continuation.status,'ready');assert.equal(account.continuation.pendingApplicationId,id);assert.ok(account.continuation.readyAt);
  await assert.rejects(()=>service.completeContinuation(user,{applicationId:'another'}),error=>error.code==='CONTINUATION_MISMATCH');
  const complete=await service.completeContinuation(user,{applicationId:id});assert.equal(complete.applicationId,id);assert.equal(complete.continuation,null);
  assert.equal((await service.account(user)).continuation,null);assert.deepEqual(await service.completeContinuation(user,{applicationId:id}),{completed:true,continuation:null});
});

test('public guest routes need no JWT, reject query tokens, and claim still requires verified auth',async()=>{
  const {service}=await setup(),handler=createHttpHandler(service);
  const request=(path,method='POST',body={},extra={})=>handler({rawPath:path,rawQueryString:'',headers:{},body:JSON.stringify(body),requestContext:{http:{method,sourceIp}},...extra});
  const start=await request('/api/guest/start','POST',{situation:'exploring',location:'Melbourne',remote:true});
  assert.equal(start.statusCode,200);const token=JSON.parse(start.body).token;
  assert.equal((await request('/api/guest/session','POST',{token})).statusCode,200);
  const query=await handler({rawPath:'/api/guest/session',rawQueryString:`token=${token}`,headers:{},body:'{}',requestContext:{http:{method:'POST',sourceIp}}});
  assert.equal(query.statusCode,400);assert.equal(JSON.parse(query.body).error.code,'INVALID_QUERY');
  assert.equal((await request('/api/guest/claim','POST',{token,interestedJobId:'x'})).statusCode,401);
  assert.equal((await request('/api/guest/abandon','POST',{token})).statusCode,401);
});

test('CloudFront source-port changes cannot rotate the guest start rate identity',async()=>{
  const {service}=await setup(),handler=createHttpHandler(service,{originSecret:'synthetic-origin-secret'});
  const request=(address,port)=>handler({rawPath:'/api/guest/start',rawQueryString:'',headers:{'x-roleclue-origin':'synthetic-origin-secret','cloudfront-viewer-address':`${address}:${port}`},body:JSON.stringify({situation:'exploring',location:'Sydney',remote:false}),requestContext:{http:{method:'POST',sourceIp:'192.0.2.90'}}});
  for(let index=0;index<10;index++)assert.equal((await request('198.51.100.24',40000+index)).statusCode,200);
  const limited=await request('198.51.100.24',50000);assert.equal(limited.statusCode,429);assert.equal(JSON.parse(limited.body).error.code,'GUEST_RATE_LIMIT');
  assert.equal((await request('198.51.100.25',50000)).statusCode,200);
});
