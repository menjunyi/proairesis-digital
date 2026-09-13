/* Deploy as a web app, executing as the business account. Public requests require
 * a server-held shared secret. Run setup once before deployment. */
const ZONE = 'Australia/Sydney';
const HOST = 'hello@proairesis.digital';
function setup() {
  const p = PropertiesService.getScriptProperties();
  if (!p.getProperty('BOOKING_SECRET')) p.setProperty('BOOKING_SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!p.getProperty('CALENDAR_ID')) {
    const c = Calendar.Calendars.insert({summary:'RoleClue', timeZone:ZONE});
    p.setProperty('CALENDAR_ID',c.id);
  }
}
function result_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function day_(d) { return Utilities.formatDate(d,ZONE,'yyyy-MM-dd'); }
function slots_(date, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid date.');
  // Search UTC instants and map to Sydney, so daylight saving is never a fixed offset.
  const base = Date.parse(date+'T00:00:00Z');
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0,10)!==date) throw new Error('Invalid date.');
  if (date<day_(now) || date>day_(new Date(now.getTime()+60*86400000))) throw new Error('Choose a date within the next 60 days.');
  const out=[];
  for(let t=base-14*3600000;t<base+14*3600000;t+=1800000) {
    const d=new Date(t), hm=Utilities.formatDate(d,ZONE,'HH:mm');
    if(day_(d)===date && hm>='08:00' && hm<'20:00' && t>=now.getTime()+4*3600000) out.push(d.toISOString());
  }
  return out;
}
function busy_(slots, id) {
  if(!slots.length) return [];
  const r=Calendar.Freebusy.query({timeMin:slots[0],timeMax:new Date(Date.parse(slots[slots.length-1])+1800000).toISOString(),items:[{id:'primary'},{id:id}]});
  const calendars=Object.values(r.calendars || {});
  if(calendars.length!==2 || calendars.some(c=>c.errors && c.errors.length)) throw new Error('Calendar availability is temporarily unavailable.');
  return calendars.flatMap(c=>c.busy || []);
}
function free_(start,busy) { const t=Date.parse(start);return !busy.some(b=>Date.parse(b.start)<t+1800000 && Date.parse(b.end)>t); }
function hash_(s) {return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function rate_(key,limit) {
  const cache=CacheService.getScriptCache(), k=hash_(key), n=Number(cache.get(k)||0);
  if(n>=limit) throw new Error('Too many requests. Please try again later.');
  cache.put(k,String(n+1),3600);
}
function doPost(e) {
  const p=PropertiesService.getScriptProperties();
  let r;
  try { r=JSON.parse(e.postData.contents); } catch (_) { return result_({ok:false,error:'Invalid request.'}); }
  if(!p.getProperty('BOOKING_SECRET') || r.secret!==p.getProperty('BOOKING_SECRET')) return result_({ok:false,error:'Unauthorized.'});
  const id=p.getProperty('CALENDAR_ID');
  if(!id) return result_({ok:false,error:'Booking is not connected yet.'});
  const lock=LockService.getScriptLock();
  try {
    if(!lock.tryLock(15000)) throw new Error('Please try again in a moment.');
    rate_('ip:'+r.client,r.action==='book'?120:300);
    const now=new Date(), slots=slots_(r.date,now);
    if(r.action==='availability') {
      const busy=busy_(slots,id);
      return result_({ok:true,slots:slots.filter(s=>free_(s,busy)),timeZone:ZONE});
    }
    if(r.action!=='book') throw new Error('Invalid action.');
    const name=String(r.name||'').trim(), email=String(r.email||'').trim().toLowerCase();
    if(name.length<1 || name.length>100 || /[\r\n<>]/.test(name) || email.length>254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email===HOST) throw new Error('Enter your name and a valid email address.');
    const start=String(r.start||'');
    if(!slots.includes(start)) throw new Error('That time is no longer available. Choose another time.');
    const eventId=hash_('roleclue:'+start+':'+email);
    // A repeated confirmation reuses the same event and sends no extra invitations.
    let existing;
    try { existing=Calendar.Events.get(id,eventId); } catch(err) { if(!/not found|404/i.test(String(err))) throw err; }
    if(existing && existing.status!=='cancelled') return result_({ok:true,start:existing.start.dateTime,meetUrl:existing.hangoutLink||null});
    rate_('email:'+email,3);
    if(!free_(start,busy_(slots,id))) throw new Error('That time was just booked. Choose another time.');
    const event=Calendar.Events.insert({id:eventId,summary:'RoleClue conversation',description:'A 30-minute conversation about your Australian job search.\nGuest: '+name+'\nContact: '+HOST,start:{dateTime:start,timeZone:ZONE},end:{dateTime:new Date(Date.parse(start)+1800000).toISOString(),timeZone:ZONE},attendees:[{email:email,displayName:name},{email:HOST,displayName:'RoleClue'}],guestsCanInviteOthers:false,guestsCanSeeOtherGuests:false,conferenceData:{createRequest:{requestId:eventId,conferenceSolutionKey:{type:'hangoutsMeet'}}}},id,{sendUpdates:'all',conferenceDataVersion:1});
    return result_({ok:true,start:start,meetUrl:event.hangoutLink||null});
  } catch(err) {
    const message=String(err.message||err);
    const safe=/^(Invalid|Choose|Enter|That time|Too many|Please try|Calendar availability)/.test(message);
    return result_({ok:false,error:safe?message:'We could not confirm the booking. Please try again. If you received an invitation, your booking was created.'});
  } finally { if(lock.hasLock()) lock.releaseLock(); }
}
