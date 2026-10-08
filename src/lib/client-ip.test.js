import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp } from './client-ip.js';

const h = (values) => new Headers(values);

test('takes the right-most public hop, ignoring what the client prepended', () => {
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9, 172.18.0.1' })), '203.0.113.9');
});

test('prefers the Cloudflare header when present', () => {
  assert.equal(clientIp(h({ 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '1.1.1.1' })), '198.51.100.7');
});

test('buckets IPv6 to its /64', () => {
  assert.equal(clientIp(h({ 'x-forwarded-for': '2001:db8:1:2:3:4:5:6' })), '2001:db8:1:2::/64');
});

test('falls back to unknown without headers', () => {
  assert.equal(clientIp(h({})), 'unknown');
});
