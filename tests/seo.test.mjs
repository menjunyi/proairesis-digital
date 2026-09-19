import test from 'node:test';
import assert from 'node:assert/strict';
import {stripApplicationScripts} from '../scripts/release/bundle.mjs';

test('static export retains brand JSON-LD but removes executable and external scripts',()=>{
 const data={'@context':'https://schema.org','@type':'WebSite',name:'RoleClue',url:'https://proairesis.digital/',description:'Check <requirements>'};
 const html='<script src="/runtime.js"></script><script>window.privateState = {};</script>'+
  `<script nonce="discard" type="application/ld+json">${JSON.stringify(data)}</script>`+
  '<script type="application/ld+json" src="https://example.com/data"></script>';
 const result=stripApplicationScripts(html);
 assert.equal((result.match(/<script/g)||[]).length,1);
 assert.doesNotMatch(result,/runtime|privateState|nonce|src=/);
 assert.ok(result.includes('\\u003c'));
 assert.deepEqual(JSON.parse(result.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]),data);
});

test('invalid JSON-LD prevents releasing broken structured data',()=>{
 assert.throws(()=>stripApplicationScripts('<script type="application/ld+json">not JSON</script>'),SyntaxError);
});
