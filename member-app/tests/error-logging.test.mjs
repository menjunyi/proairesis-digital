import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpHandler } from '../server/handler.mjs';

test('unexpected failures expose only a correlation ID and log no user content', async () => {
  const entries = [], prior = console.error;
  const service = {
    async assertActive() {},
    async account() { const error = new Error('PRIVATE_RESUME_TEXT'); error.code = 'PRIVATE_PROVIDER_TOKEN'; error.status = 403; throw error; },
  };
  console.error = message => entries.push(message);
  try {
    const result = await createHttpHandler(service, { mode: 'demo' })({ rawPath: '/api/me', headers: { authorization: 'Bearer demo' }, requestContext: { http: { method: 'GET' } } });
    assert.equal(result.statusCode, 500);
    const body = JSON.parse(result.body);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.equal(JSON.parse(entries[0]).requestId, body.error.requestId);
    assert.equal(JSON.parse(entries[0]).event, 'request_failed');
    assert.ok(!JSON.stringify([entries, body]).includes('PRIVATE_'));
  } finally { console.error = prior; }
});
