import {createHmac} from 'node:crypto';
let cachedSecret;
async function loadSecret(){if(!cachedSecret){const {SSMClient,GetParameterCommand}=await import('@aws-sdk/client-ssm');const r=await new SSMClient({}).send(new GetParameterCommand({Name:process.env.BOOKING_SECRET_PARAMETER,WithDecryption:true}));cachedSecret=r.Parameter?.Value;}return cachedSecret;}
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
