import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {buildSync} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {pendingGenerationForRestore} from '../src/ui-state.js';

const appModule={exports:{}};
const compiled=buildSync({
  entryPoints:[fileURLToPath(new URL('../src/App.jsx',import.meta.url))],
  bundle:true,
  platform:'node',
  format:'cjs',
  packages:'external',
  write:false,
}).outputFiles[0].text;
runInNewContext(compiled,{require:createRequire(import.meta.url),module:appModule,exports:appModule.exports});
const {ApplicationWorkspace}=appModule.exports;

test('server pending state takes precedence over a stale completed tab ID',()=>{
  const server={id:'b'.repeat(64),appId:'job-one',status:'pending',createdAt:'2026-10-19T00:00:00.000Z'};
  assert.equal(pendingGenerationForRestore(server,'a'.repeat(64)),server);
  assert.deepEqual(pendingGenerationForRestore(undefined,'a'.repeat(64)),{id:'a'.repeat(64),status:'pending'});
  assert.equal(pendingGenerationForRestore(undefined,undefined),null);
});

test('a server-reported pending generation restores the busy state without tab storage',()=>{
  const generationId='a'.repeat(64);
  const html=renderToStaticMarkup(React.createElement(ApplicationWorkspace,{
    application:{
      id:'job-one',status:'interested',notes:'',letters:[],
      pendingGeneration:{id:generationId,appId:'job-one',status:'pending',createdAt:'2026-10-19T00:00:00.000Z'},
      job:{id:'job-one',company:'Synthetic Employer',title:'Software Engineer',location:'Sydney, Australia',workplaceType:'hybrid',availability:'available',description:'Build services.'},
    },
    api:async()=>{throw new Error('Rendering must not call the API.');},
    billing:{plan:'starter',remaining:1,limit:2,canGenerate:true},
    onBilling(){},onUpgrade(){},onNotice(){},onUpdate(){},
    capabilities:{coverLetters:true,billing:true},
  }));
  assert.match(html,/Your draft is being prepared\. You can leave this page and return\./);
  assert.match(html,/Preparing your draft/);
  assert.doesNotMatch(html,/Confirm AI processing/);
});
