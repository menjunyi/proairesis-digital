import http from 'node:http';
import {MemoryStore,change} from './store.mjs';
import {blankEntitlement,createService} from './service.mjs';
import {createHttpHandler} from './handler.mjs';
import {normalizeJob} from './matching.mjs';

if(process.env.ROLECLUE_LOCAL_DEMO!=='1'||process.env.AWS_LAMBDA_FUNCTION_NAME||process.env.AWS_EXECUTION_ENV)throw Error('Local synthetic demo requires ROLECLUE_LOCAL_DEMO=1 outside AWS.');
const store=new MemoryStore();
const fixtures=[['demo-software','Software Engineer','software','TypeScript React AWS SQL'],['demo-cloud','Cloud Engineer','cloud','AWS Terraform Linux Python'],['demo-data','Data Analyst','data','SQL Python Power BI Excel'],['demo-product','Product Designer','design','Figma HTML CSS Agile']].map(([id,title,roleFamily,skills])=>normalizeJob({id,title,roleFamily,company:'Synthetic Demo Company',country:'AU',location:'Sydney, Australia',workplaceType:'hybrid',description:`SYNTHETIC DEMONSTRATION VACANCY — NOT A REAL OPPORTUNITY. Our sample ${title} role uses ${skills}. Work with a collaborative technology team to deliver reliable software and document practical solutions. Applicants should explain their relevant project experience.`,skills:skills.split(/ (?=[A-Z])/),url:`https://example.com/demo/${id}`,requirements:{sponsorship:'unknown',clearance:'unknown'}},'demo'));
const feed={async status(){return {status:'demo',lastUpdatedAt:new Date().toISOString(),message:'Synthetic local demonstration. These are not real vacancies.'};},async jobs(){return fixtures;}};
const guestSearch={available:async()=>true,async search(profile){return {jobs:fixtures.filter(job=>profile.roleFamilies?.includes(job.roleFamily)).map(job=>({...job,sourceDisplay:'Synthetic local demo'})),source:{name:'Synthetic local demo',status:'demo'}};}};
const provider={available:()=>true,async generate(profile,job){return `SYNTHETIC DEMO DRAFT — NO AI PROVIDER CALLED\n\nDear hiring team,\n\nI am interested in the sample ${job.title} role at ${job.company}. My reviewed resume provides the following background:\n\n${profile.resumeText.slice(0,1300)}\n\nI would welcome the opportunity to discuss how my demonstrated experience relates to your team's requirements.\n\nKind regards,\n${profile.name||'Demo candidate'}`;}};
const service=createService({store,feed,provider,guestSearch,guestRateSecret:'roleclue-local-demo-guest-rate-secret-v1',mode:'demo'});
const port=Number(process.env.PORT)||3003;
const api=createHttpHandler(service,{mode:'demo',origins:['http://127.0.0.1:3002','http://localhost:3002','http://127.0.0.1:3003','http://localhost:3003']});
const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/config.json'){
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({apiBaseUrl:'',mode:'demo',marketingUrl:'https://proairesis.digital',cognitoRegion:'',cognitoClientId:'',cognitoDomain:'',oauthRedirectUri:'',googleSignInEnabled:false}));return;
  }
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>7*1024*1024){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
  if(path==='/api/__demo__/activate-starter'&&req.method==='POST'){
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    if(req.headers.authorization!=='Bearer demo'){res.writeHead(401);res.end(JSON.stringify({error:{code:'SIGN_IN_REQUIRED',message:'Use the synthetic local demo account.'}}));return;}
    const pk='USER#demo-user',row=await store.get(pk,'ENTITLEMENT'),entitlement={...blankEntitlement(),starter:{key:'demo-starter',purchaseId:'demo-paid',status:'active',everPaid:true,used:0,reserved:0},customerId:'demo-customer'};
    await store.transact([change(pk,'ENTITLEMENT',row,entitlement)]);
    res.end(JSON.stringify({activated:true,synthetic:true}));return;
  }
  const response=await api({rawPath:path,headers:req.headers,body:Buffer.concat(chunks).toString(),requestContext:{http:{method:req.method,sourceIp:req.socket.remoteAddress??'127.0.0.1'}}});
  res.writeHead(response.statusCode,response.headers);res.end(response.body);
});
server.listen(port,'127.0.0.1',()=>console.log(`RoleClue SYNTHETIC LOCAL DEMO API: http://127.0.0.1:${port}`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>process.exit(0)));
