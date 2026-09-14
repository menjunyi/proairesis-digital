import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpinionHandler} from '../scripts/release/booking-handler.mjs';
const origin='https://proairesis.digital';
const event=(changes={})=>({headers:{origin,'content-type':'application/json'},requestContext:{http:{sourceIp:'192.0.2.1'}},body:JSON.stringify({name:'Test',email:'reply@example.com',message:'Please add more location filters.',website:'',requestId:'12345678-1234-1234-1234-123456789abc',...changes})});
test('staging accepts valid messages without sending email',async()=>{
 const handler=createOpinionHandler({environment:'staging',origin,send:()=>assert.fail('Must not send')});
 assert.deepEqual(JSON.parse((await handler(event())).body),{sent:true,testMode:true});
});
test('rejects cross-origin, honeypot and malformed messages before email access',async()=>{
 const handler=createOpinionHandler({environment:'production',origin,getSecret:()=>assert.fail('Must not access credentials')});
 assert.equal((await handler({...event(),headers:{origin:'https://evil.example'}})).statusCode,403);
 for(const bad of [{website:'bot'},{email:'bad\r\n@example.com'},{message:'short'},{name:'<script>'}])assert.equal((await handler(event(bad))).statusCode,400);
});
test('acceptance follows email success and duplicate messages do not send again',async()=>{
 let sent=0,completed=false;
 const handler=createOpinionHandler({environment:'production',origin,getSecret:async()=> 'test-secret',reserve:async()=>completed?'sent':'reserved',send:async payload=>{sent++;assert.equal(payload.email,'reply@example.com');},complete:async()=>{completed=true;}});
 assert.equal((await handler(event())).statusCode,200);assert.equal(completed,true);
 assert.equal((await handler(event())).statusCode,200);assert.equal(sent,1);
});
test('rate limits, pending deliveries and service failures cannot report sent',async()=>{
 const base={environment:'production',origin,getSecret:async()=> 'test-secret',send:async()=>assert.fail('Must not send')};
 assert.equal((await createOpinionHandler({...base,reserve:async()=> 'limited'})(event())).statusCode,429);
 assert.equal((await createOpinionHandler({...base,reserve:async()=> 'pending'})(event())).statusCode,409);
 const failed=createOpinionHandler({...base,reserve:async()=> 'reserved',send:async()=>{throw Error('private provider error');},complete:()=>assert.fail('Must not complete')});
 const r=await failed(event());assert.equal(r.statusCode,503);assert.equal(r.body.includes('private provider'),false);
});
