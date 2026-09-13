import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {sha,draft} from './bundle.mjs';
const [environment,releaseDir]=process.argv.slice(2);
const origin=environment==='staging'?'https://staging.proairesis.digital':'https://proairesis.digital';
const manifest=JSON.parse(await readFile(`${releaseDir}/manifest.json`));
if(manifest.environment!==environment)throw Error('Smoke environment mismatch');
const evidence=[];
for(const [file,hash]of Object.entries(manifest.files)){
 if(file.startsWith('server/'))continue;
 const response=await fetch(`${origin}/${file}`,{cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!response.ok||sha(Buffer.from(await response.arrayBuffer()))!==hash)throw Error(`Live artifact mismatch: ${file}`);
 evidence.push({file,status:response.status});
}
for(const route of manifest.routes){const r=await fetch(origin+route);const text=await r.text();if(!r.ok||draft(text))throw Error(`Public route failed: ${route}`);if(environment==='staging'&&!text.includes('noindex, nofollow'))throw Error('Staging is indexable');}
const missing=await fetch(origin+'/release-smoke-missing-page');if(missing.status!==404)throw Error('Missing route does not return 404');
if(environment==='production'){const redirect=await fetch('https://www.proairesis.digital/',{redirect:'manual'});if(![301,308].includes(redirect.status)||redirect.headers.get('location')!==origin+'/')throw Error('www canonical redirect failed');}
const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));const availability=await fetch(`${origin}/api/booking/availability?date=${date}`);const data=await availability.json();if(!availability.ok||!data.connected||!Array.isArray(data.slots))throw Error('Booking availability failed');if(environment==='staging'&&data.testMode!==true)throw Error('Staging is not isolated');if(environment==='production'&&data.testMode)throw Error('Production exposes test mode');
const browser=['--session','roleclue-release-smoke'];
function command(args,input){const r=spawnSync('agent-browser',[...browser,...args],{input,encoding:'utf8'});if(r.status!==0)throw Error(`Browser ${args[0]} failed: ${r.stderr}`);return r.stdout;}
try{
 command(['open',origin+'/book']);command(['wait','--fn',"Boolean(document.querySelector('.booking-days button'))"]);
 const label=new Intl.DateTimeFormat('en-AU',{dateStyle:'full',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
 const present=command(['eval','--stdin'],`Boolean(document.querySelector('button[aria-label="${label}"]'))`);
 if(!present.includes('true'))command(['click','button[aria-label="Next month"]']);
 command(['click',`button[aria-label="${label}"]`]);command(['wait','--fn',"Boolean(document.querySelector('.booking-slot-grid button') || document.querySelector('.booking-status')?.textContent.includes('No times'))"]);
 if(environment==='staging'){
  command(['wait','--fn',"document.querySelector('.booking-times')?.getAttribute('aria-busy')==='false' && Boolean(document.querySelector('.booking-slot-grid button'))"]);command(['click','.booking-slot-grid button:first-child']);command(['wait','--fn',"document.querySelector('.booking-bottom .booking-primary')?.disabled===false"]);command(['click','.booking-bottom .booking-primary']);command(['wait','--fn',"Boolean(document.querySelector('input[name=name]'))"]);
  command(['fill','input[name=name]','Release Test']);command(['fill','input[name=email]','release-test@example.com']);command(['check','input[name=consent]']);command(['click','.booking-form .booking-primary']);command(['wait','--fn',"Boolean(document.querySelector('.booking-success'))"]);
  const status=command(['eval','--stdin'],"document.querySelector('.booking-success').textContent.includes('No invitation')");if(!status.includes('true'))throw Error('Staging did not visibly identify test confirmation');
 }
 command(['open',origin]);for(const [width,height]of [[1440,1000],[390,844]]){command(['set','viewport',String(width),String(height)]);const result=command(['eval','--stdin'],'document.documentElement.scrollWidth <= window.innerWidth');if(!result.includes('true'))throw Error(`Horizontal overflow at ${width}`);}
}finally{command(['close']);}
await mkdir('release/evidence',{recursive:true});await writeFile('release/evidence/smoke.json',JSON.stringify({environment,origin,source:manifest.source,bundleDigest:manifest.bundleDigest,releaseDigest:manifest.digest,passed:true,evidence},null,2));
console.log(`${environment}: live files, routes, metadata, booking and responsive browser checks passed.`);
