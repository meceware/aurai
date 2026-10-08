import 'server-only';
import { serverEnv } from './config.js';
import { prepared } from './db.js';

/**
 * Whether a new account may be created for this address. Checked before any sign-in email
 * goes out, and again in the user-create hook, so no path around the form can skip it.
 */
export function canCreateAccount(email) {
  const env = serverEnv();
  if (!env.SIGNUP_ENABLED) return false;

  const domain = email.split('@').pop().toLowerCase();
  if (env.ALLOWED_EMAIL_DOMAINS.length && !env.ALLOWED_EMAIL_DOMAINS.includes(domain)) return false;

  if (env.MAX_USERS > 0) {
    const { count } = prepared('SELECT COUNT(*) AS count FROM "user"').get();
    if (count >= env.MAX_USERS) return false;
  }
  return true;
}

export function accountExists(email) {
  return Boolean(prepared('SELECT 1 FROM "user" WHERE email = ?').get(email.toLowerCase()));
}
