import test from 'node:test';
import assert from 'node:assert/strict';
import {createFreehireSearch} from '../server/freehire.mjs';

const profile={roleFamilies:['software'],resumeText:'PRIVATE RESUME MARKER TypeScript React AWS SQL',skills:['TypeScript','React','AWS','SQL']};
const direct={public_slug:'software-engineer-acme-123',source:'greenhouse',manually_added:false,url:'https://boards.greenhouse.io/acme/jobs/123',title:'Software Engineer',company:'Acme',location:'Sydney, Australia',description:'Build technology services using TypeScript and React. Deploy reliable AWS applications, maintain SQL databases and use Git with the Australian engineering team. Applicants should describe relevant project experience.',countries:['AU'],work_mode:'hybrid',skills:['TypeScript','React','AWS','SQL'],posted_at:'2026-10-09T00:00:00Z',created_at:'2026-10-09T03:00:00Z',updated_at:'2026-10-11T04:30:00Z',closed_at:null,enrichment:{category:'software_engineering',employment_type:'full_time',seniority:'middle'}};
const env={FREEHIRE_ENABLED:'true',FREEHIRE_LICENSE_APPROVED:'true',FREEHIRE_LICENSE_REFERENCE:'freehire-mit-and-hosted-approval-2026-10-12',FREEHIRE_BASE_URL:'https://freehire.me/api/v1/'};
const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});

test('Freehire is fail-closed until both feature and licence approval are recorded',async()=>{
  let called=false;const search=createFreehireSearch({...env,FREEHIRE_LICENSE_APPROVED:'false'},{fetchImpl:async()=>{called=true;}});
  assert.equal(await search.available(),false);
  await assert.rejects(()=>search.search(profile),error=>error.code==='JOB_SEARCH_NOT_CONFIGURED');assert.equal(called,false);
});

test('Freehire requests only AU technology facets and keeps only direct ATS records',async()=>{
  let requested;
  const search=createFreehireSearch(env,{fetchImpl:async url=>{requested=String(url);return response({data:[direct,{...direct,public_slug:'aggregated-1',source:'adzuna',url:'https://www.adzuna.com.au/jobs/1'},{...direct,public_slug:'linkedin-1',url:'https://www.linkedin.com/jobs/view/1/'}],meta:{total:3,limit:100,offset:0}});}});
  const result=await search.search(profile,{remote:false});
  assert.equal(result.jobs.length,1);const job=result.jobs[0];
  assert.equal(job.source,'freehire:greenhouse');assert.equal(job.sourceDisplay,'Freehire / greenhouse');
  assert.equal(job.url,direct.url);assert.equal(job.licenseReference,env.FREEHIRE_LICENSE_REFERENCE);assert.equal(job.australia,true);assert.equal(job.roleFamily,'software');
  assert.equal(job.publishedAt,'2026-10-09T00:00:00.000Z');assert.equal(job.sourceFirstSeenAt,'2026-10-09T03:00:00.000Z');assert.equal(job.sourceUpdatedAt,'2026-10-11T04:30:00.000Z');
  assert.equal(job.lastSeenAt,result.source.fetchedAt);assert.equal('closingAt' in job,false);
  const url=new URL(requested);assert.equal(url.searchParams.get('countries'),'AU');assert.match(url.searchParams.get('category'),/software_engineering/);
  assert.match(url.searchParams.get('source'),/(?:^|,)greenhouse(?:,|$)/);assert.doesNotMatch(url.searchParams.get('source'),/adzuna|linkedin|seek/);
  assert.equal(requested.includes('PRIVATE'),false);assert.equal(requested.includes('TypeScript'),false);assert.equal(requested.includes('resume'),false);
});

test('Freehire omits invalid or unavailable source dates instead of inventing them',async()=>{
  const row={...direct,posted_at:'unknown',created_at:null,updated_at:'not-a-date'};
  const search=createFreehireSearch(env,{fetchImpl:async()=>response({data:[row],meta:{total:1,limit:100,offset:0}})});
  const job=(await search.search(profile)).jobs[0];
  assert.equal('publishedAt' in job,false);assert.equal('sourceFirstSeenAt' in job,false);assert.equal('sourceUpdatedAt' in job,false);assert.equal('closingAt' in job,false);
});

