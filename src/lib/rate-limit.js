import { prepared, transaction } from './db.js';

/**
 * Fixed-window counter in SQLite, so limits survive restarts. One process owns the database,
 * which makes the read-modify-write inside a transaction safe.
 *
 * Returns { ok, retryAfter } where retryAfter is in seconds.
 */
export function hit(key, { limit, windowSeconds }) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  return transaction(() => {
    const row = prepared('SELECT window_start, count FROM rate_limits WHERE key = ?').get(key);
    if (!row || now - row.window_start >= windowMs) {
      prepared(
        'INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1',
      ).run(key, now);
      return { ok: true, retryAfter: 0 };
    }
    if (row.count >= limit) {
      return { ok: false, retryAfter: Math.ceil((row.window_start + windowMs - now) / 1000) };
    }
    prepared('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
    return { ok: true, retryAfter: 0 };
  });
}

/** Checks every rule and only counts against them when all pass. */
export function hitAll(rules) {
  for (const [key, options] of rules) {
    const row = prepared('SELECT window_start, count FROM rate_limits WHERE key = ?').get(key);
    if (row && Date.now() - row.window_start < options.windowSeconds * 1000 && row.count >= options.limit) {
      return { ok: false, retryAfter: Math.ceil((row.window_start + options.windowSeconds * 1000 - Date.now()) / 1000) };
    }
  }
  for (const [key, options] of rules) hit(key, options);
  return { ok: true, retryAfter: 0 };
}

/** Drops windows that ended more than a day ago. */
export function sweepRateLimits() {
  prepared('DELETE FROM rate_limits WHERE window_start < ?').run(Date.now() - 24 * 60 * 60 * 1000);
}
