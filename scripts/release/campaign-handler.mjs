import {randomUUID} from 'node:crypto';
export const validSlug=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{2,59}$/.test(value);
export const validUuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const destinations=['/','/book'];
export function day(now){const parts=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');}
export function range(from,to,now){const start=from||day(now-27*86400000),end=to||day(now);const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;if(!valid(start)||!valid(end)||start>end||start<day(now-89*86400000)||end>day(now))throw Error('Choose dates within the last 90 days.');return {start,end};}
export function createCampaignHandler({store,origin,clock=Date.now}={}) {
 const reply=(statusCode,value,headers={})=>({statusCode,headers:{'content-type':'application/json','cache-control':'no-store',...headers},body:JSON.stringify(value)});
 return async event=>{
  const now=clock();
  try {
   // Only IAM-authenticated direct Lambda invocations can supply this envelope.
   // API Gateway always supplies requestContext; its HTTP body is never dispatched as an admin command.
   if(!event.requestContext&&event.adminAction){
    const slug=event.slug;
    if(event.adminAction==='report'){const {start,end}=range(event.from,event.to,now);return await store.report(start,end,now);}
    if(!validSlug(slug))throw Error('Use 3–60 lowercase letters, numbers or hyphens.');
    if(event.adminAction==='create'){
     if(typeof event.name!=='string'||!event.name.trim()||event.name.length>100||!destinations.includes(event.destination))throw Error('Add a name and approved landing page.');
     await store.create({slug,name:event.name.trim(),destination:event.destination,status:'active',created_at:now},event.actor,now);
    }else if(['archive','restore'].includes(event.adminAction)){await store.status(slug,event.adminAction==='archive'?'archived':'active',event.actor,now);}
    else throw Error('Unknown campaign action.');
    return {slug};
   }
   const method=event.requestContext?.http?.method,route=event.rawPath||'';
   const headers=Object.fromEntries(Object.entries(event.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));
   if(method==='GET'&&route.startsWith('/r/')){
    const slug=route.slice(3);
    if(!validSlug(slug))return reply(404,{error:'Campaign not found.'});
    const campaign=await store.find(slug);
    if(!campaign)return reply(404,{error:'Campaign not found.'});
    if(!destinations.includes(campaign.destination))return reply(503,{error:'Campaign destination unavailable.'});
    const test=event.queryStringParameters?.rc_test==='1';
    const bot=/bot|crawler|spider|preview|facebookexternalhit|headless|slurp/i.test(headers['user-agent']||'');
    try{await store.request(slug,day(now),bot||test,now);}catch{/* Navigation remains available if counters fail. */}
    const target=new URL(campaign.destination,origin);target.search=new URLSearchParams({rc_campaign:slug,utm_source:'linkedin',utm_medium:'social',utm_campaign:slug}).toString();if(test)target.searchParams.set('rc_test','1');
    return reply(302,{}, {location:target.href,'x-robots-tag':'noindex, nofollow'});
   }
   if(method==='POST'&&route==='/api/campaigns/visit'){
    if(headers.origin!==origin)return reply(403,{error:'Origin not allowed.'});
    const raw=event.isBase64Encoded?Buffer.from(event.body||'','base64').toString():event.body||'';
    if(Buffer.byteLength(raw)>1024)return reply(413,{error:'Request too large.'});
    let body;try{body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid event.'});}
    if(!body||body.consent!==true||!validSlug(body.campaign)||!validUuid(body.visitor)||!validUuid(body.event))return reply(400,{error:'Invalid event.'});
    if(body.test===true||/bot|crawler|spider|preview|headless/i.test(headers['user-agent']||''))return reply(204,{});
    if(!await store.find(body.campaign))return reply(404,{error:'Campaign not found.'});
    await store.visit(body.campaign,body.visitor,body.event,now);
    return reply(204,{});
   }
   return reply(404,{error:'Not found.'});
  }catch(e){
   if(!event.requestContext)return {error:e instanceof Error&&/^(Choose|Use|Add|Unknown|Campaign|That)/.test(e.message)?e.message:'Campaign service unavailable.'};
   if(event.requestContext?.http?.method==='GET'&&(event.rawPath||'').startsWith('/r/'))return reply(302,{}, {location:new URL('/',origin).href});
   return reply(503,{error:'Campaign service unavailable.'});
  }
 };
}
export async function dynamoStore(table, injected){
 const {DynamoDBClient}=injected||await import('@aws-sdk/client-dynamodb');
 const {DynamoDBDocumentClient,GetCommand,QueryCommand,UpdateCommand,TransactWriteCommand}=injected||await import('@aws-sdk/lib-dynamodb');
 const client=DynamoDBDocumentClient.from(new DynamoDBClient({}));
 const send=(Command,input)=>client.send(new Command({TableName:table,...input}));
 const ttl=now=>Math.floor(now/1000)+90*86400;
 const key=slug=>`C#${slug}`;
 const get=async(pk,sk)=>(await send(GetCommand,{Key:{pk,sk},ConsistentRead:true})).Item;
 async function query(pk,from,to){let cursor;const items=[];do{const r=await send(QueryCommand,{KeyConditionExpression:'pk = :p AND sk BETWEEN :a AND :b',ExpressionAttributeValues:{':p':pk,':a':from,':b':to},ExclusiveStartKey:cursor,ConsistentRead:true});items.push(...(r.Items||[]));cursor=r.LastEvaluatedKey;if(items.length>20000)throw Error('Campaign report is too large. Choose a shorter period.');}while(cursor);return items;}
 const audit=(slug,action,actor,now)=>({Put:{TableName:table,Item:{pk:'AUDIT',sk:`${now}#${randomUUID()}`,slug,action,actor:typeof actor==='string'?actor.slice(0,200):'IAM caller',expires:ttl(now)}}});
 return {
  find:slug=>get('CAMPAIGNS',slug),
  async create(c,actor,now){try{await client.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:table,Item:{pk:'CAMPAIGNS',sk:c.slug,...c},ConditionExpression:'attribute_not_exists(pk)'}},audit(c.slug,'created',actor,now)]}));}catch(e){if(e.name==='TransactionCanceledException')throw Error('That campaign link already exists.');throw e;}},
  async status(slug,status,actor,now){await client.send(new TransactWriteCommand({TransactItems:[{Update:{TableName:table,Key:{pk:'CAMPAIGNS',sk:slug},UpdateExpression:'SET #s = :s',ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':s':status},ConditionExpression:'attribute_exists(pk)'}},audit(slug,status,actor,now)]}));},
  async request(slug,date,excluded,now){await send(UpdateCommand,{Key:{pk:key(slug),sk:`R#${date}`},UpdateExpression:'SET expires = :e ADD #total :one, excluded :x',ExpressionAttributeNames:{'#total':'total'},ExpressionAttributeValues:{':e':ttl(now),':one':1,':x':excluded?1:0}});},
  async visit(slug,visitor,event,now){
   const pk=key(slug),browserKey={pk,sk:`B#${visitor}`};
   for(let attempt=0;attempt<5;attempt++){
    if(await get(pk,`E#${event}`))return;
    const browser=await get(pk,browserKey.sk);
    const accepted=!browser||browser.lastSeen<=now-1800000;
    const conditions=browser?{ConditionExpression:'lastSeen = :old',ExpressionAttributeValues:{':old':browser.lastSeen}}:{ConditionExpression:'attribute_not_exists(pk)'};
    const writes=[{Put:{TableName:table,Item:{pk,sk:`E#${event}`,expires:ttl(now)},ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:table,Item:{...browserKey,lastSeen:Math.max(now,browser?.lastSeen||0),expires:ttl(now)},...conditions}}];
    if(accepted)writes.push({Put:{TableName:table,Item:{pk,sk:`V#${day(now)}#${event}`,visitor,day:day(now),at:now,expires:ttl(now)},ConditionExpression:'attribute_not_exists(pk)'}});
    try{await client.send(new TransactWriteCommand({TransactItems:writes}));return;}catch(e){if(e.name!=='TransactionCanceledException')throw e;}
   }throw Error('Campaign event busy; retry later.');
  },
  async report(start,end,now){
   const all=await query('CAMPAIGNS','0','~');const campaigns=[],daily=[];
   if(all.length>100)throw Error('Campaign limit exceeded.');
   for(const c of all){const [raw,visits]=await Promise.all([query(key(c.slug),`R#${start}`,`R#${end}~`),query(key(c.slug),`V#${start}`,`V#${end}~`)]);
    campaigns.push({slug:c.slug,name:c.name,destination:c.destination,status:c.status,created_at:c.created_at,requests:raw.reduce((a,r)=>a+(r.total||0),0),excluded:raw.reduce((a,r)=>a+(r.excluded||0),0),visits:visits.length,visitors:new Set(visits.map(v=>v.visitor)).size});
    const days=new Map();for(const v of visits)days.set(v.day,(days.get(v.day)||0)+1);for(const [date,count]of days)daily.push({campaign:c.slug,day:date,visits:count});
   }
   return {campaigns:campaigns.sort((a,b)=>b.created_at-a.created_at),daily,from:start,to:end,updatedAt:new Date(now).toISOString()};
  }
 };
}
let runtime;
export async function handler(event){runtime??=createCampaignHandler({store:await dynamoStore(process.env.CAMPAIGN_TABLE),origin:process.env.SITE_ORIGIN});return runtime(event);}
