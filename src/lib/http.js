import 'server-only';
import { siteConfig } from './config.js';

/**
 * Mutating route handlers accept only same-origin requests. Server actions get this check from
 * Next itself; route handlers do not.
 */
export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (siteConfig.url) return origin === new URL(siteConfig.url).origin;
  return origin === new URL(request.url).origin;
}

export const json = (body, status = 200, headers = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
