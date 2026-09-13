'use client';
// This component is also bundled standalone without Next routing.
/* eslint-disable next/no-html-link-for-pages, jsx-a11y/prefer-tag-over-role */

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Clock3, Globe2, Video } from 'lucide-react';

const zone='Australia/Sydney';
function sydneyDay() { return new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function dateLabel(date:string) { return new Intl.DateTimeFormat('en-AU',{dateStyle:'full',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')); }
function timeLabel(iso:string) { return new Intl.DateTimeFormat('en-AU',{hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(iso)); }

export function BookingCalendar() {
  const [today,setToday]=useState('');
  const [month,setMonth]=useState('');
  const [date,setDate]=useState('');
  const [slots,setSlots]=useState<string[]>([]);
  const [slot,setSlot]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [step,setStep]=useState(1);
  const [submitting,setSubmitting]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [email,setEmail]=useState('');
  const [testMode,setTestMode]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{const id=setTimeout(()=>{const d=sydneyDay();const tomorrow=new Date(d+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const selected=tomorrow.toISOString().slice(0,10);setToday(d);setDate(selected);setMonth(selected.slice(0,7));},0);return()=>clearTimeout(id);},[]);
  useEffect(()=>{
    if(!date)return;
    const controller=new AbortController();
    fetch(`/api/booking/availability?date=${date}`,{signal:controller.signal,cache:'no-store'})
      .then(async r=>{const data: unknown=await r.json();if(!data || typeof data!=='object')throw new Error('Invalid calendar response.');if(!r.ok)throw new Error('error' in data && typeof data.error==='string'?data.error:'Unable to load availability.');if(!('slots' in data) || !Array.isArray(data.slots) || !data.slots.every((value: unknown)=>typeof value==='string' && Number.isFinite(Date.parse(value))))throw new Error('Invalid calendar availability.');if(!controller.signal.aborted){setSlots(data.slots);setTestMode('testMode' in data && data.testMode===true);}})
      .catch(e=>{if(!controller.signal.aborted&&e.name!=='AbortError')setError(e.message || 'Unable to load availability. Please try again.');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[date,refresh]);
  const maxDay=today?new Date(Date.parse(today+'T12:00:00Z')+60*86400000).toISOString().slice(0,10):'';
  const [year,mon]=month.split('-').map(Number);
  const utcDate=(y:number,m:number,d:number)=>new Date(`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}T12:00:00Z`);
  const days=month?new Date(new Date(month+'-01T12:00:00Z').getUTCFullYear(),mon,0).getDate():0;
  const padding=month?(utcDate(year,mon-1,1).getUTCDay()+6)%7:0;
  function resetAvailability(){setLoading(true);setError('');setSlots([]);setSlot('');}
  function chooseDate(value:string){if(value===date)return;resetAvailability();setDate(value);}
  function reloadAvailability(){resetAvailability();setRefresh(x=>x+1);}
  function moveMonth(delta:number){const next=new Date(month+'-01T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+delta);setMonth(next.toISOString().slice(0,7));}
  async function confirm(event:React.SyntheticEvent<HTMLFormElement>){
    event.preventDefault(); if(submitting)return;
    const form=new FormData(event.currentTarget);setSubmitting(true);setError('');
    try {
      const response=await fetch('/api/booking/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date,start:slot,name:form.get('name'),email:form.get('email'),website:form.get('website'),consent:form.get('consent')==='on'})});
      const data: unknown=await response.json();if(!response.ok || !data || typeof data!=='object' || !('confirmed' in data) || data.confirmed!==true)throw new Error(data && typeof data==='object' && 'error' in data && typeof data.error==='string'?data.error:'Your booking could not be confirmed.');
      setEmail(typeof form.get('email')==='string'?form.get('email') as string:'');setConfirmed(true);
    }catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setSubmitting(false);}
  }
  return <div className="booking-shell">
    <aside className="booking-intro">
      <p className="booking-kicker"><span aria-hidden="true">👋 </span>LET’S TALK</p>
      <h1>Your search.<br/><em>A real conversation.</em></h1>
      <p className="booking-description">Tell me where your job search gets stuck. We’ll look at the roles you want, the requirements in your way, and whether RoleClue could help.</p>
      <div className="booking-early-access"><strong><span aria-hidden="true">🎁 </span>Be one of the first. Get one month free.</strong><p>Book a conversation with me and you’ll be invited to join RoleClue’s first group of users.</p><p>I’ll send your early-access invitation to the email address you use for this booking.</p></div>
      <ul className="booking-facts"><li><Clock3 size={18}/>30 minutes</li><li><Video size={18}/>Online conversation</li><li><Globe2 size={18}/>Sydney time · 8 am–8 pm daily</li></ul>
      <div className="booking-person"><span className="booking-avatar" aria-hidden="true">✦</span><div><strong>RoleClue</strong><span>A working project, shaped by real searches.</span></div></div>
      <p className="booking-small">No preparation needed. Bring your ideas and questions — I’d love to hear them.</p>
    </aside>
    <section className="booking-panel" aria-label="Book a conversation">
      {confirmed ? <div className="booking-success" role="status"><span className="booking-success-icon"><Check size={32}/></span><p className="booking-kicker">YOU’RE BOOKED</p><h2>See you soon! <span aria-hidden="true">🎉</span></h2><p>{dateLabel(date)}<br/>{timeLabel(slot)} · Sydney time</p><p>{testMode?<>Test booking complete. No invitation was sent and no real calendar time was reserved.</>:<>Your calendar invitation is on its way to <strong>{email}</strong>. Check it for the meeting details.</>}</p><a href="/" className="booking-primary">Back to RoleClue <ArrowRight size={17}/></a></div> : <>
        <div className="booking-steps" aria-label={`Step ${step} of 2`}><span className={step===1?'active':''}>01 <span>Date & time</span></span><span aria-hidden="true">—</span><span className={step===2?'active':''}>02 <span>Your details</span></span></div>
        {step===1 ? <>
          <h2>Make time for your next move.</h2>{testMode&&<p className="booking-muted">Staging test calendar — no real reservation or invitation is created.</p>}<p className="booking-muted">Choose a day, then a time that works for you.</p>
          <div className="booking-picker">
            <div className="booking-month">
              <div className="booking-month-heading"><h3>{month?new Intl.DateTimeFormat('en-AU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z')):'Loading calendar…'}</h3><div><button type="button" aria-label="Previous month" disabled={!month || month<=today.slice(0,7)} onClick={()=>moveMonth(-1)}><ChevronLeft size={18}/></button><button type="button" aria-label="Next month" disabled={!month || month>=maxDay.slice(0,7)} onClick={()=>moveMonth(1)}><ChevronRight size={18}/></button></div></div>
              <div className="booking-days">{['M','T','W','T','F','S','S'].map((d,i)=><span className="booking-weekday" key={i}>{d}</span>)}{Array.from({length:padding},(_,i)=><span key={'pad'+i}/>)}{Array.from({length:days},(_,i)=>{const value=`${month}-${String(i+1).padStart(2,'0')}`;return <button type="button" key={value} disabled={value<today || value>maxDay} aria-label={dateLabel(value)} aria-pressed={date===value} className={date===value?'selected':''} onClick={()=>chooseDate(value)}>{i+1}</button>;})}</div>
              <p className="booking-timezone"><Globe2 size={14}/>Australia / Sydney<br/><span>Daylight saving adjusts automatically.</span></p>
            </div>
            <div className="booking-times" aria-busy={loading}>
              <h3>{date?new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')):'Available times'}</h3>
              {loading?<p className="booking-status" role="status">Checking the calendar…</p>:error?<div className="booking-status" role="status"><p>{error}</p><button type="button" className="booking-retry" onClick={reloadAvailability}>Try again</button></div>:slots.length?<div className="booking-slot-grid">{slots.map(s=><button type="button" key={s} className={slot===s?'selected':''} aria-pressed={slot===s} onClick={()=>setSlot(s)}>{timeLabel(s)}</button>)}</div>:<p className="booking-status" role="status">No times available on this day. Please choose another date.</p>}
            </div>
          </div>
          <div className="booking-bottom"><p>{slot?<>{timeLabel(slot)} · 30 min<br/><span>Sydney time</span></>:'Choose a time to continue.'}</p><button type="button" className="booking-primary" disabled={!slot || loading} onClick={()=>{setError('');setStep(2);}}>Continue <ArrowRight size={17}/></button></div>
        </> : <>
          <button type="button" className="booking-back" disabled={submitting} onClick={()=>{setStep(1);reloadAvailability();}}><ArrowLeft size={16}/>Change date or time</button><h2>A few details, then we’re set.</h2><p className="booking-selection">{dateLabel(date)} · {timeLabel(slot)}<br/><span>30 minutes · Sydney time</span></p>
          <form onSubmit={confirm} className="booking-form"><label>Your name<input name="name" autoComplete="name" required maxLength={100} disabled={submitting}/></label><label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} disabled={submitting}/></label><div hidden><label>Website<input name="website" tabIndex={-1} autoComplete="off"/></label></div><label className="booking-consent"><input name="consent" type="checkbox" required disabled={submitting}/><span>Send me a calendar invitation and use these details to arrange this conversation. <a href="/privacy">Privacy policy</a></span></label>{error&&<p className="booking-error" role="alert">{error}</p>}<button className="booking-primary" disabled={submitting}>{submitting?'Confirming…':'Confirm booking'} <ArrowRight size={17}/></button><p className="booking-small">Your time is reserved only after confirmation.</p></form>
        </>}
      </>}
    </section>
  </div>;
}
