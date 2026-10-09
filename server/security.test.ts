import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, validateMessage, windowLimit } from './security.ts';

test('browser origin must match service or allowlist', () => {
  assert.equal(allowedOrigin('https://example.com', 'example.com'), true);
  assert.equal(allowedOrigin('https://evil.com', 'example.com'), false);
  assert.equal(allowedOrigin(undefined, 'example.com'), false);
  assert.equal(allowedOrigin('https://foo.test', 'example.com', 'https://foo.test'), true);
});
test('strict message validation', () => {
  assert.equal(validateMessage({type:'text',text:' '}), null);
  assert.equal(validateMessage({type:'text',text:'a'.repeat(2001)}), null);
  assert.deepEqual(validateMessage({type:'text',text:' Salut '}), {type:'text',text:'Salut'});
  assert.equal(validateMessage({type:'audio',audio:'not valid'}), null);
  assert.deepEqual(validateMessage({type:'audio',audio:'AAE='}), {type:'audio',audio:'AAE='});
});
test('rate limit expires', () => {
  let time = 0; const hit = windowLimit(2, 1000, () => time);
  assert.equal(hit('client'), true); assert.equal(hit('client'), true);
  assert.equal(hit('client'), false); time = 1001;
  assert.equal(hit('client'), true);
});
