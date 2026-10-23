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

test('Freehire excludes listings whose visible title or location contradicts Australia',async()=>{
  const foreign={...direct,public_slug:'us-only-role',title:'Senior Software Engineer - United States',location:'New York City',work_mode:'remote',countries:['au','us'],url:'https://jobs.ashbyhq.com/acme/us-only'};
  const overseasOffice={...direct,public_slug:'singapore-office-role',title:'Software Engineer',location:'Singapore',work_mode:'hybrid',countries:['au','sg'],url:'https://jobs.ashbyhq.com/acme/singapore'};
  const ambiguousState={...direct,public_slug:'washington-role',title:'Software Engineer',location:'Seattle, WA',work_mode:'remote',countries:['au','us'],url:'https://jobs.ashbyhq.com/acme/washington'};
  const canadianNamesake={...direct,public_slug:'canadian-sydney',location:'Sydney, Nova Scotia',countries:['au'],url:'https://jobs.ashbyhq.com/acme/canadian-sydney'};
  const floridaNamesake={...direct,public_slug:'florida-melbourne',location:'Melbourne, Florida',countries:['au'],url:'https://jobs.ashbyhq.com/acme/florida-melbourne'};
  const germanTitle={...direct,public_slug:'germany-only',title:'Software Engineer - Germany',location:'Remote',countries:['au'],url:'https://jobs.ashbyhq.com/acme/germany-only'};
  const usCodeTitle={...direct,public_slug:'us-code-only',title:'Software Engineer - US',location:'Remote',countries:['au'],url:'https://jobs.ashbyhq.com/acme/us-code-only'};
  const remoteUsLocation={...direct,public_slug:'remote-us-only',title:'Software Engineer',location:'Remote - United States',countries:['au'],url:'https://jobs.ashbyhq.com/acme/remote-us-only'};
  const namesakes=[['ohio-sydney','Sydney, Ohio'],['arkansas-melbourne','Melbourne, Arkansas'],['delaware-newcastle','Newcastle, Delaware']].map(([slug,location])=>({...direct,public_slug:slug,location,countries:['au'],url:`https://jobs.ashbyhq.com/acme/${slug}`}));
  const unicodeForeign=[
    {...direct,public_slug:'aland-title',title:'Software Engineer - Åland Islands',location:'Remote',countries:['au'],url:'https://jobs.ashbyhq.com/acme/aland-title'},
    {...direct,public_slug:'aland-location',location:'Åland Islands',countries:['au'],url:'https://jobs.ashbyhq.com/acme/aland-location'},
    {...direct,public_slug:'myanmar-title',title:'Software Engineer - Myanmar (Burma)',location:'Remote',countries:['au'],url:'https://jobs.ashbyhq.com/acme/myanmar-title'},
    {...direct,public_slug:'myanmar-location',location:'Myanmar (Burma)',countries:['au'],url:'https://jobs.ashbyhq.com/acme/myanmar-location'},
    {...direct,public_slug:'us-punctuation-title',title:'Software Engineer - U.S.',location:'Remote',countries:['au'],url:'https://jobs.ashbyhq.com/acme/us-punctuation-title'},
    {...direct,public_slug:'us-punctuation-location',location:'Remote - U.S.',countries:['au'],url:'https://jobs.ashbyhq.com/acme/us-punctuation-location'},
  ];
  const qualifiedForeign=[
    ['germany-parenthesized','Software Engineer - Germany (Remote)'],['germany-comma-mode','Software Engineer - Germany, Remote'],
    ['germany-prefix','Germany, Software Engineer'],['us-parenthesized','Software Engineer - U.S. (Remote)'],
    ['fr-code','Software Engineer - FR'],['jp-code','Software Engineer - JP'],['cn-code','Software Engineer - CN'],
    ['fr-in','Software Engineer in FR'],['jp-for','Software Engineer for JP'],['germany-demographic','Software Engineer - Germany (m/f/d)'],
    ['germany-prefix-mode','Germany (Remote) - Software Engineer'],['germany-colon','Software Engineer: Germany'],
    ['germany-semicolon','Software Engineer; Germany'],['us-bracket-mode','Software Engineer - United States [Remote]'],
    ['germany-bracket','Software Engineer [Germany]'],['germany-dash-bracket','Software Engineer - [Germany]'],
    ['germany-bullet','Software Engineer • Germany'],['germany-middle-dot','Software Engineer · Germany'],
    ['br-code','Software Engineer - BR'],['nl-code','Software Engineer - NL'],['ch-code','Software Engineer - CH'],
    ['lower-us-code','Software Engineer - us'],
    ['new-york','Software Engineer - New York'],['england','Software Engineer - England'],
  ].map(([slug,title])=>({...direct,public_slug:slug,title,location:'Remote',countries:['au'],url:`https://jobs.ashbyhq.com/acme/${slug}`}));
  const worldwide={...direct,public_slug:'worldwide-role',title:'Remote Software Engineer',location:'Remote, worldwide',work_mode:'remote',countries:['au','us'],url:'https://jobs.ashbyhq.com/acme/worldwide'};
  const joinUs={...direct,public_slug:'join-us-role',title:'Join us as a Software Engineer',location:'Sydney, AU',countries:['au'],url:'https://jobs.ashbyhq.com/acme/join-us'};
  const aiRole={...direct,public_slug:'ai-role',title:'Software Engineer - AI',location:'Sydney, AU',countries:['au'],url:'https://jobs.ashbyhq.com/acme/ai-role'};
  const technicalAcronyms=['ML','IT','BI','CX','ID','EE','ME','IS','SE','SA'].map(code=>({...direct,public_slug:`tech-${code.toLowerCase()}-role`,title:`Software Engineer - ${code}`,location:'Sydney, AU',countries:['au'],url:`https://jobs.ashbyhq.com/acme/tech-${code.toLowerCase()}-role`}));
  const cicd={...direct,public_slug:'cicd-role',title:'DevOps Engineer - CI/CD',location:'Sydney, AU',countries:['au'],url:'https://jobs.ashbyhq.com/acme/cicd-role'};
  const remoteAest={...direct,public_slug:'remote-aest',title:'Software Engineer',location:'Remote AEST',countries:['au'],url:'https://jobs.ashbyhq.com/acme/remote-aest'};
  const productNames=[['jordan-platform','Jordan Platform Engineer'],['peru-integration','Peru Integration Engineer'],['jersey-ui','Jersey UI Engineer'],['monaco-design','Monaco Design System Engineer']].map(([slug,title])=>({...direct,public_slug:slug,title,location:'Sydney, AU',countries:['au'],url:`https://jobs.ashbyhq.com/acme/${slug}`}));
  const transTasman={...direct,public_slug:'au-nz-role',title:'Software Engineer - Australia and New Zealand',location:'APAC Remote',work_mode:'remote',countries:['au','nz'],url:'https://jobs.ashbyhq.com/acme/au-nz'};
  const auUs={...direct,public_slug:'au-us-role',title:'Software Engineer - AU / US',location:'Remote',work_mode:'remote',countries:['au','us'],url:'https://jobs.ashbyhq.com/acme/au-us'};
  const auUsa={...direct,public_slug:'au-usa-role',title:'Software Engineer - AU / USA',location:'Remote',work_mode:'remote',countries:['au','us'],url:'https://jobs.ashbyhq.com/acme/au-usa'};
  const regional=[['victoria-role','Victoria'],['nsw-role','New South Wales'],['geelong-role','Geelong'],['sa-role','SA'],['wa-role','WA']].map(([slug,location])=>({...direct,public_slug:slug,location,countries:['au'],url:`https://jobs.ashbyhq.com/acme/${slug}`}));
  const rows=[foreign,overseasOffice,ambiguousState,canadianNamesake,floridaNamesake,germanTitle,usCodeTitle,remoteUsLocation,...namesakes,...unicodeForeign,...qualifiedForeign,worldwide,joinUs,aiRole,...technicalAcronyms,cicd,remoteAest,...productNames,transTasman,auUs,auUsa,...regional];
  const search=createFreehireSearch(env,{fetchImpl:async()=>response({data:rows,meta:{total:rows.length,limit:100,offset:0}})});
  const result=await search.search(profile);
  assert.deepEqual(result.jobs.map(job=>job.id),['freehire:greenhouse:worldwide-role','freehire:greenhouse:join-us-role','freehire:greenhouse:ai-role',...technicalAcronyms.map(row=>`freehire:greenhouse:${row.public_slug}`),'freehire:greenhouse:cicd-role','freehire:greenhouse:remote-aest',...productNames.map(row=>`freehire:greenhouse:${row.public_slug}`),'freehire:greenhouse:au-nz-role','freehire:greenhouse:au-us-role','freehire:greenhouse:au-usa-role',...regional.map(row=>`freehire:greenhouse:${row.public_slug}`)]);
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
