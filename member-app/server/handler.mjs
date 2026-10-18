import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {DynamoStore,RecordSizeError} from './store.mjs';
import {createService,HttpError} from './service.mjs';
import {ResumeError} from './resume.mjs';
import {createBilling,createFeed,createFiles,createProvider,secret} from './adapters.mjs';
import {createFreehireSearch} from './freehire.mjs';

const secretMatches=(expected,actual)=>{
  if(typeof expected!=='string'||!expected)return true;
  const candidate=typeof actual==='string'?actual:'';
  const left=createHash('sha256').update(expected).digest(),right=createHash('sha256').update(candidate).digest();
  return timingSafeEqual(left,right)&&candidate.length===expected.length;
};
const guestSourceIp=(event,incoming,originSecret)=>{
  const gatewaySource=event.requestContext?.http?.sourceIp??event.requestContext?.identity?.sourceIp??'';
  if(typeof originSecret!=='string'||!originSecret)return gatewaySource;
  const viewerAddress=typeof incoming['cloudfront-viewer-address']==='string'?incoming['cloudfront-viewer-address'].trim():'';
  const bracketed=viewerAddress.match(/^\[([^\]]+)]:(\d{1,5})$/),separator=viewerAddress.lastIndexOf(':');
  const viewerSource=bracketed?.[1]??viewerAddress.slice(0,separator),portText=bracketed?.[2]??viewerAddress.slice(separator+1),port=Number(portText);
  const valid=viewerAddress.length<=200&&/^\d{1,5}$/.test(portText)&&port>0&&port<=65535&&Boolean(isIP(viewerSource));
  if(!valid)throw new HttpError(403,'INVALID_VIEWER_IDENTITY','This API request does not have a trusted viewer identity.');
  return viewerSource;
};
export function workQueueUrl(payload,env){
  if(['generate','generation-repair-fanout'].includes(payload?.kind))return env.GENERATION_QUEUE_URL;
  if(['recommendation-refresh','recommendation-fanout','billing-reconcile','billing-fanout'].includes(payload?.kind))return env.RECOMMENDATION_QUEUE_URL;
  throw Error('Unsupported async work kind');
}
const decodePathId=value=>{
  let decoded;try{decoded=decodeURIComponent(value);}catch{throw new HttpError(400,'INVALID_PATH_ID','This resource identifier is invalid.');}
  if(!decoded||decoded.length>200||decoded.includes('/')||/[\u0000-\u001f\u007f]/.test(decoded))throw new HttpError(400,'INVALID_PATH_ID','This resource identifier is invalid.');
  return decoded;
};
const ACCOUNT_DELETION_AUTH_MAX_AGE_SECONDS=10*60;
const ACCOUNT_DELETION_AUTH_CLOCK_SKEW_SECONDS=60;
const authTimeFromClaim=value=>{
  const parsed=typeof value==='number'?value:typeof value==='string'&&/^[1-9]\d{0,15}$/.test(value)?Number(value):null;
  return Number.isSafeInteger(parsed)&&parsed>0?parsed:null;
};
const assertRecentDeletionAuth=user=>{
  const now=Math.floor(Date.now()/1000),age=now-user.authTime;
  if(!Number.isSafeInteger(user.authTime)||age>ACCOUNT_DELETION_AUTH_MAX_AGE_SECONDS||age<-ACCOUNT_DELETION_AUTH_CLOCK_SKEW_SECONDS){
    throw new HttpError(401,'REAUTHENTICATION_REQUIRED','For your security, sign out and sign in again before permanently deleting your account.');
  }
};

