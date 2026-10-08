import { NextResponse } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

const PUBLIC = ['/login'];
const TURNSTILE = 'https://challenges.cloudflare.com';

function contentSecurityPolicy(nonce) {
  const dev = process.env.NODE_ENV === 'development';
  const turnstile = Boolean(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Radix and sonner position things with inline style attributes, which nonces cannot cover.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}${turnstile ? ` ${TURNSTILE}` : ''}`,
    `frame-src ${turnstile ? TURNSTILE : "'none'"}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

/**
 * Two jobs: a fresh CSP nonce per page render, and an optimistic redirect for visitors with no
 * session cookie. The cookie check is only a fast path; every page, action and route handler
 * verifies the session itself.
 */
export function proxy(request) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (!isPublic && !getSessionCookie(request, { cookiePrefix: 'aurai' })) {
    const url = new URL('/login', request.url);
    if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // API routes answer for themselves (and uploads must not pass through here: proxy
      // truncates request bodies past 10 MB).
      source: '/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
