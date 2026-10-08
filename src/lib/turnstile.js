import 'server-only';
import { serverEnv } from './config.js';

export function turnstileSiteKey() {
  const env = serverEnv();
  return env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null;
}

/** True when Turnstile is not configured, or when Cloudflare accepts the token. */
export async function verifyTurnstile(token, ip) {
  const secret = serverEnv().TURNSTILE_SECRET_KEY;
  if (!secret || !serverEnv().TURNSTILE_SITE_KEY) return true;
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== 'unknown' && !ip.includes('/')) body.set('remoteip', ip);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    return result.success === true;
  } catch {
    return false;
  }
}
