import { open, seal } from './crypto.js';
import { prepared } from './db.js';

const aad = (userId) => `${userId}|openrouter`;

function row(userId) {
  return prepared('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
}

function ensure(userId) {
  prepared('INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING').run(userId, Date.now());
}

/** What the UI may see: never the key itself, only whether there is one and its last four characters. */
export function getUserSettings(userId) {
  const settings = row(userId);
  return {
    hasKey: Boolean(settings?.openrouter_key_enc),
    keyLast4: settings?.key_last4 ?? null,
    prefs: JSON.parse(settings?.prefs_json ?? '{}'),
    prompts: JSON.parse(settings?.prompts_json ?? '{}'),
  };
}

export function saveOpenRouterKey(userId, apiKey) {
  ensure(userId);
  prepared('UPDATE user_settings SET openrouter_key_enc = ?, key_last4 = ?, updated_at = ? WHERE user_id = ?').run(
    seal(apiKey, aad(userId)),
    apiKey.slice(-4),
    Date.now(),
    userId,
  );
}

export function clearOpenRouterKey(userId) {
  prepared('UPDATE user_settings SET openrouter_key_enc = NULL, key_last4 = NULL, updated_at = ? WHERE user_id = ?').run(Date.now(), userId);
}

/** Server-side only. Returns null when the user has not set a key (or it can no longer be opened). */
export function openRouterKeyFor(userId) {
  const sealed = row(userId)?.openrouter_key_enc;
  if (!sealed) return null;
  try {
    return open(sealed, aad(userId));
  } catch {
    return null;
  }
}

export function updatePrefs(userId, patch) {
  ensure(userId);
  const next = { ...getUserSettings(userId).prefs, ...patch };
  prepared('UPDATE user_settings SET prefs_json = ?, updated_at = ? WHERE user_id = ?').run(JSON.stringify(next), Date.now(), userId);
  return next;
}
