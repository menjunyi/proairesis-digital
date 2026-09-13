import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, readdir, rm, cp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const routes=['/','/book','/terms','/membership-agreement','/privacy','/refunds','/cookies','/disclaimer'];
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const digest=files=>sha(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([n,h])=>`${h}  ${n}\n`).join(''));
export const draft=text=>/\[(?:INSERT|COMPLETE|CONFIRM|CHOOSE)[^\]]*\]|Before publication|Working draft/i.test(text);
export function safePath(name){if(!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(p=>p==='..'||p==='.'||!p))throw Error('Unsafe artifact path');return name;}
export async function inventory(root){const files={};async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('Symlinks are forbidden in releases');if(e.isDirectory())await walk(p);else if(path.relative(root,p)!=='manifest.json')files[safePath(path.relative(root,p))]=sha(await readFile(p));}}await walk(root);return files;}
export async function verify(root){const m=JSON.parse(await readFile(path.join(root,'manifest.json')));if(m.schema!==1||!Array.isArray(m.routes)||JSON.stringify(m.routes)!==JSON.stringify(routes))throw Error('Invalid release manifest');for(const name of Object.keys(m.files))safePath(name);const files=await inventory(root);if(digest(files)!==m.digest||JSON.stringify(Object.keys(files).sort())!==JSON.stringify(Object.keys(m.files).sort())||digest(m.files)!==m.digest)throw Error('Artifact integrity failed');return m;}
export async function writeManifest(root,metadata){const files=await inventory(root);const m={schema:1,...metadata,files,digest:digest(files)};await writeFile(path.join(root,'manifest.json'),JSON.stringify(m,null,2));return m;}
export function run(cmd,args,options={}){const r=spawnSync(cmd,args,{stdio:'inherit',...options});if(r.status!==0)throw Error(`${cmd} failed`);}
const marker='https://release-origin.invalid';
export async function build(){
 run('npm',['run','build'],{env:{...process.env,SITE_URL:marker}});
 run('npx',['vite','build','--config','scripts/release/booking.vite.ts']);
 process.env.SITE_URL=marker;
 const root=path.resolve('release/bundle');await rm(root,{recursive:true,force:true});await mkdir(root,{recursive:true});
 const worker=(await import(pathToFileURL(path.resolve('dist/server/index.js')).href)).default;
 const needed=new Set(['/booking-client.js']);
 for(const route of routes){
  const response=await worker.fetch(new Request(marker+route),{}, {waitUntil(){}});
  if(!response.ok)throw Error(`Render failed: ${route}`);
  let html=(await response.text()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b(?=[^>]*\brel=["'](?:modulepreload|preload)["'])(?=[^>]*(?:\bas=["']script["']|\brel=["']modulepreload["']))[^>]*>/gi,'').replace(/<meta\b(?=[^>]*name="robots")[^>]*>/gi,'').replace(/<link\b(?=[^>]*rel="canonical")[^>]*>/gi,'').replaceAll(marker,'__SITE_ORIGIN__');
  if(/href=["']\/(?:admin|billing|api)(?:[/"'#?])/.test(html))throw Error(`${route} exposes an excluded feature`);
  if(draft(html))throw Error(`${route} contains unpublished policy content`);
  html=html.replace('</head>',`<link rel="canonical" href="__SITE_ORIGIN__${route==='/'?'/':route}"/><meta name="robots" content="__ROBOTS__"/><meta name="release-environment" content="__ENVIRONMENT__"/></head>`);
  if(route==='/book')html=html.replace('</body>','<script src="/booking-client.js" defer></script></body>');
  const file=route==='/'?'index.html':route.slice(1)+'/index.html';await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),html);
  for(const [,ref]of html.matchAll(/(?:href|src)=["']([^"']+)["']/g)){if(ref.startsWith('/')&&!ref.startsWith('//')){const pathname=ref.split(/[?#]/)[0];if(pathname&&!routes.includes(pathname))needed.add(pathname);}}
 }
 // Copy only assets reachable from public pages and their stylesheets.
 for(const ref of needed){const rel=safePath(decodeURIComponent(ref.slice(1)));const src=rel==='booking-client.js'?'release/client/booking-client.js':path.join('dist/client',rel);const data=await readFile(src);await mkdir(path.dirname(path.join(root,rel)),{recursive:true});await cp(src,path.join(root,rel));if(rel.endsWith('.css'))for(const [,url]of data.toString().matchAll(/url\(["']?([^)'"\s]+)["']?\)/g)){if(url.startsWith('/'))needed.add(url.split(/[?#]/)[0]);}}
 await mkdir(path.join(root,'server'),{recursive:true});await cp('scripts/release/booking-handler.mjs',path.join(root,'server/booking-handler.mjs'));
 await writeFile(path.join(root,'404.html'),'<!DOCTYPE html><html lang="en"><head><title>Page not found — RoleClue</title><meta name="robots" content="noindex"/></head><body><h1>Page not found</h1><a href="/">Return to RoleClue</a></body></html>');
 const source=process.env.GITHUB_SHA||spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
 const m=await writeManifest(root,{kind:'bundle',source,routes});console.log(JSON.stringify({bundleDigest:m.digest,source}));
}
export async function materialize(bundle,output,environment,expected){
 if(!['staging','production'].includes(environment))throw Error('Invalid environment');
 const m=await verify(bundle);if(m.kind!=='bundle'||(expected&&m.digest!==expected))throw Error('Bundle does not match staging');
 const origin=environment==='staging'?'https://staging.proairesis.digital':'https://proairesis.digital';
 await rm(output,{recursive:true,force:true});await cp(bundle,output,{recursive:true});await rm(path.join(output,'manifest.json'));
 for(const route of routes){const name=route==='/'?'index.html':route.slice(1)+'/index.html';let html=await readFile(path.join(output,name),'utf8');if(draft(html))throw Error('Unpublished legal content');html=html.replaceAll('__SITE_ORIGIN__',origin).replaceAll('__ENVIRONMENT__',environment).replaceAll('__ROBOTS__',environment==='staging'?'noindex, nofollow':route==='/book'?'noindex, follow':'index, follow');await writeFile(path.join(output,name),html);}
 await writeFile(path.join(output,'robots.txt'),environment==='staging'?'User-agent: *\nDisallow: /\n':`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /billing\nSitemap: ${origin}/sitemap.xml\n`);
 await writeFile(path.join(output,'sitemap.xml'),'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+(environment==='production'?routes.filter(r=>r!=='/book').map(r=>`<url><loc>${origin}${r}</loc></url>`).join(''):'')+'</urlset>');
 return writeManifest(output,{kind:'release',source:m.source,bundleDigest:m.digest,environment,origin,routes});
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const [command,...args]=process.argv.slice(2);if(command==='build')await build();else if(command==='materialize')console.log(await materialize(...args));else if(command==='verify')console.log(await verify(args[0]));else throw Error('Unknown release command');}
