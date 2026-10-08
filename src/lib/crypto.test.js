import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, seal } from './crypto.js';

process.env.ENCRYPTION_KEY = 'test-key-for-unit-tests-only-0123456789';

test('round-trips and never repeats a ciphertext', () => {
  const a = seal('sk-or-v1-secret', 'user-1|openrouter');
  const b = seal('sk-or-v1-secret', 'user-1|openrouter');
  assert.notEqual(a, b);
  assert.equal(open(a, 'user-1|openrouter'), 'sk-or-v1-secret');
});

test('refuses a ciphertext moved to another user', () => {
  const sealed = seal('sk-or-v1-secret', 'user-1|openrouter');
  assert.throws(() => open(sealed, 'user-2|openrouter'));
});

test('refuses a tampered ciphertext', () => {
  const [v, iv, tag, ct] = seal('sk-or-v1-secret', 'aad').split(':');
  const flipped = Buffer.from(ct, 'base64url');
  flipped[0] ^= 1;
  assert.throws(() => open([v, iv, tag, flipped.toString('base64url')].join(':'), 'aad'));
});
