import 'server-only';
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from '../config.js';

// "Connect with OpenRouter" (OAuth PKCE). The verifier and state travel in a signed, httpOnly
// cookie bound to the signed-in user, so a callback can only complete the flow that this user
// started in this browser — nobody can get their own key planted into someone else's account.

export const COOKIE = 'aurai_openrouter_pkce';
export const MAX_AGE = 10 * 60; // OpenRouter's codes expire after 10 minutes.

const key = () =>
  Buffer.from(hkdfSync('sha256', serverEnv().AUTH_SECRET || 'dev-only-secret-change-me-dev-only-secret', 'aurai', 'aurai:pkce:v1', 32));

const sign = (payload) => createHmac('sha256', key()).update(payload).digest('base64url');

export function startFlow(userId) {
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const payload = Buffer.from(JSON.stringify({ v: verifier, s: state, u: userId, t: Date.now() })).toString('base64url');
  return { cookie: `${payload}.${sign(payload)}`, challenge, state };
}

/** The flow this cookie started, or null if it was tampered with, expired, or is someone else's. */
export function readFlow(cookie, userId) {
  const [payload, signature] = String(cookie ?? '').split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (flow.u !== userId || Date.now() - flow.t > MAX_AGE * 1000) return null;
    return { verifier: flow.v, state: flow.s };
  } catch {
    return null;
  }
}

export async function exchangeCode(code, verifier) {
  const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`);
  const { key: apiKey } = await response.json();
  if (typeof apiKey !== 'string' || !apiKey.startsWith('sk-or-')) throw new Error('OpenRouter returned no key');
  return apiKey;
}
