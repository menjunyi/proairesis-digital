import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,change} from '../server/store.mjs';
import {createService} from '../server/service.mjs';
import {createHttpHandler} from '../server/handler.mjs';
import {normalizeImportedJob} from '../server/imported-jobs.mjs';

const alice={sub:'alice',email:'alice@example.test'},bob={sub:'bob',email:'bob@example.test'};
const bytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const stamp='2026-10-12T00:00:00.000Z';
function fixture(){
  const store=new MemoryStore();
  const service=createService({store,feed:{status:async()=>({status:'not-configured'}),jobs:async()=>[]}});
  return {store,service};
}
async function put(store,sk,value,user=alice){
  const pk=`USER#${user.sub}`,previous=await store.get(pk,sk);
  await store.transact([change(pk,sk,previous,value)]);
}
function job(id,description='Synthetic job description for testing application pagination.'){
  return {id,source:'user-provided',title:'Software Engineer',company:'Synthetic Employer',location:'Sydney, Australia',description,url:`https://example.test/jobs/${id}`,availability:'unknown'};
}
async function app(store,id,description){
  await put(store,`APP#${id}`,{id,job:job(id,description),status:'interested',notes:'',createdAt:stamp,updatedAt:stamp});
}
async function collect(read){
  const pages=[],seen=new Set();let cursor;
  do{
    const page=await read(cursor);pages.push(page);
    assert.ok(bytes(page)<=1024*1024,'each serialized page is at most 1 MiB');
    assert.ok(pages.length<100,'pagination makes progress');
    assert.ok(page.nextCursor===null||typeof page.nextCursor==='string');
    cursor=page.nextCursor;
    if(cursor){assert.ok(!seen.has(cursor),'cursor does not cycle');seen.add(cursor);}
  }while(cursor!==null);
  return pages;
}
const event=(path,cursor,user=alice)=>({
  rawPath:path,rawQueryString:cursor===undefined?'':`cursor=${encodeURIComponent(cursor)}`,headers:{},
  requestContext:{http:{method:'GET'},authorizer:{jwt:{claims:{sub:user.sub,email:user.email,email_verified:'true',token_use:'id'}}}},
});
const rewrite=(cursor,delta)=>Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')),...delta})).toString('base64url');

test('empty and small lists preserve their response fields and explicitly complete',async()=>{
  const {store,service}=fixture();
  assert.deepEqual(await service.applications(alice),{applications:[],nextCursor:null});
  const empty=await service.exportAccount(alice);
  assert.equal(empty.schemaVersion,1);assert.deepEqual(empty.records,[]);assert.equal(empty.nextCursor,null);
  await app(store,'one');await put(store,'LETTER#one#first',{id:'first',text:'A saved letter'});
  const out=await service.applications(alice);
  assert.equal(out.nextCursor,null);assert.equal(out.applications[0].job.availability,'unknown');
  assert.deepEqual(out.applications[0].letters,[{id:'first',text:'A saved letter'}]);
});

test('valid multibyte imports exceeding 6 MiB export without loss through the HTTP handler',async()=>{
  const {store,service}=fixture();
  for(let i=0;i<110;i++){
    const imported=normalizeImportedJob({title:'Software Engineer',company:'Synthetic Employer',url:`https://example.test/jobs/${i}`,location:'Sydney, Australia',roleFamily:'software',description:'Build software services. '+'工'.repeat(19970),australiaConfirmed:true,permissionConfirmed:true});
    await put(store,`IMPORTED_JOB#${imported.id}`,imported);
  }
  await put(store,'PROFILE',{name:'Alice',resumeObjectKey:'private/key',resumeUploadId:'private-id'});
  await put(store,'GEN#one',{id:'one',status:'pending',profileSnapshot:{private:'resume'},jobSnapshot:{private:'job'},lease:'private-lease'});
  const source=await store.list('USER#alice');assert.ok(bytes(source)>6*1024*1024);
  const handler=createHttpHandler(service);
  const pages=await collect(async cursor=>{
    // Operational counters and upload state are not exported and must not stale the cursor.
    await put(store,'RATE#today',{count:Math.random()});await put(store,'UPLOAD_STATE',{changed:Math.random()});
    const response=await handler(event('/api/export',cursor));assert.equal(response.statusCode,200);
    return JSON.parse(response.body);
  });
  assert.ok(pages.length>1);assert.equal(new Set(pages.map(p=>p.exportedAt)).size,1);
  const records=pages.flatMap(p=>p.records);
  assert.equal(records.length,112);assert.equal(new Set(records.map(r=>r.type)).size,112);
  assert.deepEqual(records.find(r=>r.type==='PROFILE').value,{name:'Alice'});
  assert.deepEqual(records.find(r=>r.type==='GEN#one').value,{id:'one',status:'pending'});
  assert.ok(records.every(r=>!/^(RATE|UPLOAD)/.test(r.type)));
  assert.equal(records.filter(r=>r.type.startsWith('IMPORTED_JOB#')).length,110);
  assert.ok(pages.every(p=>p.records.length<=100));
});

