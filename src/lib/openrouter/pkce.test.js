import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFlow, startFlow } from './pkce.js';

test('a flow cookie only works for the user who started it, untampered', () => {
  const { cookie, state } = startFlow('alice');
  assert.equal(readFlow(cookie, 'alice').state, state);
  assert.equal(readFlow(cookie, 'mallory'), null);
  const [payload, signature] = cookie.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), u: 'mallory' })).toString('base64url');
  assert.equal(readFlow(`${forged}.${signature}`, 'mallory'), null);
});