export async function processGenerationBatch(service,event){
  const failures=[];
  for(const record of event.Records??[]){
    try{
      if(record.eventSource!=='aws:sqs'||typeof record.messageId!=='string'||!record.messageId)throw Error('Invalid SQS record');
      const payload=JSON.parse(record.body??'');
      const validSub=typeof payload?.userSub==='string'&&payload.userSub.length>0&&payload.userSub.length<=160&&!/[\u0000-\u001f\u007f]/.test(payload.userSub);
      if(payload?.kind==='generate'){
        if(Object.keys(payload).sort().join(',')!=='generationId,kind,userSub'||!validSub||typeof payload.generationId!=='string'||!/^[a-f0-9]{64}$/.test(payload.generationId))throw Error('Invalid generation message');
        await service.runGeneration(payload.userSub,payload.generationId);
      }else if(payload?.kind==='recommendation-refresh'){
        if(Object.keys(payload).sort().join(',')!=='kind,userSub'||!validSub)throw Error('Invalid recommendation message');
        await service.refreshRecommendationsForSub(payload.userSub,{background:true});
      }else if(payload?.kind==='recommendation-fanout'){
        if(Object.keys(payload).sort().join(',')!=='after,kind'||typeof payload.after!=='string'||payload.after.length<1||payload.after.length>160||/[\u0000-\u001f\u007f]/.test(payload.after))throw Error('Invalid recommendation fanout message');
        await service.queueRecommendationRefreshes({after:payload.after});
      }else if(payload?.kind==='generation-repair-fanout'){
        if(Object.keys(payload).sort().join(',')!=='cursor,kind'||typeof payload.cursor!=='string'||payload.cursor.length<1||payload.cursor.length>2048||!/^[A-Za-z0-9_-]+$/.test(payload.cursor))throw Error('Invalid generation repair fanout message');
        await processGenerationRepair(service,{cursor:payload.cursor});
      }else if(payload?.kind==='billing-reconcile'){
        if(Object.keys(payload).sort().join(',')!=='customerId,kind,userSub'||!validSub||typeof payload.customerId!=='string'||payload.customerId.length>80||!/^cus_[A-Za-z0-9]+$/.test(payload.customerId))throw Error('Invalid billing reconciliation message');
        await service.reconcileBillingForCustomer(payload.userSub,payload.customerId);
      }else if(payload?.kind==='billing-fanout'){
        if(Object.keys(payload).sort().join(',')!=='after,kind'||typeof payload.after!=='string'||payload.after.length>80||!/^cus_[A-Za-z0-9]+$/.test(payload.after))throw Error('Invalid billing fanout message');
        await service.queueBillingReconciliations({after:payload.after});
      }else throw Error('Invalid work message');
    }catch(error){
      if(typeof record.messageId!=='string'||!record.messageId)throw error;
      if(error?.code==='PROVIDER_OUTCOME_UNKNOWN')console.error(JSON.stringify({event:'generation_reconciliation_required',messageId:record.messageId}));
      console.error(JSON.stringify({event:'async_message_failed',messageId:record.messageId,errorType:String(error?.name??'Error').replace(/[^A-Za-z0-9_]/g,'').slice(0,80)}));
      failures.push({itemIdentifier:record.messageId});
    }
  }
  return {batchItemFailures:failures};
}

export async function processGenerationRepair(service,{cursor=null,log=console.error}={}){
  const result=await service.repairPendingGenerations({cursor});
  for(const failure of result.failures)log(JSON.stringify({event:'generation_dispatch_repair_failed',...failure}));
  for(const pending of result.reconciliationRequired)log(JSON.stringify({event:'generation_reconciliation_required',source:'scheduled-repair',...pending}));
  log(JSON.stringify({event:'generation_repair_completed',examined:result.examined??0,requeued:result.requeued??0,continued:result.continued===true}));
  return result;
}

export async function processDailyRefresh(service,feed,log=console.log){
  let feedResult,feedError;
  try{feedResult=await feed.refresh();}catch(error){feedError=error;}
  const recommendations=await service.queueRecommendationRefreshes();
  if(feedError)throw feedError;
  log(JSON.stringify({event:'daily_refresh_completed',queued:recommendations.queued??0,continued:recommendations.continued===true}));
  return {feed:feedResult,recommendations};
}

