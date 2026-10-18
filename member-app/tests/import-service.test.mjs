import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {MemoryStore,change} from '../server/store.mjs';
import {blankEntitlement,createService} from '../server/service.mjs';

const alice={sub:'alice',email:'alice@example.test'},bob={sub:'bob',email:'bob@example.test'};
const profile={name:'Synthetic QA',resumeText:'Built TypeScript and React interfaces. Deployed AWS services. Used Git and SQL databases to support software delivery.',roleFamilies:['software'],yearsExperience:4,location:'Sydney',workRights:'unknown',needsSponsorship:'unknown',clearance:'unknown',preferences:{},confirmed:true,consentAt:new Date().toISOString(),termsAcceptedAt:new Date().toISOString()};
const input={title:'Software Engineer',company:'Synthetic QA Employer',url:'https://example.test/jobs/one',location:'Sydney, Australia',roleFamily:'software',description:'This is a synthetic test description, not a vacancy. Build TypeScript and React interfaces with our software team. Deploy reliable AWS services and maintain SQL databases. Use Git for code review and collaborate with stakeholders to document delivery.',australiaConfirmed:true,permissionConfirmed:true,workplace:'hybrid'};
async function fixture(){const store=new MemoryStore(),entitlement=blankEntitlement();entitlement.starter={key:'cs_starter',purchaseId:'pi_starter',sessionId:'cs_starter',status:'active',everPaid:true,used:0,reserved:0};await store.transact([change('USER#alice','PROFILE',null,profile),change('USER#alice','ENTITLEMENT',null,entitlement),change('USER#bob','PROFILE',null,profile)]);let count=0;const service=createService({store,requireAiConsent:true,feed:{status:async()=>({status:'ready'}),jobs:async()=>[]},provider:{available:async()=>true,generate:async()=>{count++;return 'Dear hiring team, My resume describes demonstrated TypeScript and React work with AWS services, Git and SQL databases. I would welcome a discussion about this relevant experience. Kind regards, Synthetic QA.';}}});return{store,service,calls:()=>count};}

test('private imports support matching, ignore, undo and idempotent interest without a feed',async()=>{
  const {service}=await fixture(),result=await service.importOpportunity(alice,input);
  assert.equal(result.accepted,true);assert.equal(result.assessment.highFit,true);
  const id=result.opportunity.job.id;
  assert.equal((await service.opportunities(alice)).opportunities.length,1);
  assert.equal((await service.opportunities(bob)).opportunities.length,0);
  await assert.rejects(()=>service.decision(bob,id,{decision:'interested'}),e=>e.code==='JOB_NOT_FOUND');
  await service.decision(alice,id,{decision:'ignored'});
  await service.importOpportunity(alice,input);
  assert.equal((await service.opportunities(alice)).opportunities.length,0);
  assert.equal((await service.opportunities(alice,true)).opportunities.length,1);
  await service.decision(alice,id,{decision:'undecided'});
  await service.decision(alice,id,{decision:'interested'});
  await service.decision(alice,id,{decision:'interested'});
  const app=(await service.applications(alice)).applications;
  assert.equal(app.length,1);assert.equal(app[0].status,'interested');assert.equal(app[0].job.availability,'unknown');
});

test('weak imports return reasons without storage and concurrent duplicate import counts once',async()=>{
  const {service,store}=await fixture();
  const rejected=await service.importOpportunity(alice,{...input,roleFamily:'data'});
  assert.equal(rejected.accepted,false);assert.ok(rejected.assessment.reason);assert.equal((await store.list('USER#alice','IMPORTED_JOB#')).length,0);
  await Promise.all(Array.from({length:5},()=>service.importOpportunity(alice,input)));
  assert.equal((await store.get('USER#alice','IMPORT_COUNT')).value.count,1);
});

test('a rejected re-import replaces stale current evidence but preserves the application snapshot',async()=>{
  const {service}=await fixture();const first=await service.importOpportunity(alice,input),id=first.opportunity.job.id;
  await service.decision(alice,id,{decision:'interested'});await service.decision(alice,id,{decision:'undecided'});
  const rejected=await service.importOpportunity(alice,{...input,description:input.description+' At least 10 years of software experience required.'});
  assert.equal(rejected.accepted,false);assert.equal((await service.opportunities(alice)).opportunities.length,0);
  assert.equal((await service.applications(alice)).applications[0].job.description,input.description);
});

test('imported jobs can generate twice with Starter; a third generation needs subscription',async()=>{
  const {service,calls}=await fixture();const {opportunity}=await service.importOpportunity(alice,input),id=opportunity.job.id;
  await service.decision(alice,id,{decision:'interested'});
  await assert.rejects(()=>service.generate(alice,id,randomUUID()),e=>e.code==='AI_CONSENT_REQUIRED');assert.equal(calls(),0);
  const key=randomUUID(),result=await service.generate(alice,id,key,{aiProcessingConfirmed:true});
  assert.equal(result.generation.status,'succeeded');assert.equal(result.billing.used,1);assert.ok(result.generation.aiConsentAt);
  await service.generate(alice,id,key);assert.equal(calls(),1);
  await service.generate(alice,id,randomUUID(),{aiProcessingConfirmed:true});assert.equal(calls(),2);
  await assert.rejects(()=>service.generate(alice,id,randomUUID(),{aiProcessingConfirmed:true}),e=>e.code==='UPGRADE_REQUIRED');
});

test('exports exclude internal processing snapshots, leases, keys and checkout URLs',async()=>{
  const {service,store}=await fixture();
  for(const [sk,value] of [['UPLOAD_STATE',{private:'state'}],['CHECKOUT',{url:'https://checkout.example.test/private'}],['GEN#pending',{id:'pending',status:'pending',profileSnapshot:profile,jobSnapshot:input,lease:'private'}]])await store.transact([change('USER#alice',sk,null,value)]);
  const out=await service.exportAccount(alice);assert.equal(out.schemaVersion,1);
  assert.deepEqual(out.records.map(x=>x.type),['ENTITLEMENT','GEN#pending','PROFILE']);
  assert.deepEqual(out.records.find(x=>x.type==='GEN#pending').value,{id:'pending',status:'pending'});
  assert.equal(JSON.stringify(out.records.find(x=>x.type==='ENTITLEMENT')).includes('pi_starter'),false);
});

test('status and note updates omit stale embedded letters and preserve generated documents',async()=>{
  const {service}=await fixture();const {opportunity}=await service.importOpportunity(alice,input),id=opportunity.job.id;
  await service.decision(alice,id,{decision:'interested'});
  await service.generate(alice,id,randomUUID(),{aiProcessingConfirmed:true});
  const original=(await service.applications(alice)).applications[0].letters;
  assert.equal(original.length,1);
  for(const input of [{status:'preparing'},{notes:'Reviewed synthetic QA draft'}]){
    const result=await service.updateApplication(alice,id,input);
    assert.equal(Object.hasOwn(result.application,'letters'),false);
    assert.deepEqual((await service.applications(alice)).applications[0].letters,original);
  }
});

test('confirmed profiles reject contradictory eligibility and empty mandatory preferences',async()=>{
  const {service}=await fixture();
  for(const delta of [{workRights:'citizen',needsSponsorship:'yes'},{preferences:{locationsRequired:true,locations:[]}},{preferences:{workplaceRequired:true,workplaceTypes:[]}},{preferences:{minimumSalaryRequired:true,minimumSalary:null}}])await assert.rejects(()=>service.saveProfile(alice,{...profile,...delta}),e=>e.code==='INVALID_PROFILE');
});
