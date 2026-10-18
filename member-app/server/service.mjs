import {createHash,randomUUID} from 'node:crypto';
import {change,retryConflict,Conflict} from './store.mjs';
import {assess,assessWithReasons,ROLE_FAMILIES} from './matching.mjs';
import {normalizeImportedJob} from './imported-jobs.mjs';
import {extractResume,MAX_RESUME,ResumeError} from './resume.mjs';
import {suggestProfileFromResume} from './profile-extraction.mjs';
import {GUEST_RATE_LIMITS,guestExpiry,guestPartition,guestTokenHash,newGuestToken,publicGuest,sourceIpHash} from './guest-onboarding.mjs';

export class HttpError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const fail=(status,code,message)=>{throw new HttpError(status,code,message);};
const pkOf=user=>`USER#${user.sub}`;
const tombstoneKey=sub=>createHash('sha256').update(sub).digest('hex');
const iso=()=>new Date().toISOString();
const PAGE_BYTES=1024*1024;
const CURSOR_HEADROOM=1024;
const DISPATCH_LEASE_MS=30*1000;
const DISPATCH_REPAIR_MS=5*60*1000;
const WORKER_LEASE_MS=2*60*1000;
const RECOMMENDATION_STALE_MS=20*60*60*1000;
const RECOMMENDATION_RETRY_MS=15*60*1000;
const RECOMMENDATION_REGISTRY_PK='RECOMMENDATION_REGISTRY';
const RECOMMENDATION_STATE_SK='RECOMMENDATION_STATE';
const RECOMMENDATION_JOB_PREFIX='RECOMMENDATION_JOB#';
export const GENERATION_OUTBOX_PK='GENERATION_OUTBOX';
const GENERATION_REPAIR_PAGE_SIZE=50;
const GENERATION_BACKFILL_PK='SYSTEM#GENERATION_OUTBOX';
const GENERATION_BACKFILL_SK='PENDING_BACKFILL_V1';
const GENERATION_BACKFILL_PAGE_SIZE=100;
const GENERATION_BACKFILL_MAX_PAGES=20;
export const GUEST_MAX_RESUME=4*1024*1024;
const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const isPlainObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const futureIso=(value,now=Date.now())=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)>now;
const recentIso=(value,maxAge,now=Date.now())=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)>now-maxAge;
const validUserSub=value=>typeof value==='string'&&value.length>0&&value.length<=160&&!/[\u0000-\u001f\u007f]/.test(value);
const validGenerationId=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const generationTenantHash=sub=>createHash('sha256').update(sub).digest('hex');
const generationOutboxKey=(sub,id)=>`${generationTenantHash(sub)}#${id}`;
const generationRepairCursor=sk=>Buffer.from(sk,'utf8').toString('base64url');
function generationRepairAfter(cursor){
  if(cursor===null)return null;
  try{
    if(typeof cursor!=='string'||cursor.length<1||cursor.length>2048||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();
    const value=Buffer.from(cursor,'base64url');
    if(value.toString('base64url')!==cursor||value.length<1||value.length>1024)throw Error();
    const after=value.toString('utf8');if(!Buffer.from(after,'utf8').equals(value))throw Error();return after;
  }catch{throw Error('Invalid generation repair cursor');}
}
const profileFingerprint=profile=>createHash('sha256').update(JSON.stringify({
  resumeText:profile.resumeText,skills:profile.skills,roleFamilies:profile.roleFamilies,yearsExperience:profile.yearsExperience,
  situation:profile.situation,location:profile.location,workRights:profile.workRights,needsSponsorship:profile.needsSponsorship,
  clearance:profile.clearance,visaLimitations:profile.visaLimitations,preferences:profile.preferences,
})).digest('hex');

function paginationState(user,scope,rows,cursor){
  const tenant=createHash('sha256').update(user.sub).digest('hex');
  const snapshot=createHash('sha256').update(JSON.stringify(rows.map(row=>[row.sk,row.revision]))).digest('hex');
  if(cursor===undefined)return {v:1,scope,tenant,snapshot,index:0,letterOffset:0,at:iso()};
  let state;
  try{
    if(typeof cursor!=='string'||cursor.length>1500||!/^[A-Za-z0-9_-]+$/.test(cursor))throw Error();
    const bytes=Buffer.from(cursor,'base64url');
    if(bytes.toString('base64url')!==cursor)throw Error();
    state=JSON.parse(bytes.toString('utf8'));
    if(!state||Array.isArray(state)||Object.keys(state).sort().join(',')!=='at,index,letterOffset,scope,snapshot,tenant,v'
      ||state.v!==1||state.scope!==scope||state.tenant!==tenant||!/^[a-f0-9]{64}$/.test(state.snapshot)
      ||!Number.isSafeInteger(state.index)||state.index<0||state.index>10000
      ||!Number.isSafeInteger(state.letterOffset)||state.letterOffset<0||state.letterOffset>10000
      ||typeof state.at!=='string'||state.at.length!==24||!Number.isFinite(Date.parse(state.at)))throw Error();
  }catch{fail(400,'INVALID_CURSOR','This page cursor is invalid for your account or request.');}
  if(state.snapshot!==snapshot)fail(409,'PAGINATION_STALE','Your account data changed while loading. Reload to start again.');
  return state;
}
const nextPageCursor=state=>Buffer.from(JSON.stringify(state)).toString('base64url');
function assertPageFits(value){if(jsonBytes(value)>PAGE_BYTES)fail(413,'PAGE_TOO_LARGE','An account record is too large to return safely. Contact support.');return value;}
const blankProfile=(email,name='')=>({name:typeof name==='string'?name.trim().slice(0,250):'',email,resumeText:'',skills:[],roleFamilies:[],yearsExperience:null,situation:'actively-looking',location:'',workRights:'unknown',needsSponsorship:'unknown',clearance:'unknown',preferences:{locations:[],locationsRequired:false,includeRemote:false,workplaceTypes:[],employmentTypes:[],roleTitles:[],minimumSalary:null,salaryPeriod:'year',seniority:[],relocation:false,limitations:''},confirmed:false,consentAt:null});
export const TERMS_VERSION='roleclue-v1-2026-10-12-starter-50';
export const MONTHLY_GENERATION_LIMIT=50;
export const STARTER_GENERATION_LIMIT=2;
export const hasManagedSubscription=e=>Boolean(e.subscriptionId&&['active','trialing','past_due','unpaid','incomplete','paused','refunded','payment_pending'].includes(e.subscriptionStatus??e.status));
export const blankEntitlement=()=>({
  // Retained only so generations reserved before the paid-starter migration can finish safely.
  free:{used:0,reserved:0},
  starter:{key:null,purchaseId:null,status:'none',used:0,reserved:0},
  paid:{key:null,used:0,reserved:0},subscriptionEverPaid:false,status:'none',customerId:null,subscriptionId:null,periodStart:null,periodEnd:null,
});
export function billingView(e=blankEntitlement(),now=Date.now()) {
  const monthlyActive=e.status==='active'&&Date.parse(e.periodEnd)>now;
  const starter=e.starter??{key:null,purchaseId:null,status:'none',used:0,reserved:0};
  const starterPurchased=starter.everPaid===true||Boolean(starter.purchaseId??starter.key);
  const starterActive=Boolean(starter.key&&starter.purchaseId)&&starter.status==='active';
  const canPurchaseStarter=!starterPurchased&&e.subscriptionEverPaid!==true;
  const plan=monthlyActive?'monthly':starterActive?'starter':'free';
  const bucket=monthlyActive?(e.paid??{used:0,reserved:0}):starterActive?starter:{used:0,reserved:0};
  const limit=monthlyActive?MONTHLY_GENERATION_LIMIT:starterActive?STARTER_GENERATION_LIMIT:0;
  const used=Number.isInteger(bucket.used)?bucket.used:0,reserved=Number.isInteger(bucket.reserved)?bucket.reserved:0;
  const remaining=Math.max(0,limit-used-reserved);
  const effectiveStatus=starterActive&&!monthlyActive?'active':!monthlyActive&&['refunded','disputed'].includes(starter.status)?starter.status:e.status;
  return {
    plan,status:effectiveStatus,subscriptionStatus:e.subscriptionStatus??e.status,
    hasSubscription:hasManagedSubscription(e),cancelAtPeriodEnd:e.cancelAtPeriodEnd===true,
    priceAud:plan==='starter'?1:20,monthlyPriceAud:20,starterPriceAud:1,limit,used,reserved,remaining,
    periodEnd:monthlyActive?e.periodEnd:null,canGenerate:remaining>0,canManageBilling:Boolean(e.customerId),
    starterStatus:starter.status??'none',starterPurchased,starterEverPaid:starterPurchased,subscriptionEverPaid:e.subscriptionEverPaid===true,
    canPurchaseStarter,canBuyStarter:canPurchaseStarter,starterEligible:canPurchaseStarter,
    reason:remaining?null:monthlyActive?'ALLOWANCE_EXHAUSTED':starterPurchased?'UPGRADE_REQUIRED':'STARTER_REQUIRED',
  };
}
function safeString(v,max=250){return typeof v==='string'?v.trim().slice(0,max):'';}
function strings(v,max=20){return Array.isArray(v)?v.filter(x=>typeof x==='string').map(x=>safeString(x,200)).filter(Boolean).slice(0,max):[];}
function mergeResumeEvidence(existing,email,parsed){
  const base={...blankProfile(email),...existing},suggested=suggestProfileFromResume(parsed.text,parsed.skills).values;
  const location=safeString(base.location)||suggested.location,preferences={...blankProfile(email).preferences,...base.preferences};
  if(!preferences.locations?.length&&location)preferences.locations=[location];
  if(!preferences.roleTitles?.length&&suggested.roleTitles.length)preferences.roleTitles=suggested.roleTitles;
  return {...base,
    name:safeString(base.name)?base.name:suggested.name,
    location,
    yearsExperience:Number.isFinite(base.yearsExperience)?base.yearsExperience:suggested.yearsExperience,
    roleFamilies:base.roleFamilies?.length?base.roleFamilies:suggested.roleFamilies,
    preferences,
    resumeText:parsed.text,skills:parsed.skills,
  };
}
function assertProfileSize(profile){if(Buffer.byteLength(JSON.stringify(profile),'utf8')>220*1024)fail(413,'PROFILE_TOO_LARGE','The combined resume and preferences are too large. Shorten your profile and try again.');}
function cleanProfile(input,existing,email){
  if(!isPlainObject(input))fail(400,'INVALID_PROFILE','Send a valid profile object.');
  const p={...existing,email};
  if(input.termsAccepted===true){p.termsAcceptedAt=iso();p.termsVersion=TERMS_VERSION;}
  if('marketingConsent'in input)p.marketingConsent=input.marketingConsent===true;
  for(const k of ['name','location','clearance'])if(k in input)p[k]=safeString(input[k]);
  if('visaLimitations'in input)p.visaLimitations=safeString(input.visaLimitations,1000);
  if('resumeText'in input){if(typeof input.resumeText!=='string'||Buffer.byteLength(input.resumeText)>180000)fail(400,'INVALID_PROFILE','Resume text is too long.');p.resumeText=input.resumeText;}
  for(const [k,allowed]of Object.entries({situation:['actively-looking','exploring','graduate','career-change','returning'],workRights:['citizen','permanent-resident','visa','visa-unrestricted','visa-limited','none','unknown'],needsSponsorship:['yes','no','now','later','unknown']})){if(k in input){if(!allowed.includes(input[k]))fail(400,'INVALID_PROFILE',`Choose a valid ${k}.`);p[k]=input[k];}}
  if('skills'in input)p.skills=strings(input.skills,60);
  if('roleFamilies'in input)p.roleFamilies=strings(input.roleFamilies).filter(x=>ROLE_FAMILIES.includes(x));
  if('yearsExperience'in input)p.yearsExperience=Number.isFinite(input.yearsExperience)&&input.yearsExperience>=0&&input.yearsExperience<=70?input.yearsExperience:null;
  if('preferences'in input){if(!isPlainObject(input.preferences))fail(400,'INVALID_PROFILE','Send preferences as a valid object.');const q=input.preferences;p.preferences={...p.preferences};for(const k of ['locations','workplaceTypes','employmentTypes','roleTitles','seniority'])if(k in q)p.preferences[k]=strings(q[k]);for(const k of ['relocation','locationsRequired','includeRemote','workplaceRequired','minimumSalaryRequired'])if(k in q)p.preferences[k]=q[k]===true;if('limitations'in q)p.preferences.limitations=safeString(q.limitations,2000);if('salaryPeriod'in q)p.preferences.salaryPeriod=['year','hour','day'].includes(q.salaryPeriod)?q.salaryPeriod:'year';if('minimumSalary'in q)p.preferences.minimumSalary=Number.isFinite(q.minimumSalary)&&q.minimumSalary>0?q.minimumSalary:null;}
  p.confirmed=input.confirmed===true;
  if(p.confirmed&&['citizen','permanent-resident'].includes(p.workRights)&&['yes','now','later'].includes(p.needsSponsorship))fail(400,'INVALID_PROFILE','Check your work rights and sponsorship answers: citizens and permanent residents do not require employer sponsorship.');
  if(p.confirmed&&p.preferences.locationsRequired&&!p.preferences.locations?.length)fail(400,'INVALID_PROFILE','Enter a preferred location or turn off the location requirement.');
  if(p.confirmed&&p.preferences.workplaceRequired&&!p.preferences.workplaceTypes?.length)fail(400,'INVALID_PROFILE','Select a work arrangement or turn off the work-arrangement requirement.');
  if(p.confirmed&&p.preferences.minimumSalaryRequired&&!p.preferences.minimumSalary)fail(400,'INVALID_PROFILE','Enter a salary minimum or turn off the salary requirement.');
  if(p.confirmed&&(!p.resumeText||!p.location||!p.roleFamilies.length||!p.consentAt))fail(400,'PROFILE_INCOMPLETE','Upload your resume, select your location and role families, then confirm your profile.');
  if(p.confirmed&&!p.termsAcceptedAt)fail(400,'TERMS_REQUIRED','Accept the terms and privacy notice to confirm your profile.');
  assertProfileSize(p);return p;
}
function publicGeneration(value){
  const {
    profileSnapshot:_profileSnapshot,
    jobSnapshot:_jobSnapshot,
    lease:_lease,
    leaseId:_leaseId,
    leaseExpiresAt:_leaseExpiresAt,
    dispatchAttemptId:_dispatchAttemptId,
    dispatchAttemptedAt:_dispatchAttemptedAt,
    dispatchLeaseUntil:_dispatchLeaseUntil,
    dispatchAttempts:_dispatchAttempts,
    dispatchedAt:_dispatchedAt,
    providerStartedAt:_providerStartedAt,
    ...generation
  }=value;
  return generation;
}

export function createService({store,mode='production',provider,dispatch,files,billing,feed,identity,guestSearch,guestRateSecret,requireAiConsent=false,extract=extractResume}) {
  const demo=mode==='demo';
  const underlying=store;
  store={get:underlying.get.bind(underlying),list:underlying.list.bind(underlying),listPage:underlying.listPage?.bind(underlying),scanPage:underlying.scanPage?.bind(underlying),removePartition:underlying.removePartition.bind(underlying),transact:changes=>{const guarded=[...new Set(changes.filter(c=>c.pk.startsWith('USER#')).map(c=>c.pk))].filter(pk=>!changes.some(c=>c.pk===pk&&c.sk==='DELETING'));return underlying.transact([...changes,...guarded.flatMap(pk=>[{pk,sk:'DELETING',expected:0,checkOnly:true},{pk:'ACCOUNT#deleted',sk:tombstoneKey(pk.slice(5)),expected:0,checkOnly:true}])]);}};
  async function getEntitlement(pk){return (await store.get(pk,'ENTITLEMENT'))?.value??blankEntitlement();}
  async function assertActive(pk){if(await store.get('ACCOUNT#deleted',tombstoneKey(pk.slice(5))))fail(401,'ACCOUNT_DELETED','This account has been deleted. Sign out to continue.');if(await store.get(pk,'DELETING'))fail(409,'ACCOUNT_DELETING','Your account is being deleted.');}
  async function sourceAvailable(){try{return Boolean(await guestSearch?.available?.());}catch{return false;}}
  async function capabilities(){const [state,searchAvailable]=await Promise.all([feed?.status?feed.status():{},sourceAvailable()]);return {jobImport:true,recommendations:searchAvailable||['ready','degraded','demo'].includes(state.status),guestDiscovery:searchAvailable,coverLetters:Boolean(await provider?.available()),billing:Boolean(billing)};}
  async function recommendationRegistration(sub){return store.get(RECOMMENDATION_REGISTRY_PK,sub);}
  async function ensureRecommendationRegistration(sub){
    if(!validUserSub(sub))throw Error('Invalid user subject');
    return retryConflict(async()=>{const row=await recommendationRegistration(sub);if(row)return row;await store.transact([change(RECOMMENDATION_REGISTRY_PK,sub,null,{userSub:sub}),{pk:`USER#${sub}`,sk:'DELETING',expected:0,checkOnly:true},{pk:'ACCOUNT#deleted',sk:tombstoneKey(sub),expected:0,checkOnly:true}]);return recommendationRegistration(sub);});
  }
  async function removeRecommendationRegistration(sub){
    if(!validUserSub(sub))return;
    await retryConflict(async()=>{const row=await recommendationRegistration(sub);if(row)await store.transact([{pk:row.pk,sk:row.sk,expected:row.revision,remove:true}]);});
  }
  function generationRegistrationValue(sub,id,createdAt=iso()){
    return {version:1,userSub:sub,tenantHash:generationTenantHash(sub),generationId:id,createdAt};
  }
  function validGenerationRegistration(row){
    const value=row?.value;
    return row?.pk===GENERATION_OUTBOX_PK&&validUserSub(value?.userSub)&&validGenerationId(value?.generationId)
      &&value.tenantHash===generationTenantHash(value.userSub)&&row.sk===generationOutboxKey(value.userSub,value.generationId);
  }
  async function ensureGenerationRegistration(sub,id,createdAt){
    if(!validUserSub(sub)||!validGenerationId(id))throw Error('Invalid pending generation identity');
    const pk=`USER#${sub}`,sk=`GEN#${id}`,outboxSk=generationOutboxKey(sub,id);
    return retryConflict(async()=>{
      const [generation,row]=await Promise.all([store.get(pk,sk),store.get(GENERATION_OUTBOX_PK,outboxSk)]);
      if(!generation||generation.value.status!=='pending')return null;
      if(row){if(!validGenerationRegistration(row))throw Error('Pending generation registry conflict');return row;}
      await store.transact([
        change(GENERATION_OUTBOX_PK,outboxSk,null,generationRegistrationValue(sub,id,createdAt??generation.value.createdAt)),
        {pk,sk,expected:generation.revision,checkOnly:true},
      ]);
      return store.get(GENERATION_OUTBOX_PK,outboxSk);
    });
  }
  async function removeGenerationRegistration(sub,id){
    if(!validUserSub(sub)||!validGenerationId(id))return false;
    const outboxSk=generationOutboxKey(sub,id);
    return retryConflict(async()=>{
      const row=await store.get(GENERATION_OUTBOX_PK,outboxSk);if(!row)return false;
      if(!validGenerationRegistration(row)||row.value.userSub!==sub||row.value.generationId!==id)throw Error('Pending generation registry conflict');
      await store.transact([{pk:row.pk,sk:row.sk,expected:row.revision,remove:true}]);return true;
    });
  }
  async function removeGenerationRegistrationRow(row){
    return retryConflict(async()=>{
      const current=await store.get(row.pk,row.sk);if(!current)return false;
      await store.transact([{pk:current.pk,sk:current.sk,expected:current.revision,remove:true}]);return true;
    });
  }
  async function removeGenerationRegistrationsForSub(sub){
    if(!validUserSub(sub))return;
    const prefix=`${generationTenantHash(sub)}#`;let after=null;
    do{
      const page=store.listPage
        ?await store.listPage(GENERATION_OUTBOX_PK,prefix,{after,limit:GENERATION_REPAIR_PAGE_SIZE})
        :{items:await store.list(GENERATION_OUTBOX_PK,prefix),nextAfter:null};
      for(const row of page.items)await removeGenerationRegistrationRow(row);
      after=page.nextAfter;
    }while(after);
  }
  async function backfillPendingGenerationRegistrations(){
    if(typeof store.scanPage!=='function')throw Error('Generation outbox backfill scan is unavailable');
    const result={examined:0,enrolled:0,pages:0,complete:false,waiting:false,failures:[]};
    while(result.pages<GENERATION_BACKFILL_MAX_PAGES){
      const claim=await retryConflict(async()=>{
        const row=await store.get(GENERATION_BACKFILL_PK,GENERATION_BACKFILL_SK);
        if(row?.value.version!==undefined&&row.value.version!==1)throw Error('Unsupported generation outbox backfill state');
        if(row?.value.complete===true)return null;
        if(futureIso(row?.value.leaseUntil)||futureIso(row?.value.notBefore))return {waiting:true};
        const leaseId=randomUUID(),cursor=row?.value.cursor??null,pass=row?.value.pass===2?2:1;
        await store.transact([change(GENERATION_BACKFILL_PK,GENERATION_BACKFILL_SK,row,{version:1,pass,cursor,leaseId,leaseUntil:new Date(Date.now()+WORKER_LEASE_MS).toISOString(),updatedAt:iso()})]);
        return {leaseId,cursor,pass};
      });
      if(!claim){result.complete=true;break;}
      if(claim.waiting){result.waiting=true;break;}
      const page=await store.scanPage({after:claim.cursor,limit:GENERATION_BACKFILL_PAGE_SIZE});
      result.pages++;result.examined+=page.items.length;
      for(const row of page.items){
        if(row?.value?.status!=='pending'||typeof row.pk!=='string'||typeof row.sk!=='string'||!row.sk.startsWith('GEN#'))continue;
        const sub=row.pk.startsWith('USER#')?row.pk.slice(5):'',id=row.sk.slice(4);
        if(!validUserSub(sub)||!validGenerationId(id)){
          result.failures.push({code:'INVALID_LEGACY_GENERATION_RECORD',recordKeyHash:createHash('sha256').update(`${String(row.pk)}\0${String(row.sk)}`).digest('hex')});continue;
        }
        if(await ensureGenerationRegistration(sub,id,row.value.createdAt))result.enrolled++;
      }
      const advanced=await retryConflict(async()=>{
        const row=await store.get(GENERATION_BACKFILL_PK,GENERATION_BACKFILL_SK);
        if(row?.value.leaseId!==claim.leaseId)return false;
        const finished=page.nextAfter===null&&claim.pass===2;
        const value={version:1,pass:finished?2:page.nextAfter===null?2:claim.pass,updatedAt:iso(),complete:finished,
          ...(page.nextAfter?{cursor:page.nextAfter}:finished?{completedAt:iso()}:{cursor:null,notBefore:new Date(Date.now()+WORKER_LEASE_MS).toISOString()})};
        await store.transact([change(GENERATION_BACKFILL_PK,GENERATION_BACKFILL_SK,row,value)]);return true;
      });
      if(!advanced)break;
      if(page.nextAfter===null){result.complete=claim.pass===2;result.waiting=!result.complete;break;}
    }
    return result;
  }
  async function resolveContinuation(pk,view){
    const row=await store.get(pk,'CONTINUATION');if(!row)return null;
    if(view.canGenerate&&row.value.status==='awaiting-payment')return retryConflict(async()=>{
      const current=await store.get(pk,'CONTINUATION');if(!current)return null;
      if(current.value.status!=='awaiting-payment')return current.value;
      const entitlement=await store.get(pk,'ENTITLEMENT'),freshView=billingView(entitlement?.value??blankEntitlement());
      if(!freshView.canGenerate)return current.value;
      const value={...current.value,status:'ready',readyAt:iso(),updatedAt:iso()};
      await store.transact([change(pk,'CONTINUATION',current,value),{pk,sk:'ENTITLEMENT',expected:entitlement?.revision??0,checkOnly:true}]);return value;
    });
    return row.value;
  }
  async function completeContinuation(user,input={}){
    const pk=pkOf(user);await assertActive(pk);
    return retryConflict(async()=>{
      const row=await store.get(pk,'CONTINUATION');if(!row)return {completed:true,continuation:null};
      const applicationId=safeString(input.applicationId,180);
      if(applicationId&&applicationId!==row.value.pendingApplicationId)fail(409,'CONTINUATION_MISMATCH','This continuation belongs to a different application.');
      const entitlement=await store.get(pk,'ENTITLEMENT'),view=billingView(entitlement?.value??blankEntitlement());
      if(!view.canGenerate)fail(402,view.reason??'PAYMENT_REQUIRED','Complete a verified Starter or Plus payment before opening this application.');
      await store.transact([{pk,sk:'CONTINUATION',expected:row.revision,remove:true},{pk,sk:'ENTITLEMENT',expected:entitlement?.revision??0,checkOnly:true}]);
      return {completed:true,applicationId:row.value.pendingApplicationId,continuation:null};
    });
  }
  async function account(user){const pk=pkOf(user);await assertActive(pk);const profile=(await store.get(pk,'PROFILE'))?.value??blankProfile(user.email,user.name);if(profile.confirmed)await ensureRecommendationRegistration(user.sub);const billing=billingView(await getEntitlement(pk));return {profile,billing,continuation:await resolveContinuation(pk,billing),feed:await feed.status(),capabilities:await capabilities(),mode};}
  async function saveProfile(user,input){const pk=pkOf(user);await assertActive(pk);return retryConflict(async()=>{
    const row=await store.get(pk,'PROFILE'),registry=await recommendationRegistration(user.sub),profile=cleanProfile(input,row?.value??blankProfile(user.email,user.name),user.email),changes=[change(pk,'PROFILE',row,profile)];
    if(profile.confirmed)changes.push(change(RECOMMENDATION_REGISTRY_PK,user.sub,registry,{userSub:user.sub}));else if(registry)changes.push({pk:registry.pk,sk:registry.sk,expected:registry.revision,remove:true});
    await store.transact(changes);return {profile};
  });}
  async function reserveUpload(user,upload){
    const pk=pkOf(user);await assertActive(pk);
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    await retryConflict(async()=>{
      const row=await store.get(pk,`UPLOAD_RATE#${day}`),count=row?.value.count??0;
      if(count>=5)fail(429,'UPLOAD_LIMIT','You can start five resume uploads per day. Please try again after midnight Sydney time.');
      const changes=[{...change(pk,`UPLOAD_RATE#${day}`,row,{count:count+1}),ttl:Math.floor(Date.now()/1000)+8*86400}];
      if(upload){const state=await store.get(pk,'UPLOAD_STATE');changes.push({...change(pk,`UPLOAD#${upload.id}`,null,upload.value),ttl:Math.floor(Date.now()/1000)+2*86400});changes.push(change(pk,'UPLOAD_STATE',state,{activeGrantUntil:Math.max(state?.value.activeGrantUntil??0,upload.value.grantExpiresAt+120000)}));}
      await store.transact(changes);
    });
  }
  async function removeObject(key){if(key&&files?.remove)await files.remove(key);}
  async function saveParsedResume(user,parsed,objectKey,uploadId){
    const pk=pkOf(user);await assertActive(pk);
    const saved=await retryConflict(async()=>{
      const row=await store.get(pk,'PROFILE'),registry=await recommendationRegistration(user.sub);
      const profile={...mergeResumeEvidence(row?.value??blankProfile(user.email,user.name),user.email,parsed),confirmed:false,consentAt:iso(),resumeObjectKey:objectKey??null,resumeUploadId:uploadId??null,resumeOriginalExpiresAt:objectKey?new Date(Date.now()+7*86400000).toISOString():null};
      const changes=[change(pk,'PROFILE',row,profile)];if(registry)changes.push({pk:registry.pk,sk:registry.sk,expected:registry.revision,remove:true});
      assertProfileSize(profile);await store.transact(changes);
      return {profile,previousKey:row?.value.resumeObjectKey};
    });
    const warnings=[...(parsed.warnings??[])];
    if(saved.previousKey&&saved.previousKey!==objectKey){try{await removeObject(saved.previousKey);}catch{warnings.push('The previous original will be removed by the seven-day retention policy.');}}
    return {profile:saved.profile,extractedText:parsed.text,warnings};
  }
  async function uploadResume(user,input){
    if(input.consent!==true)fail(400,'CONSENT_REQUIRED','Confirm resume processing before uploading.');
    if(typeof input.dataBase64!=='string'||input.dataBase64.length>Math.ceil(MAX_RESUME/3)*4+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64))fail(400,'INVALID_RESUME','Upload a valid PDF or DOCX no larger than 5 MB.');
    const bytes=Buffer.from(input.dataBase64,'base64');if(bytes.length>MAX_RESUME)fail(413,'RESUME_TOO_LARGE','Resume must not exceed 5 MB.');
    if(!demo&&bytes.length>3*1024*1024)fail(413,'DIRECT_UPLOAD_REQUIRED','Use the direct resume upload for files over 3 MB.');
    await reserveUpload(user);
    const parsed=await extract(input.filename,input.contentType,bytes);
    const key=files?await files.put(user.sub,input.filename,input.contentType,bytes):undefined;
    try{return await saveParsedResume(user,parsed,key);}catch(error){await removeObject(key).catch(()=>{});throw error;}
  }
  async function startUpload(user,input){
    if(!files?.presign)fail(503,'SERVICE_UNAVAILABLE','Direct upload is unavailable.');
    if(input.consent!==true)fail(400,'CONSENT_REQUIRED','Confirm resume processing before uploading.');
    const filename=safeString(input.filename),contentType=input.contentType;
    if(!Number.isInteger(input.size)||input.size<1||input.size>MAX_RESUME)fail(400,'INVALID_RESUME','Upload a non-empty file no larger than 5 MB.');
    if(!(/\.pdf$/i.test(filename)&&contentType==='application/pdf'||/\.docx$/i.test(filename)&&contentType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'))fail(400,'INVALID_RESUME','Choose a PDF or DOCX.');
    const uploadId=randomUUID(),key=`pending/${encodeURIComponent(user.sub)}/${uploadId}`;
    await reserveUpload(user,{id:uploadId,value:{key,filename,contentType,size:input.size,createdAt:iso(),grantExpiresAt:Date.now()+300000,status:'pending'}});
    return {uploadId,uploadUrl:await files.presign(key,contentType,input.size),headers:{'Content-Type':contentType}};
  }
  async function finalizeUpload(user,input){
    const pk=pkOf(user),uploadId=safeString(input.uploadId,100),sk=`UPLOAD#${uploadId}`;await assertActive(pk);
    const row=await store.get(pk,sk);if(!row||Date.now()-Date.parse(row.value.createdAt)>3600000)fail(404,'UPLOAD_NOT_FOUND','This upload has expired. Please upload again.');
    if(row.value.status==='invalid')fail(400,'INVALID_RESUME','That file could not be validated. Start a new upload.');
    if(row.value.status==='processed'){const profile=(await store.get(pk,'PROFILE'))?.value;if(profile?.resumeUploadId===uploadId)return {profile,extractedText:profile.resumeText,warnings:[]};fail(409,'UPLOAD_ALREADY_PROCESSED','This upload has already been replaced.');}
    if(row.value.status==='processing'&&Date.now()-Date.parse(row.value.processingAt)<120000)fail(409,'UPLOAD_PROCESSING','This upload is still being processed. Please retry shortly.');
    try{await store.transact([change(pk,sk,row,{...row.value,status:'processing',processingAt:iso()})]);}catch(error){if(error instanceof Conflict)fail(409,'UPLOAD_PROCESSING','This upload is already being processed. Please retry shortly.');throw error;}
    let key,profileSaved=false;
    try{
      const bytes=await files.get(row.value.key,MAX_RESUME);
      if(bytes.length!==row.value.size)fail(400,'INVALID_RESUME','Uploaded size differs from the selected file. Please upload again.');
      const parsed=await extract(row.value.filename,row.value.contentType,bytes);
      // Write the bytes actually validated, not a mutable pending object that could be replaced by its live grant.
      key=await files.put(user.sub,row.value.filename,row.value.contentType,bytes);
      const result=await saveParsedResume(user,parsed,key,uploadId);
      profileSaved=true;
      await retryConflict(async()=>{const current=await store.get(pk,sk);if(current)await store.transact([change(pk,sk,current,{...current.value,status:'processed',processedAt:iso()})]);});
      await removeObject(row.value.key).catch(()=>{});return result;
    }catch(error){
      const invalid=error instanceof ResumeError||[400,413].includes(error.status);
      if(key&&!profileSaved)await removeObject(key).catch(()=>{});
      if(invalid)await removeObject(row.value.key).catch(()=>{});
      await retryConflict(async()=>{const current=await store.get(pk,sk);if(current)await store.transact([change(pk,sk,current,{...current.value,status:invalid?'invalid':'pending',lastFailureAt:iso()})]);}).catch(()=>{});
      throw error;
    }
  }
  let cachedGuestRateSecret;
  async function rateSecret(){
    if(cachedGuestRateSecret)return cachedGuestRateSecret;
    let value;try{value=typeof guestRateSecret==='function'?await guestRateSecret():guestRateSecret;}catch{fail(503,'GUEST_NOT_CONFIGURED','Guest onboarding is not configured.');}
    if(typeof value!=='string'||value.length<32)fail(503,'GUEST_NOT_CONFIGURED','Guest onboarding is not configured.');
    cachedGuestRateSecret=value;return value;
  }
  async function rateIdentity(sourceIp){
    const digest=sourceIpHash(await rateSecret(),sourceIp);
    if(!digest)fail(400,'INVALID_REQUEST_SOURCE','This request source could not be verified.');
    return `GUEST_RATE#${digest}`;
  }
  async function consumeGuestRate(pk,sourceIp,action){
    const limits=GUEST_RATE_LIMITS[action];if(!limits)throw Error('Unknown guest rate action');
    const ipPk=await rateIdentity(sourceIp),day=new Date().toISOString().slice(0,10),ttl=Math.floor(Date.now()/1000)+2*86400;
    return retryConflict(async()=>{
      const changes=[];
      if(limits.guest){const row=await store.get(pk,`RATE#${action}#${day}`),count=row?.value.count??0;if(count>=limits.guest)fail(429,'GUEST_RATE_LIMIT','This guest session has reached its request limit. Try again after the limit resets.');changes.push({...change(pk,`RATE#${action}#${day}`,row,{count:count+1}),ttl});}
      if(limits.ip){const row=await store.get(ipPk,`RATE#${action}#${day}`),count=row?.value.count??0;if(count>=limits.ip)fail(429,'GUEST_RATE_LIMIT','Too many guest requests came from this network. Try again later.');changes.push({...change(ipPk,`RATE#${action}#${day}`,row,{count:count+1}),ttl});}
      if(changes.length)await store.transact(changes);
    });
  }
  async function requiredGuest(token){
    const pk=guestPartition(token);if(!pk)fail(400,'INVALID_GUEST_TOKEN','This guest session token is invalid.');
    const row=await store.get(pk,'SESSION');
    if(!row||!Number.isFinite(Date.parse(row.value.expiresAt))||Date.parse(row.value.expiresAt)<=Date.now())fail(410,'GUEST_SESSION_EXPIRED','This guest session expired. Start again to keep your resume private.');
    return {pk,row,session:row.value};
  }
  function assertGuestOpen(session){
    if(session.claimedApplicationId)fail(409,'GUEST_ALREADY_CLAIMED','This guest session has already been claimed by an account.');
    if(session.abandonedAt)fail(409,'GUEST_ALREADY_RESOLVED','This guest session was already resolved by an account.');
  }
  async function guestOpportunities(pk,session){
    const ignored=new Set(session.ignoredJobIds??[]),results=[];
    for(const id of session.opportunityIds??[]){if(ignored.has(id))continue;const row=await store.get(pk,`JOB#${id}`);if(row?.value?.assessment)results.push(row.value.assessment);if(results.length===5)break;}
    return results;
  }
  async function guestResponse(token,pk,session){const opportunities=await guestOpportunities(pk,session),guest={...publicGuest(session),expiresAt:session.expiresAt,profile:session.profile??null};if(['opportunities','claimed'].includes(session.stage))guest.opportunities=opportunities;return {token,expiresAt:session.expiresAt,guest,profile:session.profile??null,opportunities};}
  async function startGuest(input,sourceIp){
    if(!isPlainObject(input)||Object.keys(input).some(key=>!['situation','location','remote'].includes(key)))fail(400,'INVALID_GUEST_START','Send only your situation, location and remote preference.');
    const situations=['actively-looking','exploring','graduate','career-change','returning'];
    if(!situations.includes(input.situation))fail(400,'INVALID_GUEST_START','Choose your current job-search situation.');
    const location=safeString(input.location,250);if(/[\u0000-\u001f\u007f]/.test(location))fail(400,'INVALID_GUEST_START','Enter a valid location.');
    if(input.remote!==undefined&&input.remote!==null&&typeof input.remote!=='boolean')fail(400,'INVALID_GUEST_START','Choose whether you prefer remote work.');
    if(!await guestSearch?.available?.())fail(503,'JOB_SEARCH_NOT_CONFIGURED','Live job search is awaiting source approval. No resume was uploaded.');
    await consumeGuestRate(null,sourceIp,'start');
    for(let attempt=0;attempt<3;attempt++){
      const token=newGuestToken(),pk=guestPartition(token),expiry=guestExpiry(),session={version:1,createdAt:iso(),expiresAt:expiry.expiresAt,stage:'resume',situation:input.situation,location,remote:typeof input.remote==='boolean'?input.remote:null,profile:null,suggestions:null,resumeWarnings:[],opportunityIds:[],ignoredJobIds:[],selectedJobId:null,search:null};
      try{await store.transact([{...change(pk,'SESSION',null,session),ttl:expiry.ttl}]);return guestResponse(token,pk,session);}catch(error){if(!(error instanceof Conflict)||attempt===2)throw error;}
    }
  }
  async function readGuest(input,sourceIp){const state=await requiredGuest(input.token);await consumeGuestRate(state.pk,sourceIp,'session');return guestResponse(input.token,state.pk,state.session);}
  async function guestResume(input,sourceIp){
    const state=await requiredGuest(input.token);await consumeGuestRate(state.pk,sourceIp,'resume');
    assertGuestOpen(state.session);
    if(input.consent!==true)fail(400,'CONSENT_REQUIRED','Confirm resume processing before uploading.');
    if(typeof input.dataBase64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64))fail(400,'INVALID_RESUME','Upload a valid PDF or DOCX no larger than 4 MB.');
    if(input.dataBase64.length>Math.ceil(GUEST_MAX_RESUME/3)*4+4)fail(413,'RESUME_TOO_LARGE','Guest resumes must not exceed 4 MB.');
    const bytes=Buffer.from(input.dataBase64,'base64');if(!bytes.length||bytes.length>GUEST_MAX_RESUME)fail(413,'RESUME_TOO_LARGE','Guest resumes must not exceed 4 MB.');
    const parsed=await extract(safeString(input.filename,250),input.contentType,bytes),suggestions=suggestProfileFromResume(parsed.text,parsed.skills);
    const suggested=suggestions.values,location=state.session.location||suggested.location;
    const profile={...blankProfile(''),name:suggested.name,resumeText:parsed.text,skills:suggested.skills,roleFamilies:suggested.roleFamilies,yearsExperience:suggested.yearsExperience,situation:state.session.situation,location,preferences:{...blankProfile('').preferences,locations:location?[location]:[],locationsRequired:Boolean(location),includeRemote:state.session.remote===true,workplaceTypes:[],roleTitles:suggested.roleTitles},confirmed:false,consentAt:iso()};
    assertProfileSize(profile);
    const session={...state.session,stage:'profile',profile,suggestions,resumeWarnings:parsed.warnings??[],opportunityIds:[],selectedJobId:null,search:null};
    const existing=await store.list(state.pk,'JOB#'),changes=[change(state.pk,'SESSION',state.row,session),...existing.map(row=>({pk:row.pk,sk:row.sk,expected:row.revision,remove:true}))];
    try{await store.transact(changes);}catch(error){if(error instanceof Conflict)fail(409,'GUEST_SESSION_CHANGED','This guest session changed in another tab. Reload it and try again.');throw error;}
    return guestResponse(input.token,state.pk,session);
  }
  async function saveGuestProfile(input,sourceIp){
    const state=await requiredGuest(input.token);await consumeGuestRate(state.pk,sourceIp,'profile');
    assertGuestOpen(state.session);
    if(!state.session.profile?.resumeText)fail(409,'RESUME_REQUIRED','Upload your resume before confirming the profile.');
    if(!isPlainObject(input.profile)||input.profile.confirmed!==true)fail(400,'PROFILE_CONFIRMATION_REQUIRED','Review and confirm the extracted profile.');
    if(input.termsAccepted!==true)fail(400,'TERMS_REQUIRED','Accept the terms and privacy notice to confirm your profile.');
    const supplied={...input.profile};delete supplied.consentAt;delete supplied.email;delete supplied.termsAcceptedAt;delete supplied.termsVersion;
    const profile=cleanProfile({...supplied,resumeText:typeof supplied.resumeText==='string'?supplied.resumeText:state.session.profile.resumeText,confirmed:true,termsAccepted:true},state.session.profile,'');
    if(!profile.name)fail(400,'ESSENTIAL_PROFILE_REQUIRED','Confirm your name before continuing.');
    const session={...state.session,stage:'search',situation:profile.situation,location:profile.location,profile,opportunityIds:[],selectedJobId:null,search:null};
    const existing=await store.list(state.pk,'JOB#'),changes=[change(state.pk,'SESSION',state.row,session),...existing.map(row=>({pk:row.pk,sk:row.sk,expected:row.revision,remove:true}))];
    try{await store.transact(changes);}catch(error){if(error instanceof Conflict)fail(409,'GUEST_SESSION_CHANGED','This guest session changed in another tab. Reload it and try again.');throw error;}
    return guestResponse(input.token,state.pk,session);
  }
  async function searchGuest(input,sourceIp){
    const state=await requiredGuest(input.token);await consumeGuestRate(state.pk,sourceIp,'search');
    assertGuestOpen(state.session);
    if(!state.session.profile?.confirmed)fail(409,'PROFILE_INCOMPLETE','Confirm the essential profile details before searching.');
    if(!guestSearch?.search)fail(503,'JOB_SEARCH_NOT_CONFIGURED','Live job search is awaiting source approval. No sample jobs were substituted.');
    let result;try{result=await guestSearch.search(state.session.profile,state.session);}catch(error){if(error?.status===503)fail(503,error.code??'JOB_SEARCH_UNAVAILABLE',error.message);throw error;}
    if(!Array.isArray(result?.jobs)||result.jobs.length>60)fail(503,'JOB_SEARCH_UNAVAILABLE','The live job source returned an invalid result set. Try again shortly.');
    const ignored=new Set(state.session.ignoredJobIds??[]),ranked=[];
    for(const job of result.jobs){if(ignored.has(job.id))continue;const assessment=assessWithReasons(state.session.profile,job);if(assessment.highFit)ranked.push(assessment);}
    ranked.sort((a,b)=>b.score-a.score||a.job.id.localeCompare(b.job.id));const opportunities=ranked.slice(0,30),ids=opportunities.map(item=>item.job.id),searchedAt=iso();
    const search={status:'ready',searchedAt,source:result.source??{name:'Freehire',status:'ready'},highFitCount:opportunities.length,message:opportunities.length?'Up to five high-fit Australian technology roles are ready for review.':'No high-fit roles were found in this search. Review your confirmed profile before trying again.'};
    const session={...state.session,stage:'opportunities',opportunityIds:ids,selectedJobId:null,search};
    const previous=await store.list(state.pk,'JOB#'),next=new Map(opportunities.map(assessment=>[assessment.job.id,assessment])),changes=[change(state.pk,'SESSION',state.row,session)];
    for(const row of previous){const id=row.sk.slice(4);if(!next.has(id)&&!ignored.has(id))changes.push({pk:row.pk,sk:row.sk,expected:row.revision,remove:true});}
    for(const [id,assessment] of next){const row=previous.find(item=>item.sk===`JOB#${id}`);changes.push({...change(state.pk,`JOB#${id}`,row,{assessment,searchedAt}),ttl:state.row.ttl});}
    try{await store.transact(changes);}catch(error){if(error instanceof Conflict)fail(409,'GUEST_SESSION_CHANGED','This guest session changed while jobs were loading. Search again.');throw error;}
    return guestResponse(input.token,state.pk,session);
  }
  async function ignoreGuest(input,sourceIp){
    const state=await requiredGuest(input.token);await consumeGuestRate(state.pk,sourceIp,'ignore');
    assertGuestOpen(state.session);
    const id=safeString(input.jobId,180);if(!id)fail(400,'INVALID_JOB','Choose an opportunity to ignore.');
    const ignored=new Set(state.session.ignoredJobIds??[]);
    if(!ignored.has(id)&&!(state.session.opportunityIds??[]).includes(id))fail(404,'JOB_NOT_FOUND','This opportunity is not part of the current guest search.');
    ignored.add(id);if(ignored.size>50)fail(429,'IGNORE_LIMIT','This guest session has reached its ignored-job limit.');
    const session={...state.session,ignoredJobIds:[...ignored],selectedJobId:state.session.selectedJobId===id?null:state.session.selectedJobId};
    try{await store.transact([change(state.pk,'SESSION',state.row,session)]);}catch(error){if(error instanceof Conflict)fail(409,'GUEST_SESSION_CHANGED','This guest session changed in another tab. Reload it and try again.');throw error;}
    return guestResponse(input.token,state.pk,session);
  }
  async function cleanupGuestJobs(pk){
    const rows=await store.list(pk,'JOB#');
    for(let index=0;index<rows.length;index+=25){
      const batch=rows.slice(index,index+25).map(row=>({pk:row.pk,sk:row.sk,expected:row.revision,remove:true}));
      try{await store.transact(batch);}catch(error){if(!(error instanceof Conflict))throw error;}
    }
  }
  async function claimGuest(user,input,sourceIp){
    const initial=await requiredGuest(input.token);await consumeGuestRate(initial.pk,sourceIp,'claim');await assertActive(pkOf(user));
    const id=safeString(input.interestedJobId,180);if(!id)fail(400,'INVALID_JOB','Choose an opportunity before creating an account.');
    const userHash=createHash('sha256').update(user.sub).digest('hex'),guestHash=guestTokenHash(input.token),userPk=pkOf(user);
    const result=await retryConflict(async()=>{
      const guestRow=await store.get(initial.pk,'SESSION');
      if(!guestRow||Date.parse(guestRow.value.expiresAt)<=Date.now())fail(410,'GUEST_SESSION_EXPIRED','This guest session expired. Start again to keep your resume private.');
      const guest=guestRow.value;
      if(guest.abandonedAt)fail(409,'GUEST_ALREADY_RESOLVED','This guest session was already resolved by an account.');
      if(guest.claimedApplicationId){
        if(guest.claimedUserHash!==userHash||guest.selectedJobId!==id)fail(409,'GUEST_ALREADY_CLAIMED','This guest session has already been claimed.');
        const application=(await store.get(userPk,`APP#${id}`))?.value,continuation=(await store.get(userPk,'CONTINUATION'))?.value;
        if(!application)fail(409,'GUEST_CLAIM_INCOMPLETE','This account claim needs support review.');
        return {application,continuation,profile:(await store.get(userPk,'PROFILE'))?.value};
      }
      if(!guest.profile?.confirmed||(guest.ignoredJobIds??[]).includes(id))fail(409,'GUEST_SELECTION_INVALID','Choose a current high-fit opportunity before continuing.');
      const visible=await guestOpportunities(initial.pk,guest);
      if(!visible.some(item=>item.job?.id===id))fail(409,'GUEST_SELECTION_INVALID','Choose one of the high-fit opportunities currently shown.');
      const profileRow=await store.get(userPk,'PROFILE');
      if(profileRow?.value.confirmed&&profileRow.value.resumeText!==guest.profile.resumeText)fail(409,'ACCOUNT_PROFILE_EXISTS','This account already has a different confirmed profile. Continue with that profile or use a new account.');
      const profile={...guest.profile,email:user.email,guestClaimedAt:iso()};
      const shortlist=visible.map(item=>assessWithReasons(profile,item.job)).filter(item=>item.highFit);
      const assessment=shortlist.find(item=>item.job.id===id);if(!assessment)fail(409,'PROFILE_OR_JOB_CHANGED','The selected job is no longer a high-fit match. Search again.');
      const guestJobRows=await store.list(initial.pk,'JOB#'),guestAssessments=new Map(guestJobRows.map(row=>[row.sk.slice(4),row.value.assessment]));
      const ignoredIds=(guest.ignoredJobIds??[]).filter(ignoredId=>ignoredId!==id&&guestAssessments.has(ignoredId)).slice(0,30),ignoredDecisionRows=await Promise.all(ignoredIds.map(ignoredId=>store.get(userPk,`DECISION#${ignoredId}`)));
      const job=assessment.job,importedRows=await Promise.all(shortlist.map(item=>store.get(userPk,`IMPORTED_JOB#${item.job.id}`)));
      const decision=await store.get(userPk,`DECISION#${id}`),app=await store.get(userPk,`APP#${id}`),counter=await store.get(userPk,'IMPORT_COUNT'),continuationRow=await store.get(userPk,'CONTINUATION'),claimRow=await store.get(userPk,`GUEST_CLAIM#${guestHash}`),registry=await recommendationRegistration(user.sub);
      if(claimRow&&claimRow.value.applicationId!==id)fail(409,'GUEST_ALREADY_CLAIMED','This guest session has already been claimed.');
      const newImports=importedRows.filter(row=>!row).length;
      if((counter?.value.count??0)+newImports>200)fail(429,'IMPORT_LIMIT','You have reached the 200 saved-job limit. Contact support before adding more.');
      const {job:_duplicateJob,...match}=assessment,application=app?.value??{id,job,match,status:'interested',notes:'',createdAt:iso(),updatedAt:iso(),letters:[]};
      const entitlement=await store.get(userPk,'ENTITLEMENT'),view=billingView(entitlement?.value??blankEntitlement()),continuation={pendingApplicationId:id,status:view.canGenerate?'ready':'awaiting-payment',guestClaimedAt:iso(),updatedAt:iso(),...(view.canGenerate?{readyAt:iso()}:{})};
      const claimedAt=iso(),claimed={version:guest.version,createdAt:guest.createdAt,expiresAt:guest.expiresAt,stage:'claimed',selectedJobId:id,claimedApplicationId:id,claimedUserHash:userHash,claimedAt};
      const changes=[change(initial.pk,'SESSION',guestRow,claimed),change(userPk,'PROFILE',profileRow,profile),change(RECOMMENDATION_REGISTRY_PK,user.sub,registry,{userSub:user.sub}),change(userPk,`DECISION#${id}`,decision,{decision:'interested',updatedAt:iso()}),change(userPk,'CONTINUATION',continuationRow,continuation)];
      shortlist.forEach((item,index)=>changes.push(change(userPk,`IMPORTED_JOB#${item.job.id}`,importedRows[index],item.job)));
      ignoredIds.forEach((ignoredId,index)=>{const ignoredRow=ignoredDecisionRows[index];changes.push(ignoredRow?{pk:userPk,sk:`DECISION#${ignoredId}`,expected:ignoredRow.revision,checkOnly:true}:change(userPk,`DECISION#${ignoredId}`,null,{decision:'ignored',updatedAt:claimedAt,assessmentSnapshot:guestAssessments.get(ignoredId)}));});
      if(app)changes.push({pk:userPk,sk:`APP#${id}`,expected:app.revision,checkOnly:true});else changes.push(change(userPk,`APP#${id}`,null,application));
      if(newImports)changes.push(change(userPk,'IMPORT_COUNT',counter,{count:(counter?.value.count??0)+newImports}));
      if(claimRow)changes.push({pk:userPk,sk:`GUEST_CLAIM#${guestHash}`,expected:claimRow.revision,checkOnly:true});else changes.push(change(userPk,`GUEST_CLAIM#${guestHash}`,null,{applicationId:id,claimedAt,guestPartition:initial.pk}));
      changes.push({pk:userPk,sk:'ENTITLEMENT',expected:entitlement?.revision??0,checkOnly:true});
      await store.transact(changes);return {application,continuation,profile,savedOpportunityCount:shortlist.length};
    });
    // Claim ownership and the user-visible records commit atomically. Guest job
    // snapshots are nonessential cleanup and are removed in bounded batches so
    // a long, valid guest history cannot exceed DynamoDB's transaction limit.
    await cleanupGuestJobs(initial.pk).catch(()=>{});
    return {...result,billing:billingView(await getEntitlement(userPk))};
  }
  async function abandonGuest(user,input,sourceIp){
    const initial=await requiredGuest(input.token);await consumeGuestRate(initial.pk,sourceIp,'abandon');
    const userPk=pkOf(user);await assertActive(userPk);
    const userHash=createHash('sha256').update(user.sub).digest('hex'),guestHash=guestTokenHash(input.token);
    await retryConflict(async()=>{
      const guestRow=await store.get(initial.pk,'SESSION');
      if(!guestRow||Date.parse(guestRow.value.expiresAt)<=Date.now())fail(410,'GUEST_SESSION_EXPIRED','This guest session expired. Start again to keep your resume private.');
      const guest=guestRow.value;
      if(guest.claimedApplicationId)fail(409,'GUEST_ALREADY_CLAIMED','A claimed guest session cannot be abandoned.');
      if(guest.abandonedAt){
        if(guest.abandonedUserHash!==userHash)fail(409,'GUEST_ALREADY_RESOLVED','This guest session was already resolved by another account.');
      }
      if(!guest.abandonedAt&&!guest.profile?.confirmed)fail(409,'PROFILE_INCOMPLETE','Confirm the guest profile before returning to an existing workspace.');
      const profileRow=await store.get(userPk,'PROFILE');
      if(!profileRow?.value.confirmed)fail(409,'ACCOUNT_PROFILE_REQUIRED','This account does not have a confirmed workspace profile. Continue the guest setup instead.');
      if(!guest.abandonedAt&&profileRow.value.resumeText===guest.profile.resumeText)fail(409,'GUEST_ABANDON_NOT_REQUIRED','This guest profile matches the account profile. Continue the selected opportunity instead.');
      const abandonedAt=guest.abandonedAt??iso(),abandoned={version:guest.version,createdAt:guest.createdAt,expiresAt:guest.expiresAt,stage:'abandoned',abandonedAt,abandonedUserHash:userHash};
      const reference=await store.get(userPk,`GUEST_CLAIM#${guestHash}`);
      if(reference&&reference.value.guestPartition!==initial.pk)throw Error('Guest deletion reference conflict');
      await store.transact([
        change(initial.pk,'SESSION',guestRow,abandoned),
        {pk:userPk,sk:'PROFILE',expected:profileRow.revision,checkOnly:true},
        reference?{pk:userPk,sk:`GUEST_CLAIM#${guestHash}`,expected:reference.revision,checkOnly:true}:change(userPk,`GUEST_CLAIM#${guestHash}`,null,{abandoned:true,abandonedAt,guestPartition:initial.pk}),
      ]);
    });
    await cleanupGuestJobs(initial.pk).catch(()=>{});
    return {abandoned:true,account:await account(user)};
  }
  async function readRecommendationCache(pk,profile){
    const stateRow=await store.get(pk,RECOMMENDATION_STATE_SK),fingerprint=profileFingerprint(profile),state=stateRow?.value;
    const valid=Boolean(state&&state.profileFingerprint===fingerprint&&Array.isArray(state.ids)&&state.ids.length<=30&&state.ids.every(id=>typeof id==='string'&&id.length<=180));
    if(!valid)return {stateRow,state,valid:false,assessments:[]};
    const wanted=new Set(state.ids),rows=await store.list(pk,RECOMMENDATION_JOB_PREFIX),byId=new Map(rows.filter(row=>wanted.has(row.sk.slice(RECOMMENDATION_JOB_PREFIX.length))).map(row=>[row.sk.slice(RECOMMENDATION_JOB_PREFIX.length),row.value]));
    const assessments=state.ids.map(id=>byId.get(id)?.assessment).filter(item=>item?.highFit===true&&item.job?.id&&(!item.job.expiresAt||Date.parse(item.job.expiresAt)>Date.now()));
    return {stateRow,state,valid:true,assessments};
  }
  function recommendationFeed(state){
    if(!state)return {status:'pending',lastUpdatedAt:null,message:'Your first approved-source recommendation refresh is pending.'};
    return {status:state.status,lastUpdatedAt:state.refreshedAt??null,lastAttemptAt:state.lastRefreshAttemptAt??state.refreshedAt??null,source:state.source??null,message:state.message};
  }
  function refreshDue(cache){
    if(!cache.valid)return true;
    const refreshed=Date.parse(cache.state.refreshedAt),retryAfter=Date.parse(cache.state.retryAfter);
    return (!Number.isFinite(refreshed)||Date.now()-refreshed>=RECOMMENDATION_STALE_MS)&&(!Number.isFinite(retryAfter)||Date.now()>=retryAfter);
  }
  async function retainRecommendationCache(pk,profileRow,cache){
    if(!cache.valid)return null;
    const degraded={...cache.state,status:'degraded',lastRefreshAttemptAt:iso(),retryAfter:new Date(Date.now()+RECOMMENDATION_RETRY_MS).toISOString(),message:'The latest source refresh failed. Your last verified shortlist is unchanged.'};
    try{await store.transact([change(pk,RECOMMENDATION_STATE_SK,cache.stateRow,degraded),{pk,sk:'PROFILE',expected:profileRow.revision,checkOnly:true}]);}catch(error){if(!(error instanceof Conflict))throw error;}
    return {refreshed:false,degraded:true,feed:recommendationFeed(degraded)};
  }
  async function refreshRecommendationsForSub(userSub,{force=false,background=false}={}){
    if(!validUserSub(userSub))throw Error('Invalid recommendation user subject');
    const pk=`USER#${userSub}`;try{await assertActive(pk);}catch(error){if(['ACCOUNT_DELETED','ACCOUNT_DELETING'].includes(error?.code)){await removeRecommendationRegistration(userSub);return {skipped:true,reason:error.code};}throw error;}
    const profileRow=await store.get(pk,'PROFILE');
    if(!profileRow?.value.confirmed){await removeRecommendationRegistration(userSub);return {skipped:true,reason:'PROFILE_NOT_CONFIRMED'};}
    await ensureRecommendationRegistration(userSub);
    let cache=await readRecommendationCache(pk,profileRow.value);
    if(!await sourceAvailable()){
      if(cache.valid)return {refreshed:false,degraded:true,feed:recommendationFeed({...cache.state,status:'degraded',message:'Daily recommendations are temporarily unavailable. Your last verified shortlist is unchanged.'})};
      if(background)return {skipped:true,reason:'JOB_SEARCH_NOT_CONFIGURED'};
      fail(503,'JOB_SEARCH_NOT_CONFIGURED','Approved-source recommendations are not configured.');
    }
    if(!force&&!refreshDue(cache))return {refreshed:false,feed:recommendationFeed(cache.state)};
    const owner=randomUUID();let acquired=false;
    await retryConflict(async()=>{
      const lock=await store.get(pk,'RECOMMENDATION_LOCK');
      if(lock?.value.until>Date.now())return;
      await store.transact([{...change(pk,'RECOMMENDATION_LOCK',lock,{owner,until:Date.now()+30000}),ttl:Math.floor(Date.now()/1000)+3600}]);acquired=true;
    });
    if(!acquired){
      cache=await readRecommendationCache(pk,profileRow.value);
      if(cache.valid)return {refreshed:false,inProgress:true,feed:recommendationFeed(cache.state)};
      fail(409,'RECOMMENDATION_REFRESH_IN_PROGRESS','Your recommendations are already being refreshed. Try again shortly.');
    }
    try{
      let result;
      try{result=await guestSearch.search(profileRow.value,{});}catch(error){
        cache=await readRecommendationCache(pk,profileRow.value);
        const retained=await retainRecommendationCache(pk,profileRow,cache);if(retained)return retained;
        fail(503,error?.code??'JOB_SEARCH_UNAVAILABLE',error?.message??'Live job search is temporarily unavailable. Try again shortly.');
      }
      if(!Array.isArray(result?.jobs)||result.jobs.length>100){cache=await readRecommendationCache(pk,profileRow.value);const retained=await retainRecommendationCache(pk,profileRow,cache);if(retained)return retained;fail(503,'JOB_SEARCH_UNAVAILABLE','The live job source returned an invalid result set. Try again shortly.');}
      const ranked=[],seen=new Set();let excludedCount=0;
      for(const job of result.jobs){if(!job?.id||seen.has(job.id))continue;seen.add(job.id);const assessment=assessWithReasons(profileRow.value,job);if(assessment.highFit)ranked.push(assessment);else excludedCount++;}
      ranked.sort((a,b)=>b.score-a.score||a.job.id.localeCompare(b.job.id));const assessments=ranked.slice(0,30),ids=assessments.map(item=>item.job.id),refreshedAt=iso();
      const source={name:safeString(result.source?.name,80)||'Freehire',status:'ready',...(typeof result.source?.fetchedAt==='string'&&Number.isFinite(Date.parse(result.source.fetchedAt))?{fetchedAt:new Date(result.source.fetchedAt).toISOString()}:{})};
      const sourceKinds=[...new Set(result.jobs.map(job=>safeString(job?.source,80)).filter(Boolean))].slice(0,30);
      const state={status:'ready',refreshedAt,lastRefreshAttemptAt:refreshedAt,source,sourceKinds,profileFingerprint:profileFingerprint(profileRow.value),ids,highFitCount:assessments.length,excludedCount,message:assessments.length?'Up to 30 high-fit Australian technology roles are ready for review.':'No high-fit roles were found. Review your confirmed profile before trying again.'};
      const priorRows=await store.list(pk,RECOMMENDATION_JOB_PREFIX),priorById=new Map(priorRows.map(row=>[row.sk.slice(RECOMMENDATION_JOB_PREFIX.length),row])),stateRow=await store.get(pk,RECOMMENDATION_STATE_SK);
      const changes=[change(pk,RECOMMENDATION_STATE_SK,stateRow,state),{pk,sk:'PROFILE',expected:profileRow.revision,checkOnly:true},...assessments.map(assessment=>change(pk,`${RECOMMENDATION_JOB_PREFIX}${assessment.job.id}`,priorById.get(assessment.job.id),{assessment,refreshedAt}))];
      try{await store.transact(changes);}catch(error){if(error instanceof Conflict)fail(409,'PROFILE_CHANGED','Your profile changed while recommendations were loading. Refresh again.');throw error;}
      const obsolete=priorRows.filter(row=>!ids.includes(row.sk.slice(RECOMMENDATION_JOB_PREFIX.length)));
      for(let index=0;index<obsolete.length;index+=25)await store.transact(obsolete.slice(index,index+25).map(row=>({pk:row.pk,sk:row.sk,expected:row.revision,remove:true}))).catch(()=>{});
      return {refreshed:true,count:assessments.length,feed:recommendationFeed(state)};
    }finally{
      const lock=await store.get(pk,'RECOMMENDATION_LOCK').catch(()=>null);if(lock?.value.owner===owner)await store.transact([{pk,sk:'RECOMMENDATION_LOCK',expected:lock.revision,remove:true}]).catch(()=>{});
    }
  }
  async function opportunityResponse(user,ignored=false,{refresh=false,force=false}={}){
    const pk=pkOf(user),profile=(await store.get(pk,'PROFILE'))?.value;await assertActive(pk);
    const searchAvailable=await sourceAvailable(),legacyStatus=feed?.status?await feed.status():{status:'not-configured',lastUpdatedAt:null};
    if(!profile?.confirmed)return {opportunities:[],feed:searchAvailable?recommendationFeed(null):legacyStatus,excludedCount:0};
    if(searchAvailable){await ensureRecommendationRegistration(user.sub);const cache=await readRecommendationCache(pk,profile);if(refresh&&(force||refreshDue(cache)))await refreshRecommendationsForSub(user.sub,{force});}
    const cache=await readRecommendationCache(pk,profile),cachedMatches=cache.valid?cache.assessments:[],legacyJobs=feed?.jobs?await feed.jobs():[],importedJobs=(await store.list(pk,'IMPORTED_JOB#')).map(row=>row.value),decisions=new Map((await store.list(pk,'DECISION#')).map(row=>[row.sk.slice(9),row.value]));
    const ranked=[],seen=new Set(),emitted=new Set();let excludedCount=cache.state?.excludedCount??0;
    for(const match of cachedMatches){const id=match.job.id,decision=decisions.get(id)?.decision;seen.add(id);if(ignored?decision==='ignored':!decision||decision==='undecided'){ranked.push(match);emitted.add(id);}}
    for(const job of [...legacyJobs,...importedJobs]){if(!job?.id||seen.has(job.id))continue;seen.add(job.id);const decision=decisions.get(job.id)?.decision;if(ignored?decision!=='ignored':decision&&decision!=='undecided')continue;const match=assess(profile,job);if(match){ranked.push(match);emitted.add(job.id);}else excludedCount++;}
    for(const [id,value] of decisions){const snapshot=value?.assessmentSnapshot,wanted=ignored?value?.decision==='ignored':value?.decision==='undecided';if(wanted&&!emitted.has(id)&&snapshot?.job?.id===id&&Number.isFinite(snapshot.score))ranked.push(snapshot);}
    ranked.sort((a,b)=>b.score-a.score||a.job.id.localeCompare(b.job.id));return {opportunities:ranked.slice(0,30),feed:searchAvailable?recommendationFeed(cache.valid?cache.state:null):legacyStatus,excludedCount};
  }
  async function opportunities(user,ignored=false){return opportunityResponse(user,ignored,{refresh:!ignored});}
  async function refreshOpportunities(user,input={}){if(!isPlainObject(input)||Object.keys(input).length)fail(400,'INVALID_REFRESH','Send an empty request to refresh recommendations.');await refreshRecommendationsForSub(user.sub,{force:true});return opportunityResponse(user,false);}
  async function queueRecommendationRefreshes({after=null}={}){
    if(!await sourceAvailable())return {queued:0,skipped:true,reason:'JOB_SEARCH_NOT_CONFIGURED'};
    if(typeof dispatch!=='function')return {queued:0,skipped:true,reason:'QUEUE_NOT_CONFIGURED'};
    if(after!==null&&!validUserSub(after))throw Error('Invalid recommendation fanout cursor');
    const page=store.listPage?await store.listPage(RECOMMENDATION_REGISTRY_PK,'',{after,limit:50}):{items:await store.list(RECOMMENDATION_REGISTRY_PK),nextAfter:null};
    const subjects=page.items.filter(row=>row.sk===row.value?.userSub&&validUserSub(row.value.userSub)).map(row=>row.value.userSub);
    let queued=0;for(let index=0;index<subjects.length;index+=20){await Promise.all(subjects.slice(index,index+20).map(async userSub=>{await dispatch({kind:'recommendation-refresh',userSub});queued++;}));}
    if(page.nextAfter)await dispatch({kind:'recommendation-fanout',after:page.nextAfter});
    return {queued,continued:Boolean(page.nextAfter)};
  }
  async function importOpportunity(user,input){
    const pk=pkOf(user);await assertActive(pk);
    let job;try{job=normalizeImportedJob(input);}catch(error){if(error.status===400)fail(400,error.code,error.message);throw error;}
    return retryConflict(async()=>{
      const profile=await store.get(pk,'PROFILE');if(!profile?.value.confirmed)fail(409,'PROFILE_INCOMPLETE','Review and confirm your profile before adding a job.');
      const assessment=assessWithReasons(profile.value,job);
      const row=await store.get(pk,`IMPORTED_JOB#${job.id}`);
      if(!assessment.highFit){
        if(row)await store.transact([change(pk,`IMPORTED_JOB#${job.id}`,row,job),{pk,sk:'PROFILE',expected:profile.revision,checkOnly:true}]);
        return {accepted:false,assessment};
      }
      const counter=await store.get(pk,'IMPORT_COUNT');
      if(!row&&(counter?.value.count??0)>=200)fail(429,'IMPORT_LIMIT','You have reached the 200 saved-job limit. Contact support before adding more.');
      const changes=[change(pk,`IMPORTED_JOB#${job.id}`,row,job),{pk,sk:'PROFILE',expected:profile.revision,checkOnly:true}];
      if(!row)changes.push(change(pk,'IMPORT_COUNT',counter,{count:(counter?.value.count??0)+1}));
      await store.transact(changes);
      return {accepted:true,opportunity:assessment,assessment};
    });
  }
  async function decision(user,id,input){
    if(!['interested','ignored','undecided'].includes(input.decision))fail(400,'INVALID_DECISION','Choose Interested or Ignore.');
    const pk=pkOf(user);await assertActive(pk);
    return retryConflict(async()=>{const row=await store.get(pk,`DECISION#${id}`),app=await store.get(pk,`APP#${id}`),profile=(await store.get(pk,'PROFILE'))?.value;
      const cachedAssessment=profile?(await readRecommendationCache(pk,profile)).assessments.find(item=>item.job.id===id):null,storedAssessment=row?.value?.assessmentSnapshot;
      const imported=(await store.get(pk,`IMPORTED_JOB#${id}`))?.value;
      let job=cachedAssessment?.job??imported??storedAssessment?.job??app?.value.job;
      if(!job&&feed?.jobs){try{job=(await feed.jobs()).find(item=>item.id===id);}catch{fail(503,'JOB_SOURCE_UNAVAILABLE','The job source is temporarily unavailable. Try again shortly.');}}
      if(!job)fail(404,'JOB_NOT_FOUND','This opportunity is no longer available.');
      let application=app?.value;
      const decisionValue={decision:input.decision,updatedAt:iso()};
      if(input.decision==='ignored'){
        const assessmentSnapshot=cachedAssessment??(profile&&assess(profile,job))??storedAssessment;
        if(!assessmentSnapshot)fail(409,'PROFILE_OR_JOB_CHANGED','Review your profile and refreshed opportunities first.');
        decisionValue.assessmentSnapshot=assessmentSnapshot;
      }
      if(input.decision==='undecided'&&storedAssessment)decisionValue.assessmentSnapshot=cachedAssessment??storedAssessment;
      const changes=[change(pk,`DECISION#${id}`,row,decisionValue)];
      if(input.decision==='interested'&&!app){const match=profile&&assess(profile,job);if(!match||!profile.confirmed)fail(409,'PROFILE_OR_JOB_CHANGED','Review your profile and refreshed opportunities first.');const {job:_duplicateJob,...matchDetails}=match;application={id,job,match:matchDetails,status:'interested',notes:'',createdAt:iso(),updatedAt:iso(),letters:[]};changes.push(change(pk,`APP#${id}`,null,application));}
      await store.transact(changes);return {application};
    });
  }
  async function availabilityContext(pk){
    const [legacyState,recommendationRow]=await Promise.all([
      (async()=>{try{return feed?.status?await feed.status():{status:'unknown'};}catch{return {status:'unknown'};}})(),
      store.get(pk,RECOMMENDATION_STATE_SK),
    ]);
    let legacyComplete=Boolean(feed?.jobs)&&(legacyState.status==='ready'||demo&&legacyState.status==='demo'),legacyIds=null;
    if(legacyComplete){try{legacyIds=new Set((await feed.jobs()).map(job=>job.id));}catch{legacyComplete=false;}}
    const recommendationState=recommendationRow?.value,hasRecommendationSnapshot=Boolean(recommendationState&&Array.isArray(recommendationState.ids));
    return {
      legacy:{complete:legacyComplete,ids:legacyIds,checkedAt:iso()},
      recommendation:{
        hasSnapshot:hasRecommendationSnapshot,
        ids:new Set(hasRecommendationSnapshot?recommendationState.ids:[]),
        sourceKinds:new Set(Array.isArray(recommendationState?.sourceKinds)?recommendationState.sourceKinds:[]),
        checkedAt:typeof recommendationState?.refreshedAt==='string'?recommendationState.refreshedAt:null,
      },
    };
  }
  function jobAvailability(job,context){
    const expired=job.expiresAt&&Number.isFinite(Date.parse(job.expiresAt))&&Date.parse(job.expiresAt)<=Date.now();
    const imported=job.source==='user-provided';
    const recommendationSource=typeof job.source==='string'&&(job.source.startsWith('freehire:')||context.recommendation.sourceKinds.has(job.source));
    const sourceTimestamp=job.lastSeenAt??job.updatedAt,sourceTime=Date.parse(sourceTimestamp),sourceAge=Date.now()-sourceTime;
    if(expired)return {...job,availability:'closed',availabilityMessage:'This opportunity has expired. Your application and saved letters remain available.',availabilityCheckedAt:recommendationSource?context.recommendation.checkedAt??sourceTimestamp:context.legacy.checkedAt};
    if(imported)return {...job,availability:'unknown',availabilityMessage:'You supplied this job description. Check the original listing to confirm it is still open before applying.',availabilityCheckedAt:null};
    if(recommendationSource){
      const inSnapshot=context.recommendation.ids.has(job.id),freshSavedSnapshot=!context.recommendation.hasSnapshot&&Number.isFinite(sourceTime)&&sourceAge>=0&&sourceAge<=RECOMMENDATION_STALE_MS;
      const availability=inSnapshot||freshSavedSnapshot?'available':'unknown';
      const message=inSnapshot?'This opportunity is present in your latest saved recommendation source snapshot.':freshSavedSnapshot?'This opportunity was present in the source snapshot saved when you selected it.':'This opportunity is not in your latest saved recommendation shortlist, so its current availability cannot be confirmed. Check the employer before applying.';
      return {...job,availability,availabilityMessage:message,availabilityCheckedAt:inSnapshot?context.recommendation.checkedAt:sourceTimestamp??context.recommendation.checkedAt};
    }
    const availability=context.legacy.complete&&!context.legacy.ids.has(job.id)?'closed':context.legacy.complete?'available':'unknown';
    const message=availability==='closed'?'This opportunity is no longer present in the latest complete job source. Your application and saved letters remain available.':availability==='unknown'?'Current availability could not be confirmed because the job source is unavailable or out of date. Check the employer before applying.':'This opportunity is present in the latest complete job source.';
    return {...job,availability,availabilityMessage:message,availabilityCheckedAt:context.legacy.checkedAt};
  }
  async function applications(user,cursor){
    const pk=pkOf(user);await assertActive(pk);
    const rows=await store.list(pk,'APP#'),letterRows=await store.list(pk,'LETTER#');
    const state=paginationState(user,'applications',[...rows,...letterRows],cursor);
    if(state.index>rows.length||state.index===rows.length&&state.letterOffset)fail(400,'INVALID_CURSOR','This application page cursor is invalid.');
    const context=await availabilityContext(pk),lettersByApplication=new Map();
    for(const row of letterRows){
      const id=row.sk.slice(7,row.sk.lastIndexOf('#'));
      if(!lettersByApplication.has(id))lettersByApplication.set(id,[]);
      lettersByApplication.get(id).push(row.value);
    }
    const page={applications:[],nextCursor:null};
    let bytes=jsonBytes(page)+CURSOR_HEADROOM,index=state.index,letterOffset=state.letterOffset;
    while(index<rows.length&&page.applications.length<20){
      const row=rows[index],letters=lettersByApplication.get(row.value.id)??[];
      if(letterOffset>letters.length)fail(400,'INVALID_CURSOR','This application page cursor is invalid.');
      const application={...row.value,job:jobAvailability(row.value.job,context),letters:[]};
      const baseBytes=jsonBytes(application)+(page.applications.length?1:0);
      if(bytes+baseBytes>PAGE_BYTES){if(page.applications.length)break;fail(413,'PAGE_TOO_LARGE','An application record is too large to return safely. Contact support.');}
      bytes+=baseBytes;
      let nextLetter=letterOffset;
      while(nextLetter<letters.length){
        const letter=letters[nextLetter],extra=jsonBytes(letter)+(application.letters.length?1:0);
        if(bytes+extra>PAGE_BYTES)break;
        application.letters.push(letter);bytes+=extra;nextLetter++;
      }
      if(nextLetter===letterOffset&&nextLetter<letters.length&&!page.applications.length)fail(413,'PAGE_TOO_LARGE','An application document is too large to return safely. Contact support.');
      page.applications.push(application);
      if(nextLetter<letters.length){letterOffset=nextLetter;break;}
      index++;letterOffset=0;
    }
    if(index<rows.length)page.nextCursor=nextPageCursor({...state,index,letterOffset});
    return assertPageFits(page);
  }
  async function updateApplication(user,id,input){const pk=pkOf(user);return retryConflict(async()=>{await assertActive(pk);const row=await store.get(pk,`APP#${id}`);if(!row)fail(404,'NOT_FOUND','Application not found.');const application={...row.value,updatedAt:iso()};if('status'in input){if(!['interested','preparing','applied','interview','offer','closed'].includes(input.status))fail(400,'INVALID_STATUS','Choose a valid application status.');application.status=input.status;}if('notes'in input)application.notes=safeString(input.notes,10000);await store.transact([change(pk,`APP#${id}`,row,application)]);const {letters:_letters,...metadata}=application;return {application:{...metadata,job:jobAvailability(application.job,await availabilityContext(pk))}};});}
  async function scheduleGeneration(sub,id,{repair=false}={}){
    if(!dispatch)return runGeneration(sub,id);
    const pk=`USER#${sub}`,attemptId=randomUUID(),attemptedAt=iso(),dispatchLeaseUntil=new Date(Date.now()+DISPATCH_LEASE_MS).toISOString();
    const claimed=await retryConflict(async()=>{
      const row=await store.get(pk,`GEN#${id}`);if(!row||row.value.status!=='pending'||row.value.providerStartedAt||futureIso(row.value.leaseExpiresAt)||futureIso(row.value.dispatchLeaseUntil))return false;
      if(row.value.dispatchedAt&&(!repair||recentIso(row.value.dispatchedAt,DISPATCH_REPAIR_MS)))return false;
      const generation={...row.value,dispatchAttemptId:attemptId,dispatchAttemptedAt:attemptedAt,dispatchLeaseUntil,dispatchAttempts:(row.value.dispatchAttempts??0)+1};
      if(repair)delete generation.dispatchedAt;
      await store.transact([change(pk,`GEN#${id}`,row,generation)]);return true;
    });
    if(!claimed)return false;
    try{await dispatch({kind:'generate',userSub:sub,generationId:id});}
    catch{
      await retryConflict(async()=>{
        const row=await store.get(pk,`GEN#${id}`);if(!row||row.value.status!=='pending'||row.value.dispatchAttemptId!==attemptId||row.value.providerStartedAt)return;
        await store.transact([change(pk,`GEN#${id}`,row,{...row.value,pendingReason:'DISPATCH_OUTCOME_UNKNOWN',pendingSince:attemptedAt})]);
      });
      return false;
    }
    await retryConflict(async()=>{
      const row=await store.get(pk,`GEN#${id}`);if(!row||row.value.status!=='pending'||row.value.dispatchAttemptId!==attemptId)return;
      const generation={...row.value,dispatchedAt:iso()};delete generation.dispatchAttemptId;delete generation.dispatchLeaseUntil;
      if(generation.pendingReason==='DISPATCH_OUTCOME_UNKNOWN'){delete generation.pendingReason;delete generation.pendingSince;}
      await store.transact([change(pk,`GEN#${id}`,row,generation)]);
    });
    return true;
  }
  const generationReference=(sub,id,extra={})=>({tenantHash:generationTenantHash(sub),generationId:id,...extra});
  async function markProviderOutcomeUnknown(sub,id){
    const pk=`USER#${sub}`;
    return retryConflict(async()=>{
      const row=await store.get(pk,`GEN#${id}`);if(!row||row.value.status!=='pending')return row;
      const legacyStarted=row.value.lease&&!row.value.leaseExpiresAt&&!row.value.providerStartedAt;
      if(!row.value.providerStartedAt&&!legacyStarted||row.value.providerStartedAt&&futureIso(row.value.leaseExpiresAt))return row;
      if(row.value.pendingReason==='PROVIDER_OUTCOME_UNKNOWN')return row;
      await store.transact([change(pk,`GEN#${id}`,row,{...row.value,providerStartedAt:row.value.providerStartedAt??row.value.lease,pendingReason:'PROVIDER_OUTCOME_UNKNOWN',pendingSince:iso()})]);
      return store.get(pk,`GEN#${id}`);
    });
  }
  async function repairPendingGeneration(registry){
    if(!validGenerationRegistration(registry)){
      return {state:'failure',failure:{code:'INVALID_OUTBOX_RECORD',registryKeyHash:createHash('sha256').update(String(registry?.sk??'')).digest('hex')}};
    }
    const {userSub:sub,generationId:id}=registry.value,pk=`USER#${sub}`;
    const row=await store.get(pk,`GEN#${id}`);
    if(!row||row.value.status!=='pending'){
      await removeGenerationRegistration(sub,id);
      return {state:'cleaned'};
    }
    const legacyStarted=row.value.lease&&!row.value.leaseExpiresAt&&!row.value.providerStartedAt;
    if(row.value.providerStartedAt||legacyStarted){
      if(row.value.providerStartedAt&&futureIso(row.value.leaseExpiresAt))return {state:'waiting'};
      const marked=await markProviderOutcomeUnknown(sub,id);
      if(!marked||marked.value.status!=='pending'){await removeGenerationRegistration(sub,id);return {state:'cleaned'};}
      return {state:'reconciliation',reconciliation:generationReference(sub,id,{pendingSince:marked.value.pendingSince??marked.value.providerStartedAt})};
    }
    if(futureIso(row.value.leaseExpiresAt)||futureIso(row.value.dispatchLeaseUntil)||recentIso(row.value.dispatchedAt,DISPATCH_REPAIR_MS))return {state:'waiting'};
    if(await scheduleGeneration(sub,id,{repair:true}))return {state:'requeued'};
    const latest=await store.get(pk,`GEN#${id}`);
    if(!latest||latest.value.status!=='pending'){
      await removeGenerationRegistration(sub,id);
      return {state:'cleaned'};
    }
    if(latest.value.providerStartedAt){
      if(futureIso(latest.value.leaseExpiresAt))return {state:'waiting'};
      const marked=await markProviderOutcomeUnknown(sub,id);
      return {state:'reconciliation',reconciliation:generationReference(sub,id,{pendingSince:marked?.value.pendingSince??latest.value.providerStartedAt})};
    }
    if(latest.value.pendingReason==='DISPATCH_OUTCOME_UNKNOWN')return {state:'failure',failure:generationReference(sub,id,{code:'DISPATCH_OUTCOME_UNKNOWN',attempts:latest.value.dispatchAttempts??0,pendingSince:latest.value.pendingSince})};
    return {state:'waiting'};
  }
  async function repairPendingGenerations({cursor=null}={}){
    const backfill=await backfillPendingGenerationRegistrations(),after=generationRepairAfter(cursor);
    const page=store.listPage
      ?await store.listPage(GENERATION_OUTBOX_PK,'',{after,limit:GENERATION_REPAIR_PAGE_SIZE})
      :await (async()=>{const rows=(await store.list(GENERATION_OUTBOX_PK)).filter(row=>after===null||row.sk>after),items=rows.slice(0,GENERATION_REPAIR_PAGE_SIZE);return {items,nextAfter:rows.length>GENERATION_REPAIR_PAGE_SIZE?items.at(-1).sk:null};})();
    const result={backfill,examined:page.items.length,requeued:0,waiting:0,cleaned:0,reconciliationRequired:[],failures:[...backfill.failures],continued:false};
    for(let index=0;index<page.items.length;index+=10){
      const outcomes=await Promise.all(page.items.slice(index,index+10).map(repairPendingGeneration));
      for(const outcome of outcomes){
        if(outcome.state==='requeued')result.requeued++;
        else if(outcome.state==='waiting')result.waiting++;
        else if(outcome.state==='cleaned')result.cleaned++;
        else if(outcome.state==='reconciliation')result.reconciliationRequired.push(outcome.reconciliation);
        else if(outcome.state==='failure')result.failures.push(outcome.failure);
      }
    }
    if(page.nextAfter){
      if(typeof dispatch!=='function')throw Error('Generation repair continuation queue is unavailable');
      await dispatch({kind:'generation-repair-fanout',cursor:generationRepairCursor(page.nextAfter)});result.continued=true;
    }
    return result;
  }
  async function generate(user,appId,key,input={}){
    if(!key||!/^[a-zA-Z0-9_-]{16,100}$/.test(key))fail(400,'IDEMPOTENCY_REQUIRED','Supply a unique generation request key.');
    const pk=pkOf(user),id=createHash('sha256').update(`${user.sub}:${key}`).digest('hex'),sk=`GEN#${id}`,outboxSk=generationOutboxKey(user.sub,id);
    const result=await retryConflict(async()=>{
      await assertActive(pk);const previous=await store.get(pk,sk);if(previous){if(previous.value.appId!==appId)fail(409,'KEY_ALREADY_USED','Use a new request key for another application.');return {generation:previous.value,billing:billingView(await getEntitlement(pk)),created:false};}
      if(requireAiConsent&&input.aiProcessingConfirmed!==true)fail(400,'AI_CONSENT_REQUIRED','Confirm that OpenAI may process your reviewed resume and this job description before generating.');
      const app=await store.get(pk,`APP#${appId}`),profile=await store.get(pk,'PROFILE');if(!app)fail(404,'NOT_FOUND','Application not found.');if(!profile?.value.confirmed)fail(409,'PROFILE_INCOMPLETE','Confirm your reviewed profile before generating.');
      if(jobAvailability(app.value.job,await availabilityContext(pk)).availability==='closed')fail(409,'OPPORTUNITY_CLOSED','This opportunity is closed. Your existing letters remain available, but new generation is disabled.');
      if(!(await provider?.available()))fail(503,'SERVICE_UNAVAILABLE','Cover-letter generation is temporarily unavailable or the daily budget is exhausted. Your allowance has not been used.');
      const row=await store.get(pk,'ENTITLEMENT'),e=row?.value??blankEntitlement(),view=billingView(e);
      if(!view.canGenerate){
        const message=view.reason==='STARTER_REQUIRED'
          ?'Buy the A$1 starter pack to generate two cover letters.'
          :view.reason==='ALLOWANCE_EXHAUSTED'
            ?'All 50 cover letters for this billing period have been used.'
            :'Your two starter cover letters have been used. Subscribe for A$20/month for 50 letters.';
        fail(402,view.reason,message);
      }
      const bucket=view.plan==='monthly'?'paid':'starter';e[bucket]??={key:null,purchaseId:null,status:'none',used:0,reserved:0};e[bucket].reserved++;
      const generation={id,appId,status:'pending',createdAt:iso(),bucket,periodKey:e[bucket].key??'lifetime',profileSnapshot:profile.value,jobSnapshot:app.value.job,...(input.aiProcessingConfirmed===true?{aiConsentAt:iso(),aiConsentVersion:'roleclue-ai-2026-10-12'}:{})};
      const registry=await store.get(GENERATION_OUTBOX_PK,outboxSk);
      if(registry&&!validGenerationRegistration(registry))throw Error('Pending generation registry conflict');
      const registration=registry
        ?{pk:registry.pk,sk:registry.sk,expected:registry.revision,checkOnly:true}
        :change(GENERATION_OUTBOX_PK,outboxSk,null,generationRegistrationValue(user.sub,id,generation.createdAt));
      await store.transact([change(pk,'ENTITLEMENT',row,e),change(pk,sk,null,generation),registration]);return {generation,billing:billingView(e),created:true};
    });
    if(result.generation.status==='pending')await ensureGenerationRegistration(user.sub,id,result.generation.createdAt);
    if(result.created){if(dispatch)await scheduleGeneration(user.sub,id);else try{await runGeneration(user.sub,id);}catch(error){if(!error.uncertain)throw error;}}
    return generationResult(user,id);
  }
  async function generationResult(user,id){const pk=pkOf(user);await assertActive(pk);let row=await store.get(pk,`GEN#${id}`);if(!row)fail(404,'NOT_FOUND','Generation not found.');if(row.value.status==='pending')await ensureGenerationRegistration(user.sub,id,row.value.createdAt);if(dispatch&&row.value.status==='pending'&&!row.value.providerStartedAt&&!row.value.dispatchedAt&&!futureIso(row.value.dispatchLeaseUntil)){await scheduleGeneration(user.sub,id);row=await store.get(pk,`GEN#${id}`);}return {generation:publicGeneration(row.value),billing:billingView(await getEntitlement(pk))};}
  async function finishGeneration(sub,id,text,message){
    const pk=`USER#${sub}`,outboxSk=generationOutboxKey(sub,id);return retryConflict(async()=>{const [row,registry]=await Promise.all([store.get(pk,`GEN#${id}`),store.get(GENERATION_OUTBOX_PK,outboxSk)]);
      if(registry&&!validGenerationRegistration(registry))throw Error('Pending generation registry conflict');
      if(!row||row.value.status!=='pending'){if(registry)await store.transact([{pk:registry.pk,sk:registry.sk,expected:registry.revision,remove:true}]);return;}
      const eRow=await store.get(pk,'ENTITLEMENT'),e=eRow?.value??blankEntitlement(),g=row.value,bucket=e[g.bucket];const bucketMatches=g.bucket==='free'||bucket?.key===g.periodKey;
      const accessRevoked=g.bucket==='starter'&&['refunded','disputed'].includes(bucket?.status)||g.bucket==='paid'&&['refunded','disputed'].includes(e.status);
      const acceptedText=text&&!accessRevoked?text:null;
      if(bucketMatches){bucket.reserved=Math.max(0,bucket.reserved-1);if(acceptedText)bucket.used++;}
      const safe=publicGeneration(g),letter=acceptedText?{id,text:acceptedText,createdAt:iso(),editedAt:null}:undefined;
      const generation={...safe,status:acceptedText?'succeeded':'failed',completedAt:iso(),...(letter?{letter}:{error:accessRevoked?'Your paid allowance was revoked before this letter completed. No generation was consumed.':message??'Generation failed. Your allowance was restored.'})};
      const changes=[change(pk,'ENTITLEMENT',eRow,e),change(pk,`GEN#${id}`,row,generation)];
      if(letter)changes.push(change(pk,`LETTER#${g.appId}#${id}`,null,letter));
      if(registry)changes.push({pk:registry.pk,sk:registry.sk,expected:registry.revision,remove:true});
      await store.transact(changes);
    });
  }
  async function runGeneration(sub,id){
    const pk=`USER#${sub}`;if(await store.get(pk,'DELETING'))return;
    const initial=await store.get(pk,`GEN#${id}`);if(initial?.value.status==='pending')await ensureGenerationRegistration(sub,id,initial.value.createdAt);
    const leaseId=randomUUID(),lease=iso(),leaseExpiresAt=new Date(Date.now()+WORKER_LEASE_MS).toISOString();
    const claimed=await retryConflict(async()=>{
      const row=await store.get(pk,`GEN#${id}`);if(!row||row.value.status!=='pending')return null;
      const legacyStarted=row.value.lease&&!row.value.leaseExpiresAt&&!row.value.providerStartedAt;
      if(row.value.providerStartedAt||legacyStarted){
        if(!futureIso(row.value.leaseExpiresAt)&&row.value.pendingReason!=='PROVIDER_OUTCOME_UNKNOWN')await store.transact([change(pk,`GEN#${id}`,row,{...row.value,providerStartedAt:row.value.providerStartedAt??row.value.lease,pendingReason:'PROVIDER_OUTCOME_UNKNOWN',pendingSince:iso()})]);
        throw Object.assign(new Error('Generation requires operator reconciliation: provider outcome unknown.'),{uncertain:true,code:'PROVIDER_OUTCOME_UNKNOWN'});
      }
      if(futureIso(row.value.leaseExpiresAt))return null;
      const generation={...row.value,lease,leaseId,leaseExpiresAt};await store.transact([change(pk,`GEN#${id}`,row,generation)]);return generation;
    });
    if(!claimed)return;
    const started=await retryConflict(async()=>{
      const row=await store.get(pk,`GEN#${id}`);if(!row||row.value.status!=='pending'||row.value.leaseId!==leaseId||row.value.providerStartedAt||!futureIso(row.value.leaseExpiresAt))return null;
      const generation={...row.value,providerStartedAt:iso()};delete generation.pendingReason;delete generation.pendingSince;await store.transact([change(pk,`GEN#${id}`,row,generation)]);return generation;
    });
    if(!started)return;
    let text;try{text=await provider.generate(started.profileSnapshot,started.jobSnapshot,id);if(typeof text!=='string'||text.trim().length<100||text.length>16000)throw new Error('Unusable output');}catch(error){
      if(error.uncertain){
        await retryConflict(async()=>{const row=await store.get(pk,`GEN#${id}`);if(!row||row.value.status!=='pending')return;await store.transact([change(pk,`GEN#${id}`,row,{...row.value,pendingReason:'PROVIDER_OUTCOME_UNKNOWN',pendingSince:iso()})]);});
        throw Object.assign(new Error('Generation requires operator reconciliation: provider outcome unknown.'),{uncertain:true,code:'PROVIDER_OUTCOME_UNKNOWN'});
      }
      await finishGeneration(sub,id,null,'The provider could not produce a usable letter. Your allowance was restored.');return;
    }
    if(await store.get(pk,'DELETING'))return;await finishGeneration(sub,id,text.trim());
  }
  async function editLetter(user,appId,id,input){const pk=pkOf(user);const text=safeString(input.text,16001);if(!text||text.length>16000)fail(400,'INVALID_LETTER','Enter a letter of no more than 16,000 characters.');return retryConflict(async()=>{await assertActive(pk);const row=await store.get(pk,`LETTER#${appId}#${id}`);if(!row)fail(404,'NOT_FOUND','Letter not found.');const letter={...row.value,text,editedAt:iso()};await store.transact([change(pk,`LETTER#${appId}#${id}`,row,letter)]);return {letter};});}
  async function checkout(user,input){
    if(input.termsAccepted!==true)fail(400,'TERMS_REQUIRED','Accept the membership terms before subscribing.');
    if(!billing)fail(503,'SERVICE_UNAVAILABLE','Subscriptions are not yet enabled.');
    const plan=input.plan??'monthly';if(!['starter','monthly'].includes(plan))fail(400,'INVALID_PLAN','Choose the A$1 starter pack or A$20 monthly plan.');
    const pk=pkOf(user),owner=randomUUID();await assertActive(pk);
    await retryConflict(async()=>{const row=await store.get(pk,'CHECKOUT_LOCK');if(row?.value.until>Date.now())fail(409,'CHECKOUT_PENDING','Checkout is already being prepared. Please retry in a moment.');await store.transact([change(pk,'CHECKOUT_LOCK',row,{owner,until:Date.now()+120000})]);});
    try{
      if(billing.reconcile)await billing.reconcile(user.sub,store);
      const entitlement=await getEntitlement(pk);
      if(plan==='monthly'&&hasManagedSubscription(entitlement))return billing.portal(user,store);
      if(plan==='starter'&&!billingView(entitlement).canPurchaseStarter)fail(409,'STARTER_NOT_ELIGIBLE','The starter pack is available only before a successful starter or subscription payment. Subscribe for A$20/month for 50 cover letters.');
      const cached=await store.get(pk,'CHECKOUT'),cachedPlan=cached?.value.plan??'monthly';let reusable=cachedPlan===plan&&cached?.value.expiresAt>Date.now()&&cached?.value.termsVersion===TERMS_VERSION;
      if(cached?.value.sessionId||cached?.value.url){
        if(!cached.value.sessionId||!billing.checkoutState)fail(503,'SERVICE_UNAVAILABLE','The previous checkout could not be verified. Contact support before starting another subscription.');
        const state=await billing.checkoutState(user,store,cached.value.sessionId,cachedPlan);
        if(state.status==='open'&&cachedPlan!==plan)fail(409,'CHECKOUT_PENDING','Finish or cancel the open checkout before choosing another plan.');
        if(state.status==='open'&&cached.value.url)return {url:cached.value.url};
        if(!['complete','expired'].includes(state.status))fail(503,'SERVICE_UNAVAILABLE','The previous checkout is still being checked. Try again shortly.');
        if(!billing.reconcile)fail(503,'SERVICE_UNAVAILABLE','The previous subscription could not be verified.');
        await billing.reconcile(user.sub,store);
        const refreshed=await getEntitlement(pk);
        if(plan==='monthly'&&(hasManagedSubscription(refreshed)||cachedPlan==='monthly'&&state.status==='complete'&&state.hasSubscription===true))return billing.portal(user,store);
        if(plan==='starter'&&(!billingView(refreshed).canPurchaseStarter||cachedPlan==='starter'&&state.starterPurchased===true))fail(409,'STARTER_NOT_ELIGIBLE','The starter pack is available only before a successful starter or subscription payment. Subscribe for A$20/month for 50 cover letters.');
        if(state.status==='complete'&&state.ended!==true)fail(503,'SERVICE_UNAVAILABLE','The completed checkout has not confirmed its payment. Refresh billing or contact support.');
        reusable=false;
      }
      const request=reusable?cached.value:{plan,requestKey:randomUUID(),expiresAt:Date.now()+3600000,acceptedAt:iso(),termsVersion:TERMS_VERSION};
      await store.transact([change(pk,'CHECKOUT',cached,request)]);
      const result=await billing.checkout(user,store,request);
      await retryConflict(async()=>{const row=await store.get(pk,'CHECKOUT');await store.transact([change(pk,'CHECKOUT',row,{...request,url:result.url,...(result.sessionId?{sessionId:result.sessionId}:{}),expiresAt:result.expiresAt??request.expiresAt})]);});
      return {url:result.url};
    }finally{const row=await store.get(pk,'CHECKOUT_LOCK');if(row?.value.owner===owner)await store.transact([{pk,sk:'CHECKOUT_LOCK',expected:row.revision,remove:true}]);}
  }
  async function portal(user){if(!billing)fail(503,'SERVICE_UNAVAILABLE','Billing management is not yet enabled.');return billing.portal(user,store);}
  async function refreshBilling(user){
    if(!billing?.reconcile)fail(503,'SERVICE_UNAVAILABLE','Subscriptions are not yet enabled.');
    const pk=pkOf(user);await assertActive(pk);
    await retryConflict(async()=>{const row=await store.get(pk,'RATE#BILLING_REFRESH');if(row?.value.until>Date.now())fail(429,'BILLING_REFRESH_LIMIT','Wait ten seconds before refreshing billing again.');await store.transact([{...change(pk,'RATE#BILLING_REFRESH',row,{until:Date.now()+10000}),ttl:Math.floor(Date.now()/1000)+86400}]);});
    await billing.reconcile(user.sub,store);const view=billingView(await getEntitlement(pk));return {billing:view,continuation:await resolveContinuation(pk,view)};
  }
  async function exportAccount(user,cursor){
    await assertActive(pkOf(user));const records=[],semanticRows=[];
    for(const row of await store.list(pkOf(user))){
      let value;
      if(row.sk==='PROFILE'){const {resumeObjectKey:_resumeObjectKey,resumeUploadId:_resumeUploadId,...profile}=row.value;value=profile;}
      else if(row.sk==='ENTITLEMENT')value=billingView(row.value);
      else if(/^(APP#|LETTER#|DECISION#|IMPORTED_JOB#)/.test(row.sk))value=row.value;
      else if(row.sk.startsWith('GEN#'))value=publicGeneration(row.value);
      if(value){records.push({type:row.sk,value});semanticRows.push(row);}
    }
    const state=paginationState(user,'export',semanticRows,cursor);
    if(state.index>records.length||state.letterOffset)fail(400,'INVALID_CURSOR','This export page cursor is invalid.');
    const page={schemaVersion:1,exportedAt:state.at,records:[],nextCursor:null};
    let bytes=jsonBytes(page)+CURSOR_HEADROOM,index=state.index;
    while(index<records.length&&page.records.length<100){
      const record=records[index],extra=jsonBytes(record)+(page.records.length?1:0);
      if(bytes+extra>PAGE_BYTES){if(page.records.length)break;fail(413,'PAGE_TOO_LARGE','An account record is too large to export safely. Contact support.');}
      page.records.push(record);bytes+=extra;index++;
    }
    if(index<records.length)page.nextCursor=nextPageCursor({...state,index});
    return assertPageFits(page);
  }
  async function deleteAccount(user,input){
    if(input.confirmation!=='DELETE')fail(400,'CONFIRMATION_REQUIRED','Type DELETE to confirm.');
    const pk=pkOf(user),deletedSk=tombstoneKey(user.sub);
    if(!(await store.get('ACCOUNT#deleted',deletedSk))){
      let billingDeletion=null;
      if(billing?.reconcile&&(await getEntitlement(pk)).customerId){
        await billing.reconcile(user.sub,store);
        if(billing.deletionState){
          billingDeletion=await billing.deletionState(user,store);
          if(billingDeletion.managedSubscription)fail(409,'CANCEL_SUBSCRIPTION_FIRST','Cancel your subscription and wait until it has ended before deleting your account.');
          if(billingDeletion.pending)fail(409,'CHECKOUT_PENDING','Stripe is still processing a checkout payment. Wait for its final result before deleting your account.');
        }
      }
      if((await store.list(pk,'GEN#')).some(r=>r.value.status==='pending'))fail(409,'GENERATION_PENDING','Wait for pending cover-letter requests before deleting your account.');
      await retryConflict(async()=>{
        const row=await store.get(pk,'DELETING'),entitlement=await store.get(pk,'ENTITLEMENT'),tombstone=await store.get('ACCOUNT#deleted',deletedSk);
        if(tombstone)return;
        const checkout=await store.get(pk,'CHECKOUT'),checkoutLock=await store.get(pk,'CHECKOUT_LOCK');
        const uploadState=await store.get(pk,'UPLOAD_STATE');
        if(uploadState?.value.activeGrantUntil>Date.now())fail(409,'UPLOAD_GRANT_ACTIVE','A recent upload link is still active. Wait up to seven minutes after starting your latest upload before deleting your account.');
        const checkoutVerified=Boolean(checkout?.value.sessionId&&billingDeletion&&billingDeletion.pending===false
          &&billingDeletion.checkoutRevision===checkout.revision&&billingDeletion.sessionId===checkout.value.sessionId);
        if(checkoutLock?.value.until>Date.now()||checkout?.value.expiresAt>Date.now()&&!checkoutVerified
          ||checkout?.value.sessionId&&billingDeletion&&!checkoutVerified)fail(409,'CHECKOUT_PENDING','A checkout session is still open or changed during verification. Wait for its final result before deleting.');
        const e=entitlement?.value??blankEntitlement();
        if(hasManagedSubscription(e))fail(409,'CANCEL_SUBSCRIPTION_FIRST','Cancel your subscription and wait until it has ended before deleting your account.');
        if((e.free?.reserved??0)+(e.starter?.reserved??0)+(e.paid?.reserved??0)>0)fail(409,'GENERATION_PENDING','Wait for pending cover-letter requests before deleting your account.');
        await store.transact([
          change(pk,'DELETING',row,{startedAt:iso()}),
          change('ACCOUNT#deleted',deletedSk,null,{deleted:true}),
          {pk,sk:'ENTITLEMENT',expected:entitlement?.revision??0,checkOnly:true},
          {pk,sk:'CHECKOUT',expected:checkout?.revision??0,checkOnly:true},
          {pk,sk:'CHECKOUT_LOCK',expected:checkoutLock?.revision??0,checkOnly:true},
          {pk,sk:'UPLOAD_STATE',expected:uploadState?.revision??0,checkOnly:true}
        ]);
      });
    }
    await removeRecommendationRegistration(user.sub);
    await removeGenerationRegistrationsForSub(user.sub);
    const guestPartitions=[...new Set((await store.list(pk,'GUEST_CLAIM#')).map(row=>{
      if(typeof row.value.guestPartition==='string'&&/^GUEST#[a-f0-9]{64}$/.test(row.value.guestPartition))return row.value.guestPartition;
      const hash=row.sk.slice('GUEST_CLAIM#'.length);return /^[a-f0-9]{64}$/.test(hash)?`GUEST#${hash}`:null;
    }).filter(Boolean))];
    if(files)await files.removeUser(user.sub);
    for(const guestPk of guestPartitions)await store.removePartition(guestPk);
    // Preserve the tombstone, but remove all account data before revoking the identity.
    // If identity removal fails, the still-valid token can retry this idempotent flow.
    await store.removePartition(pk);
    if(identity)await identity.remove(user.identityUsername??user.sub);
    return {deleted:true};
  }
  return {assertActive:user=>assertActive(pkOf(user)),capabilities,account,completeContinuation,saveProfile,uploadResume,startUpload,finalizeUpload,startGuest,readGuest,guestResume,saveGuestProfile,searchGuest,ignoreGuest,claimGuest,abandonGuest,opportunities,refreshOpportunities,refreshRecommendationsForSub,queueRecommendationRefreshes,repairPendingGenerations,importOpportunity,decision,applications,updateApplication,generate,generationResult,runGeneration,editLetter,checkout,portal,refreshBilling,exportAccount,deleteAccount,webhook:async(raw,sig)=>{if(!billing)fail(503,'SERVICE_UNAVAILABLE','Billing is unavailable.');return billing.webhook(raw,sig,store);}};
}