test('Freehire accepts its documented boundary of one hundred direct ATS jobs',async()=>{
  const rows=Array.from({length:100},(_,index)=>({...direct,public_slug:`software-engineer-${index}`,url:`https://boards.greenhouse.io/acme/jobs/${1000+index}`}));
  const search=createFreehireSearch(env,{fetchImpl:async()=>response({data:rows,meta:{total:100,limit:100,offset:0}})});
  const result=await search.search(profile);
  assert.equal(result.jobs.length,100);assert.equal(result.source.returned,100);assert.equal(result.source.accepted,100);
});

test('Freehire retries one transport failure without weakening response validation',async()=>{
  let attempts=0;
  const search=createFreehireSearch(env,{fetchImpl:async()=>{
    attempts++;
    if(attempts===1)throw Object.assign(new Error('synthetic timeout'),{name:'AbortError'});
    return response({data:[direct],meta:{total:1,limit:100,offset:0}});
  }});
  assert.equal((await search.search(profile)).jobs.length,1);
  assert.equal(attempts,2);

  attempts=0;
  const interrupted=createFreehireSearch(env,{fetchImpl:async()=>{
    attempts++;
    if(attempts===1)return {
      ok:true,redirected:false,headers:{get:name=>name==='content-type'?'application/json':null},
      body:{async *[Symbol.asyncIterator](){yield Buffer.from('{"data":');throw new TypeError('synthetic body reset');}},
    };
    return response({data:[direct],meta:{total:1,limit:100,offset:0}});
  }});
  assert.equal((await interrupted.search(profile)).jobs.length,1);
  assert.equal(attempts,2);

  attempts=0;
  const unavailable=createFreehireSearch(env,{fetchImpl:async()=>{attempts++;throw new TypeError('synthetic network failure');}});
  await assert.rejects(()=>unavailable.search(profile),error=>error.code==='JOB_SEARCH_UNAVAILABLE');
  assert.equal(attempts,2);

  attempts=0;
  const invalid=createFreehireSearch(env,{fetchImpl:async()=>{attempts++;return new Response('not json',{status:502,headers:{'content-type':'text/plain'}});}});
  await assert.rejects(()=>invalid.search(profile),error=>error.code==='JOB_SEARCH_UNAVAILABLE');
  assert.equal(attempts,1);
});

test('Freehire refuses ignored safety filters and oversized result sets with honest errors',async()=>{
  const ignored=createFreehireSearch(env,{fetchImpl:async()=>response({data:[direct],meta:{total:1,limit:100,offset:0,ignored_params:['countries']}})});
  await assert.rejects(()=>ignored.search(profile),error=>error.code==='JOB_SEARCH_UNAVAILABLE'&&/filters/.test(error.message));
  const ignoredSource=createFreehireSearch(env,{fetchImpl:async()=>response({data:[direct],meta:{total:1,limit:100,offset:0,ignored_params:['source']}})});
  await assert.rejects(()=>ignoredSource.search(profile),error=>error.code==='JOB_SEARCH_UNAVAILABLE'&&/filters/.test(error.message));
  const tooMany=createFreehireSearch(env,{fetchImpl:async()=>response({data:Array.from({length:101},(_,index)=>({...direct,public_slug:`job-${index}`})),meta:{total:101,limit:101,offset:0}})});
  await assert.rejects(()=>tooMany.search(profile),error=>error.code==='JOB_SEARCH_UNAVAILABLE');
  const missingLimit=createFreehireSearch(env,{fetchImpl:async()=>response({data:[direct],meta:{total:1,offset:0}})});
  await assert.rejects(()=>missingLimit.search(profile),error=>error.code==='JOB_SEARCH_UNAVAILABLE');
});
