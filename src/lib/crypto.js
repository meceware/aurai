import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverEnv } from './config.js';

// Secrets at rest (users' OpenRouter keys) are AES-256-GCM sealed under a key derived from
// ENCRYPTION_KEY — deliberately separate from AUTH_SECRET, so leaking one does not open the
// other. The additional data binds each ciphertext to its owner and purpose: a row copied to
// another user, or into another column, fails to decrypt instead of quietly working.

const VERSION = 'v1';
const DEV_KEY = 'aurai-development-only-encryption-key';
let warned = false;

function secret() {
  let value = serverEnv().ENCRYPTION_KEY;
  if (!value) {
    if (!warned) console.warn('ENCRYPTION_KEY is not set; using a development-only key.');
    warned = true;
    value = DEV_KEY;
  }
  return value;
}

function key() {
  let secret = serverEnv().ENCRYPTION_KEY;
  if (!secret) {
    if (!warned) console.warn('ENCRYPTION_KEY is not set; using a development-only key.');
    warned = true;
    secret = DEV_KEY;
  }
  return Buffer.from(hkdfSync('sha256', secret, 'aurai', `aurai:secrets:${VERSION}`, 32));
}

export function seal(plaintext, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function open(sealed, aad) {
  const [version, iv, tag, ciphertext] = String(sealed).split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error('Unrecognised secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

/**
 * A short signature over `value` for one purpose, for URLs handed to a third party (e.g. the
 * webhook OpenRouter calls when a video is ready). Its own derived key, never the sealing key.
 */
export function signToken(purpose, value) {
  const tokenKey = Buffer.from(hkdfSync('sha256', secret(), 'aurai', `aurai:tokens:${purpose}`, 32));
  return createHmac('sha256', tokenKey).update(String(value)).digest('base64url').slice(0, 32);
}

export function verifyToken(purpose, value, token) {
  const expected = Buffer.from(signToken(purpose, value));
  const given = Buffer.from(String(token ?? ''));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
