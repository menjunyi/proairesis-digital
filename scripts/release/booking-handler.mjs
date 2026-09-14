import {createHmac} from 'node:crypto';
let cachedSecret;
async function loadSecret(){if(!cachedSecret){const {SSMClient,GetParameterCommand}=await import('@aws-sdk/client-ssm');const r=await new SSMClient({}).send(new GetParameterCommand({Name:process.env.BOOKING_SECRET_PARAMETER,WithDecryption:true}));cachedSecret=r.Parameter?.Value;}return cachedSecret;}
async function deliverOpinion({name,email,message}) {
 const {SESv2Client,SendEmailCommand}=await import('@aws-sdk/client-sesv2');
 await new SESv2Client({}).send(new SendEmailCommand({FromEmailAddress:'hello@proairesis.digital',Destination:{ToAddresses:['hello@proairesis.digital']},ReplyToAddresses:[email],Content:{Simple:{Subject:{Data:'A visitor shared an idea for RoleClue',Charset:'UTF-8'},Body:{Text:{Data:`Name: ${name || 'Not provided'}\nReply email: ${email}\n\n${message}`,Charset:'UTF-8'}}}}}));
}
async function reserveOpinion({key,client,now}) {
 const {DynamoDBClient,UpdateItemCommand,PutItemCommand,GetItemCommand}=await import('@aws-sdk/client-dynamodb');
 const db=new DynamoDBClient({}),TableName=process.env.OPINION_TABLE;
 const existing=await db.send(new GetItemCommand({TableName,Key:{id:{S:key}},ConsistentRead:true}));
 if(existing.Item)return existing.Item.status.S==='sent'?'sent':'pending';
 try{await db.send(new UpdateItemCommand({TableName,Key:{id:{S:`rate:${client}:${Math.floor(now/3600)}`}},UpdateExpression:'SET expiresAt = :expires ADD attempts :one',ConditionExpression:'attribute_not_exists(attempts) OR attempts < :limit',ExpressionAttributeValues:{':expires':{N:String(now+7200)},':one':{N:'1'},':limit':{N:'5'}}}));}catch(e){if(e.name==='ConditionalCheckFailedException')return 'limited';throw e;}
 try{await db.send(new PutItemCommand({TableName,Item:{id:{S:key},status:{S:'pending'},expiresAt:{N:String(now+86400)}},ConditionExpression:'attribute_not_exists(id)'}));}catch(e){if(e.name==='ConditionalCheckFailedException')return 'pending';throw e;}
 return 'reserved';
}
async function completeOpinion(key){const {DynamoDBClient,UpdateItemCommand}=await import('@aws-sdk/client-dynamodb');await new DynamoDBClient({}).send(new UpdateItemCommand({TableName:process.env.OPINION_TABLE,Key:{id:{S:key}},UpdateExpression:'SET #status = :sent',ExpressionAttributeNames:{'#status':'status'},ExpressionAttributeValues:{':sent':{S:'sent'}}}));}
export function createOpinionHandler({environment=process.env.DEPLOYMENT_ENV,origin=process.env.SITE_ORIGIN,getSecret=loadSecret,send=deliverOpinion,reserve=reserveOpinion,complete=completeOpinion}={}){
 const reply=(statusCode,value)=>({statusCode,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(value)});
 return async event=>{
  if(!['staging','production'].includes(environment))return reply(503,{error:'Messaging is unavailable.'});
  const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(headers.origin!==origin)return reply(403,{error:'Invalid request origin.'});
  if(!headers['content-type']?.startsWith('application/json'))return reply(415,{error:'Use JSON.'});
  let value;
  try{const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString():event.body||'';if(Buffer.byteLength(raw)>16000)return reply(413,{error:'Message too long.'});value=JSON.parse(raw);}catch{return reply(400,{error:'Invalid request.'});}
  if(!value||typeof value.name!=='string'||value.name.length>100||/[\r\n<>]/.test(value.name)||typeof value.email!=='string'||value.email.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.email)||typeof value.message!=='string'||value.message.trim().length<10||value.message.length>3000||value.website||typeof value.requestId!=='string'||! /^[a-f0-9-]{36}$/i.test(value.requestId))return reply(400,{error:'Check your email and enter a message of 10–3,000 characters.'});
  const payload={name:value.name.trim(),email:value.email.trim(),message:value.message.trim()};
  if(environment==='staging')return reply(200,{sent:true,testMode:true});
  try{
   const secret=await getSecret();if(!secret)throw Error('Missing secret');
   const hash=text=>createHmac('sha256',secret).update(text).digest('hex');
   const key='message:'+hash(JSON.stringify(payload));
   const state=await reserve({key,client:hash(event.requestContext?.http?.sourceIp||'unknown'),now:Math.floor(Date.now()/1000)});
   if(state==='sent')return reply(200,{sent:true});
   if(state==='limited')return reply(429,{error:'Too many messages. Please try again later.'});
   if(state!=='reserved')return reply(409,{error:'This message is already being processed. Please wait before retrying.'});
   await send(payload);await complete(key);return reply(200,{sent:true});
  }catch{return reply(503,{error:'We couldn’t confirm delivery. Please wait before retrying, or email hello@proairesis.digital.'});}
 };
}
export function testSlots(date,now=new Date()){
 const day=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
 const base=Date.parse(date+'T00:00:00Z');if(!Number.isFinite(base)||new Date(base).toISOString().slice(0,10)!==date||date<day(now)||date>day(new Date(now.getTime()+60*86400000)))throw Error('Invalid date');
 const out=[];for(let t=base-14*3600000;t<base+14*3600000;t+=1800000){const d=new Date(t),time=new Intl.DateTimeFormat('en-GB',{timeZone:'Australia/Sydney',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);if(day(d)===date&&time>='08:00'&&time<'20:00'&&t>=now.getTime()+4*3600000)out.push(d.toISOString());}return out;
}
export function createHandler({environment=process.env.DEPLOYMENT_ENV,origin=process.env.SITE_ORIGIN,getSecret=loadSecret,fetcher=fetch,endpoint=process.env.BOOKING_BRIDGE_URL}={}){
 const reply=(statusCode,value)=>({statusCode,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'},body:JSON.stringify(value)});
 return async event=>{
  const method=event.requestContext?.http?.method;const route=event.rawPath;const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(!['staging','production'].includes(environment))return reply(503,{error:'Booking is unavailable.'});
  if(route==='/api/booking/message'&&method==='POST')return createOpinionHandler({environment,origin,getSecret})(event);
  const availability=route==='/api/booking/availability'&&method==='GET';const confirmation=route==='/api/booking/confirm'&&method==='POST';
  if(!availability&&!confirmation)return reply(404,{error:'Not found.'});
  if(confirmation&&headers.origin!==origin)return reply(403,{error:'Invalid request origin.'});
  let payload;
  if(availability)payload={action:'availability',date:event.queryStringParameters?.date};
  else {try{const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString():event.body||'';if(Buffer.byteLength(raw)>4096)return reply(413,{error:'Request too large.'});const value=JSON.parse(raw);if(!value||value.website||value.consent!==true||typeof value.name!=='string'||!value.name.trim()||value.name.length>100||/[\r\n<>]/.test(value.name)||typeof value.email!=='string'||value.email.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.email)||typeof value.start!=='string')return reply(400,{error:'Check your details and consent.'});payload={action:'book',date:value.date,start:value.start,name:value.name,email:value.email};}catch{return reply(400,{error:'Invalid request.'});}}
  if(typeof payload.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(payload.date))return reply(400,{error:'Choose a valid date.'});
  // Staging never contacts the production calendar or sends invitations.
  if(environment==='staging'){try{const slots=testSlots(payload.date);if(availability)return reply(200,{slots,testMode:true,connected:true,timeZone:'Australia/Sydney'});if(!slots.includes(payload.start))return reply(409,{error:'Choose a currently available time.'});return reply(200,{confirmed:true,testMode:true,start:payload.start,meetUrl:null});}catch{return reply(400,{error:'Choose a valid date within the next 60 days.'});}}
  try{
   if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint||''))throw Error('Missing bridge');
   const secret=await getSecret();if(!secret)throw Error('Missing credential');
   const client=createHmac('sha256',secret).update(event.requestContext?.http?.sourceIp||'unknown').digest('hex');
   const result=await fetcher(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,client,secret}),signal:AbortSignal.timeout(25000)});
   if(!result.ok)throw Error('Bridge failed');const value=await result.json();if(!value||value.ok!==true){const error=typeof value?.error==='string'&&/^(Invalid|Choose|Enter|That time|Too many|Please try|Calendar availability)/.test(value.error)?value.error:'The calendar could not complete this request. Please try again.';return reply(409,{error});}
   if(availability){if(!Array.isArray(value.slots)||!value.slots.every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v))))throw Error('Invalid bridge response');return reply(200,{slots:value.slots,connected:true,timeZone:'Australia/Sydney'});}
   if(typeof value.start!=='string'||value.start!==payload.start)throw Error('Invalid confirmation');return reply(200,{confirmed:true,start:value.start,meetUrl:typeof value.meetUrl==='string'&&value.meetUrl.startsWith('https://meet.google.com/')?value.meetUrl:null});
  }catch{return reply(503,{error:'The calendar is temporarily unavailable. If an invitation arrived, your booking was created; contact hello@proairesis.digital before retrying.'});}
 };
}
export const handler=createHandler();
