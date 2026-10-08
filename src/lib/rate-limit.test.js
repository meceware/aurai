import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'aurai-test-'));
// Each run's database and files go when it ends.
after(() => rmSync(process.env.DATA_DIR, { recursive: true, force: true }));
const { getDb } = await import('./db.js');
const { migrate } = await import('./migrate.js');
const { hit, hitAll } = await import('./rate-limit.js');
migrate(getDb(), join(import.meta.dirname, '..', '..', 'migrations'));

test('allows up to the limit, then reports when to retry', () => {
  for (let i = 0; i < 3; i += 1) assert.equal(hit('t:a', { limit: 3, windowSeconds: 60 }).ok, true);
  const blocked = hit('t:a', { limit: 3, windowSeconds: 60 });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0 && blocked.retryAfter <= 60);
});

test('hitAll counts nothing when any rule is exhausted', () => {
  hit('t:full', { limit: 1, windowSeconds: 60 });
  const result = hitAll([
    ['t:fresh', { limit: 5, windowSeconds: 60 }],
    ['t:full', { limit: 1, windowSeconds: 60 }],
  ]);
  assert.equal(result.ok, false);
  const fresh = getDb().prepare('SELECT count FROM rate_limits WHERE key = ?').get('t:fresh');
  assert.equal(fresh, undefined);
});
