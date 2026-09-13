import {readFile,mkdir,copyFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {verify,materialize,run} from './bundle.mjs';
const [environment,bundle='release/bundle']=process.argv.slice(2);
if(!['staging','production'].includes(environment))throw Error('Invalid environment');
const awsArgs=process.env.AWS_PROFILE?['--profile',process.env.AWS_PROFILE]:[];
function aws(args){const r=spawnSync('aws',[...awsArgs,...args,'--output','json'],{encoding:'utf8'});if(r.status!==0)throw Error(`AWS ${args[0]} ${args[1]} failed`);return JSON.parse(r.stdout);}
const account='037169690315';if(aws(['sts','get-caller-identity']).Account!==account)throw Error('Wrong AWS account');
const bucket=process.env.SITE_BUCKET,distribution=process.env.CLOUDFRONT_ID,fn=process.env.BOOKING_FUNCTION;
if(!bucket?.startsWith(`proairesis-digital-${environment}-site-`)||fn!==`roleclue-${environment}-booking`||!distribution)throw Error('Missing or mismatched deployment targets');
const origin=environment==='staging'?'https://staging.proairesis.digital':'https://proairesis.digital';
const config=aws(['cloudfront','get-distribution-config','--id',distribution]).DistributionConfig;
if(!config.Aliases.Items.includes(new URL(origin).hostname)||!config.Origins.Items.some(o=>o.DomainName===`${bucket}.s3.ap-southeast-2.amazonaws.com`))throw Error('CloudFront origin/alias mismatch');
const manifest=await verify(bundle);
if(environment==='staging'&&process.env.GITHUB_SHA&&manifest.source!==process.env.GITHUB_SHA)throw Error('Staging source mismatch');
if(environment==='production'){const receipt=JSON.parse(await readFile('release/staging-evidence/smoke.json'));if(receipt.passed!==true||receipt.environment!=='staging'||receipt.source!==manifest.source||receipt.bundleDigest!==manifest.digest)throw Error('Missing matching successful staging evidence');}
const output=`release/${environment}`;await materialize(bundle,output,environment,manifest.digest);await verify(output);
await mkdir('release/lambda',{recursive:true});await copyFile(`${bundle}/server/booking-handler.mjs`,'release/lambda/booking-handler.mjs');
run('zip',['-j','-q','release/booking.zip','release/lambda/booking-handler.mjs']);
aws(['lambda','update-function-code','--function-name',fn,'--zip-file','fileb://release/booking.zip']);
run('aws',[...awsArgs,'lambda','wait','function-updated-v2','--function-name',fn]);
// Delete stale files only after all local and identity checks have passed.
run('aws',[...awsArgs,'s3','sync',output,`s3://${bucket}/`,'--delete','--exclude','server/*','--exclude','manifest.json','--cache-control','public,max-age=300,must-revalidate','--only-show-errors']);
run('aws',[...awsArgs,'s3','cp',`${output}/manifest.json`,`s3://${bucket}/manifest.json`,'--cache-control','no-store','--only-show-errors']);
const invalidation=aws(['cloudfront','create-invalidation','--distribution-id',distribution,'--paths','/*']);
run('aws',[...awsArgs,'cloudfront','wait','invalidation-completed','--distribution-id',distribution,'--id',invalidation.Invalidation.Id]);
run('node',['scripts/release/smoke.mjs',environment,output]);