export async function processDailyBillingReconciliation(service,log=console.log){
  const result=await service.queueBillingReconciliations();
  log(JSON.stringify({event:'daily_billing_reconciliation_completed',queued:result.queued??0,continued:result.continued===true}));
  return result;
}

export function processAiAuthorityReview(log=console.log){
  log(JSON.stringify({event:'ai_authority_review_required',pricingExpiresAt:'2026-11-11T13:00:00.000Z'}));
  return {ok:true};
}

export function createHttpHandler(service,{mode='production',origins=[],originSecret}={}) {
  return async function http(event){
    const requestId=randomUUID(),headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Request-ID':requestId};
    const incoming=Object.fromEntries(Object.entries(event.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
    const origin=incoming.origin,method=event.requestContext?.http?.method??event.httpMethod??'GET';
    const path=event.rawPath??event.path??'/';
    if(origin&&origins.includes(origin)){headers['Access-Control-Allow-Origin']=origin;headers.Vary='Origin';}
    const reply=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
    try{
      if(!secretMatches(originSecret,incoming['x-roleclue-origin']))throw new HttpError(403,'INVALID_ORIGIN','This API origin is not allowed.');
      if(origin&&!origins.includes(origin))throw new HttpError(403,'INVALID_ORIGIN','This origin is not allowed.');
      if(method==='OPTIONS'){headers['Access-Control-Allow-Methods']='GET,POST,PUT,PATCH,DELETE,OPTIONS';headers['Access-Control-Allow-Headers']='Authorization,Content-Type,Idempotency-Key';return reply(204,{});}
      if(path==='/api/health'&&method==='GET')return reply(200,{ok:true,mode});
      const raw=event.isBase64Encoded?Buffer.from(event.body??'','base64').toString('utf8'):event.body??'';
      if(Buffer.byteLength(raw)>7*1024*1024)throw new HttpError(413,'PAYLOAD_TOO_LARGE','Request too large.');
      if(path==='/api/stripe/webhook'&&method==='POST'){if(Buffer.byteLength(raw)>1024*1024)throw new HttpError(413,'PAYLOAD_TOO_LARGE','Request too large.');return reply(200,await service.webhook(raw,incoming['stripe-signature']));}
      let body={};if(raw){try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{throw new HttpError(400,'INVALID_JSON','Send a valid JSON object.');}}
      if(path.startsWith('/api/guest/')&&(event.rawQueryString||Object.keys(event.queryStringParameters??{}).length))throw new HttpError(400,'INVALID_QUERY','Guest tokens and content must be sent in the request body, not the URL.');
      const sourceIp=path.startsWith('/api/guest/')?guestSourceIp(event,incoming,originSecret):'';
      if(path==='/api/guest/start'&&method==='POST')return reply(200,await service.startGuest(body,sourceIp));
      if(path==='/api/guest/resume'&&method==='POST')return reply(200,await service.guestResume(body,sourceIp));
      if(path==='/api/guest/profile'&&['PUT','POST'].includes(method))return reply(200,await service.saveGuestProfile(body,sourceIp));
      if(path==='/api/guest/search'&&method==='POST')return reply(200,await service.searchGuest(body,sourceIp));
      if(path==='/api/guest/session'&&method==='POST')return reply(200,await service.readGuest(body,sourceIp));
      if(path==='/api/guest/ignore'&&method==='POST')return reply(200,await service.ignoreGuest(body,sourceIp));
      let user;
      if(mode==='demo'){if(incoming.authorization!=='Bearer demo')throw new HttpError(401,'SIGN_IN_REQUIRED','Sign in to continue.');user={sub:'demo-user',email:'demo@example.test',name:'Alex Example',identityUsername:'demo-user',authTime:Math.floor(Date.now()/1000)};}
      else{const claims=event.requestContext?.authorizer?.jwt?.claims,identityUsername=claims?.['cognito:username'];if(!claims?.sub||!claims.email||!(claims.email_verified===true||claims.email_verified==='true')||claims.token_use!=='id'||identityUsername!==undefined&&(typeof identityUsername!=='string'||!identityUsername||identityUsername.length>128||/[\u0000-\u001f\u007f]/.test(identityUsername)))throw new HttpError(401,'SIGN_IN_REQUIRED','Sign in with a verified email to continue.');user={sub:claims.sub,email:claims.email,name:typeof claims.name==='string'?claims.name:'',identityUsername:identityUsername??claims.sub,authTime:authTimeFromClaim(claims.auth_time)};}
      if(!(path==='/api/account'&&method==='DELETE'))await service.assertActive(user);
      const cursor=()=>{
        const query=new URLSearchParams(event.rawQueryString??'');
        if(query.getAll('cursor').length>1)throw new HttpError(400,'INVALID_CURSOR','Send one page cursor.');
        return query.has('cursor')?query.get('cursor'):event.queryStringParameters?.cursor;
      };
      let match,result;
      if(path==='/api/me'&&method==='GET')result=await service.account(user);
      else if(path==='/api/guest/claim'&&method==='POST')result=await service.claimGuest(user,body,sourceIp);
      else if(path==='/api/guest/abandon'&&method==='POST')result=await service.abandonGuest(user,body,sourceIp);
      else if(path==='/api/continuation/complete'&&method==='POST')result=await service.completeContinuation(user,body);
      else if(path==='/api/profile'&&method==='PUT')result=await service.saveProfile(user,body);
      else if(path==='/api/resume'&&method==='POST')result=await service.uploadResume(user,body);
      else if(path==='/api/resume/upload'&&method==='POST')result=await service.startUpload(user,body);
      else if(path==='/api/resume/finalize'&&method==='POST')result=await service.finalizeUpload(user,body);
      else if(path==='/api/opportunities/refresh'&&method==='POST')result=await service.refreshOpportunities(user,body);
      else if(path==='/api/opportunities'&&method==='GET')result=await service.opportunities(user);
      else if(path==='/api/opportunities/import'&&method==='POST')result=await service.importOpportunity(user,body);
      else if(path==='/api/ignored'&&method==='GET')result=await service.opportunities(user,true);
      else if((match=path.match(/^\/api\/opportunities\/([^/]+)\/decision$/))&&method==='POST')result=await service.decision(user,decodePathId(match[1]),body);
      else if(path==='/api/applications'&&method==='GET')result=await service.applications(user,cursor());
      else if((match=path.match(/^\/api\/applications\/([^/]+)$/))&&method==='PATCH')result=await service.updateApplication(user,decodePathId(match[1]),body);
      else if((match=path.match(/^\/api\/applications\/([^/]+)\/letters$/))&&method==='POST'){result=await service.generate(user,decodePathId(match[1]),incoming['idempotency-key'],body);return reply(result.generation.status==='pending'?202:200,result);}
      else if((match=path.match(/^\/api\/generations\/([^/]+)$/))&&method==='GET')result=await service.generationResult(user,decodePathId(match[1]));
      else if((match=path.match(/^\/api\/applications\/([^/]+)\/letters\/([^/]+)$/))&&method==='PATCH')result=await service.editLetter(user,decodePathId(match[1]),decodePathId(match[2]),body);
      else if(path==='/api/billing/checkout'&&method==='POST')result=await service.checkout(user,body);
      else if(path==='/api/billing/portal'&&method==='POST')result=await service.portal(user);
      else if(path==='/api/billing/refresh'&&method==='POST')result=await service.refreshBilling(user);
      else if(path==='/api/export'&&method==='GET')result=await service.exportAccount(user,cursor());
      else if(path==='/api/account'&&method==='DELETE'){assertRecentDeletionAuth(user);result=await service.deleteAccount(user,body);}
      else throw new HttpError(404,'NOT_FOUND','This API route was not found.');
      return reply(200,result);
    }catch(e){
      const expected=e instanceof HttpError||e instanceof ResumeError||e instanceof RecordSizeError;
      if(!expected)console.error(JSON.stringify({event:'request_failed',requestId,errorType:String(e.name??'Error').replace(/[^A-Za-z0-9_]/g,'').slice(0,80)}));
      return reply(e instanceof ResumeError?400:expected?e.status??500:500,{error:{code:e instanceof ResumeError?'INVALID_RESUME':expected?e.code??'INTERNAL_ERROR':'INTERNAL_ERROR',message:expected?e.message:'Something went wrong. Please try again.',requestId}});
    }
  };
}

let runtime;
async function productionRuntime(){
  if(runtime)return runtime;
  const env=process.env;
  if(env.ROLECLUE_LOCAL_DEMO==='1')throw Error('Demo mode is forbidden in the Lambda handler');
  if(!env.TABLE_NAME||!env.RESUME_BUCKET||!env.GENERATION_QUEUE_URL||!env.RECOMMENDATION_QUEUE_URL)throw Error('Production storage and work queues are required');
  const store=await DynamoStore.create(env.TABLE_NAME),feed=createFeed(store,env),files=await createFiles(env.RESUME_BUCKET),billing=await createBilling(env),guestSearch=createFreehireSearch(env);
  const {SQSClient,SendMessageCommand}=await import('@aws-sdk/client-sqs');const sqs=new SQSClient({});
  const identity={async remove(username){const {CognitoIdentityProviderClient,AdminDeleteUserCommand}=await import('@aws-sdk/client-cognito-identity-provider');try{await new CognitoIdentityProviderClient({}).send(new AdminDeleteUserCommand({UserPoolId:env.COGNITO_USER_POOL_ID,Username:username}));}catch(e){if(e.name!=='UserNotFoundException')throw e;}}};
  const service=createService({store,feed,files,billing,identity,guestSearch,guestRateSecret:()=>secret(env.GUEST_RATE_HASH_SECRET_PARAM),requireAiConsent:true,provider:createProvider(store,env),dispatch:async payload=>{const queueUrl=workQueueUrl(payload,env),fifo=queueUrl.endsWith('.fifo'),deduplicationId=payload.kind==='generate'?payload.generationId:createHash('sha256').update(`${payload.kind}:${payload.userSub??payload.cursor??payload.after}:${new Date().toISOString().slice(0,10)}`).digest('hex'),response=await sqs.send(new SendMessageCommand({QueueUrl:queueUrl,MessageBody:JSON.stringify(payload),...(fifo?{MessageGroupId:payload.kind,MessageDeduplicationId:deduplicationId}:{})}));if(!response.MessageId)throw Error('Work message not accepted');}});
  runtime={service,feed,http:createHttpHandler(service,{origins:(env.ALLOWED_ORIGINS??env.SITE_URL??'').split(',').filter(Boolean),originSecret:env.API_ORIGIN_SECRET})};return runtime;
}
export async function handler(event){
  if(event?.kind==='ai-authority-review')return processAiAuthorityReview();
  const r=await productionRuntime();
  if(Array.isArray(event.Records)&&event.Records.some(record=>record.eventSource==='aws:sqs'))return processGenerationBatch(r.service,event);
  if(event?.kind==='generate'){
    if(Object.keys(event).sort().join(',')!=='generationId,kind,userSub'||typeof event.userSub!=='string'||event.userSub.length<1||event.userSub.length>160||/[\u0000-\u001f\u007f]/.test(event.userSub)||typeof event.generationId!=='string'||!/^[a-f0-9]{64}$/.test(event.generationId))throw Error('Invalid generation event');
    await r.service.runGeneration(event.userSub,event.generationId);return {ok:true};
  }
  if(event?.kind==='generation-repair'){
    if(Object.keys(event).join(',')!=='kind')throw Error('Invalid generation repair event');
    return processGenerationRepair(r.service);
  }
  if(event?.kind==='billing-reconciliation'){
    if(Object.keys(event).join(',')!=='kind')throw Error('Invalid billing reconciliation event');
    return processDailyBillingReconciliation(r.service);
  }
  if(event?.kind==='feed-refresh')return processDailyRefresh(r.service,r.feed);
  return r.http(event);
}
