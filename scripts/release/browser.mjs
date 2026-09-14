import {spawnSync} from 'node:child_process';
export function browserSmoke(environment){
 if(!['staging','production'].includes(environment))throw Error('Invalid environment');
 const origin=environment==='staging'?'https://staging.proairesis.digital':'https://proairesis.digital';
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);const date=tomorrow.toISOString().slice(0,10);
const browser=['--session','roleclue-release-smoke'];
function command(args,input){const r=spawnSync('agent-browser',[...browser,...args],{input,encoding:'utf8',timeout:45000});if(r.status!==0)throw Error(`Browser ${args[0]} failed: ${r.stderr}`);return r.stdout;}
try{
 command(['open',origin+'/book']);command(['wait','--fn',"Boolean(document.querySelector('.booking-days button'))"]);
 const label=new Intl.DateTimeFormat('en-AU',{dateStyle:'full',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
 const selected=command(['eval','--stdin'],`document.querySelector('.booking-days button[aria-pressed=true]')?.getAttribute('aria-label') === ${JSON.stringify(label)}`);
 if(!selected.includes('true'))throw Error(`Booking must default to tomorrow in Sydney: ${date}`);
 console.log(`Default booking date verified: ${date} (${label})`);console.log(command(['eval','--stdin'],"JSON.stringify({selected:document.querySelector('.booking-days button[aria-pressed=true]')?.getAttribute('aria-label'),busy:document.querySelector('.booking-times')?.getAttribute('aria-busy'),status:document.querySelector('.booking-status')?.textContent,slots:document.querySelectorAll('.booking-slot-grid button').length})"));command(['wait','--fn',"Boolean(document.querySelector('.booking-slot-grid button') || document.querySelector('.booking-status')?.textContent.includes('No times'))"]);
 if(environment==='staging'){
  command(['wait','--fn',"document.querySelector('.booking-times')?.getAttribute('aria-busy')==='false' && Boolean(document.querySelector('.booking-slot-grid button'))"]);command(['click','.booking-slot-grid button:first-child']);command(['wait','--fn',"document.querySelector('.booking-bottom .booking-primary')?.disabled===false"]);command(['scrollintoview','.booking-bottom .booking-primary']);command(['click','.booking-bottom .booking-primary']);command(['wait','--fn',"Boolean(document.querySelector('input[name=name]'))"]);
  command(['fill','input[name=name]','Release Test']);command(['fill','input[name=email]','release-test@example.com']);command(['check','input[name=consent]']);command(['scrollintoview','.booking-form .booking-primary']);command(['click','.booking-form .booking-primary']);command(['wait','--fn',"Boolean(document.querySelector('.booking-success'))"]);
  const status=command(['eval','--stdin'],"document.querySelector('.booking-success').textContent.includes('No invitation')");if(!status.includes('true'))throw Error('Staging did not visibly identify test confirmation');
 }
 command(['open',origin+'/?rc_campaign=release-smoke&rc_test=1']);
 command(['wait','--text','Help us understand interest in RoleClue?']);
 const before=command(['eval','--stdin'],"localStorage.getItem('roleclue-campaign-browser') === null");if(!before.includes('true'))throw Error('Analytics identifier exists before consent');
 command(['find','role','button','click','--name','No thanks']);
 command(['wait','--text','Analytics choices']);
 command(['find','role','button','click','--name','Analytics choices']);
 command(['wait','--text','Help us understand interest in RoleClue?']);
 command(['find','role','button','click','--name','Allow analytics']);
 command(['wait','--text','Analytics choices']);
 const consent=command(['eval','--stdin'],"localStorage.getItem('roleclue-campaign-consent') === 'accepted'");if(!consent.includes('true'))throw Error('Analytics choice was not saved');
 command(['find','role','button','click','--name','Analytics choices']);
 command(['wait','--text','Help us understand interest in RoleClue?']);
 command(['find','role','button','click','--name','No thanks']);
 command(['open',origin]);for(const [width,height]of [[1440,1000],[390,844]]){command(['set','viewport',String(width),String(height)]);const result=command(['eval','--stdin'],'document.documentElement.scrollWidth <= window.innerWidth');if(!result.includes('true'))throw Error(`Horizontal overflow at ${width}`);}
}finally{command(['close']);}
}
