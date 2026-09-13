import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import {createHash} from 'node:crypto';

function backend({busy=[],existing=null}={}){
 const state={inserts:0,locked:false};
 const context=vm.createContext({Date,JSON,Number,Object,String,Error,Utilities:{formatDate(d,zone,fmt){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(p=>[p.type,p.value]));return fmt==='yyyy-MM-dd'?`${parts.year}-${parts.month}-${parts.day}`:`${parts.hour}:${parts.minute}`;},DigestAlgorithm:{SHA_256:'sha256'},computeDigest(_,s){return [...createHash('sha256').update(s).digest()];}},PropertiesService:{getScriptProperties(){return {getProperty(k){return {BOOKING_SECRET:'test-only-secret',CALENDAR_ID:'brand-calendar'}[k];}};}},ContentService:{MimeType:{JSON:'json'},createTextOutput(s){return {setMimeType(){return JSON.parse(s);}};}},LockService:{getScriptLock(){return {tryLock(){state.locked=true;return true;},hasLock(){return state.locked;},releaseLock(){state.locked=false;}};}},CacheService:{getScriptCache(){return {get(){return null;},put(){}};}},Calendar:{Freebusy:{query(){return {calendars:{primary:{busy},brand:{busy:[]}}};}},Events:{get(){if(existing)return existing;throw new Error('404 Not Found');},insert(event){state.inserts++;return event;}}}});
 vm.runInContext(fs.readFileSync(new URL('../integrations/google-booking/Code.gs',import.meta.url),'utf8'),context);
 return {context,state};
}

test('Sydney slots remain 08:00–19:30 across the October daylight-saving change',()=>{
 const {context:c}=backend();
 for(const [date,first] of [['2026-10-03','2026-10-02T22:00:00.000Z'],['2026-10-04','2026-10-03T21:00:00.000Z']]){
  const slots=c.slots_(date,new Date('2026-09-12T00:00:00Z'));
  assert.equal(slots.length,24);assert.equal(slots[0],first);
  assert.equal(c.Utilities.formatDate(new Date(slots.at(-1)),'Australia/Sydney','HH:mm'),'19:30');
 }
});
test('rejects invalid dates and dates outside the booking window',()=>{
 const {context:c}=backend();
 for(const date of ['2026-09-31','2026-08-01','2027-01-01']) assert.throws(()=>c.slots_(date,new Date('2026-09-12T00:00:00Z')));
});
test('honors minimum notice and overlap boundaries',()=>{
 const {context:c}=backend();const now=new Date('2026-09-12T00:00:00Z');
 assert.equal(c.slots_('2026-09-12',now)[0],'2026-09-12T04:00:00.000Z');
 const busy=[{start:'2026-09-12T05:00:00Z',end:'2026-09-12T06:00:00Z'}];
 assert.equal(c.free_('2026-09-12T04:30:00Z',busy),true);
 assert.equal(c.free_('2026-09-12T05:30:00Z',busy),false);
 assert.equal(c.free_('2026-09-12T06:00:00Z',busy),true);
});
test('unauthorized requests never reach the calendar',()=>{
 const {context:c,state}=backend();const r=c.doPost({postData:{contents:JSON.stringify({secret:'wrong'})}});
 assert.equal(r.ok,false);assert.equal(state.inserts,0);assert.equal(state.locked,false);
});
test('a repeated confirmation reuses its event without sending invitations twice',()=>{
 const {context:c,state}=backend({existing:{status:'confirmed',start:{dateTime:'existing'},hangoutLink:'meeting'}});
 const now=new Date();const date=c.day_(new Date(now.getTime()+86400000));const start=c.slots_(date,now)[0];
 const r=c.doPost({postData:{contents:JSON.stringify({secret:'test-only-secret',action:'book',date,start,name:'Test Guest',email:'guest@example.com'})}});
 assert.equal(r.ok,true);assert.equal(state.inserts,0);assert.equal(state.locked,false);
});
test('conflict on confirmation refuses to create an event',()=>{
 const {context:c,state}=backend({busy:[{start:'2000-01-01T00:00:00Z',end:'2100-01-01T00:00:00Z'}]});
 const now=new Date();const date=c.day_(new Date(now.getTime()+86400000));const start=c.slots_(date,now)[0];
 const r=c.doPost({postData:{contents:JSON.stringify({secret:'test-only-secret',action:'book',date,start,name:'Test Guest',email:'guest@example.com'})}});
 assert.equal(r.ok,false);assert.match(r.error,/just booked/);assert.equal(state.inserts,0);assert.equal(state.locked,false);
});