test('application pages split long letter history without missing or duplicate letters',async()=>{
  const {store,service}=fixture();
  for(let i=0;i<24;i++)await app(store,`app-${String(i).padStart(2,'0')}`,'職'.repeat(20000));
  for(let i=0;i<40;i++)await put(store,`LETTER#app-00#letter-${String(i).padStart(2,'0')}`,{id:`letter-${i}`,text:'信'.repeat(16000)});
  const pages=await collect(cursor=>service.applications(alice,cursor));
  const applications=pages.flatMap(p=>p.applications);
  assert.ok(pages.length>2);assert.ok(pages.every(p=>p.applications.length<=20));
  assert.equal(new Set(applications.map(a=>a.id)).size,24);
  const slices=applications.filter(a=>a.id==='app-00');assert.ok(slices.length>1);
  const letters=slices.flatMap(a=>a.letters);
  assert.equal(letters.length,40);assert.equal(new Set(letters.map(l=>l.id)).size,40);
  assert.ok(applications.every(a=>a.job.availability==='unknown'));
  const updated=await service.updateApplication(alice,'app-00',{status:'applied',notes:'Follow up'});
  assert.equal(updated.application.status,'applied');assert.equal(updated.application.notes,'Follow up');
  assert.equal('letters'in updated.application,false);assert.ok(bytes(updated)<1024*1024);
  assert.equal((await store.list('USER#alice','LETTER#app-00#')).length,40);
});

test('count limits paginate small records too',async()=>{
  const {store,service}=fixture();
  for(let i=0;i<105;i++)await app(store,`app-${i}`);
  const applicationPages=await collect(cursor=>service.applications(alice,cursor));
  assert.equal(applicationPages[0].applications.length,20);
  assert.equal(applicationPages.flatMap(p=>p.applications).length,105);
  const exportPages=await collect(cursor=>service.exportAccount(alice,cursor));
  assert.equal(exportPages[0].records.length,100);assert.equal(exportPages[1].records.length,5);
});

test('cursors reject malformed, wrong-tenant, wrong-scope, invalid positions and changed data',async()=>{
  const {store,service}=fixture();
  for(let i=0;i<105;i++){await app(store,`app-${i}`);await app(store,`bob-${i}`);}
  const applications=await service.applications(alice),exported=await service.exportAccount(alice);
  const invalid=e=>e.status===400&&e.code==='INVALID_CURSOR';
  for(const cursor of ['',null,'%%%','e30','x'.repeat(1501),applications.nextCursor+'=',rewrite(applications.nextCursor,{index:10001}),rewrite(applications.nextCursor,{index:999}),rewrite(applications.nextCursor,{letterOffset:1})]){
    await assert.rejects(()=>service.applications(alice,cursor),invalid);
  }
  await assert.rejects(()=>service.applications(bob,applications.nextCursor),invalid);
  await assert.rejects(()=>service.applications(alice,exported.nextCursor),invalid);
  await assert.rejects(()=>service.exportAccount(alice,applications.nextCursor),invalid);
  await assert.rejects(()=>service.exportAccount(alice,rewrite(exported.nextCursor,{letterOffset:1})),invalid);
  await put(store,'RATE#today',{count:1});await put(store,'PROFILE',{name:'Alice'});
  assert.ok((await service.applications(alice,applications.nextCursor)).applications.length);
  await assert.rejects(()=>service.exportAccount(alice,exported.nextCursor),e=>e.status===409&&e.code==='PAGINATION_STALE');
  await put(store,'LETTER#app-0#new',{id:'new',text:'New letter'});
  await assert.rejects(()=>service.applications(alice,applications.nextCursor),e=>e.status===409&&e.code==='PAGINATION_STALE');
});

test('HTTP cursor parsing accepts standard query parameters and rejects duplicate or cross-account cursors',async()=>{
  const {store,service}=fixture();for(let i=0;i<21;i++)await app(store,`app-${i}`);
  const handler=createHttpHandler(service),first=await handler(event('/api/applications'));
  assert.equal(first.statusCode,200);const cursor=JSON.parse(first.body).nextCursor;assert.ok(cursor);
  const fallback={...event('/api/applications'),queryStringParameters:{cursor}};
  assert.equal(JSON.parse((await handler(fallback)).body).applications.length,1);
  const duplicate=await handler({...event('/api/applications',cursor),rawQueryString:`cursor=${cursor}&cursor=${cursor}`});
  assert.equal(duplicate.statusCode,400);assert.equal(JSON.parse(duplicate.body).error.code,'INVALID_CURSOR');
  const cross=await handler(event('/api/applications',cursor,bob));assert.equal(cross.statusCode,400);
  assert.equal((await handler(event('/api/applications',''))).statusCode,400);
});
