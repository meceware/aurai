import { NextResponse } from 'next/server';
import { siteConfig } from '@/lib/config';
import { COOKIE, MAX_AGE, startFlow } from '@/lib/openrouter/pkce';
import { requireApiUser, Unauthorized } from '@/lib/session';

/** Sends the person to OpenRouter to approve a key for Aurai. */
export async function GET(request) {
  let user;
  try {
    user = await requireApiUser(request);
  } catch (error) {
    if (error instanceof Unauthorized) return NextResponse.redirect(new URL('/login?next=/settings', request.url));
    throw error;
  }

  const base = siteConfig.url || new URL(request.url).origin;
  const { cookie, challenge, state } = startFlow(user.id);
  const target = new URL('https://openrouter.ai/auth');
  target.searchParams.set('callback_url', `${base}/api/openrouter/callback`);
  target.searchParams.set('code_challenge', challenge);
  target.searchParams.set('code_challenge_method', 'S256');
  target.searchParams.set('key_label', 'Aurai');
  target.searchParams.set('state', state);

  const response = NextResponse.redirect(target);
  response.cookies.set(COOKIE, cookie, {
    httpOnly: true,
    secure: base.startsWith('https://'),
    // Lax: the cookie must come back on OpenRouter's top-level redirect to the callback.
    sameSite: 'lax',
    path: '/api/openrouter',
    maxAge: MAX_AGE,
  });
  return response;
}
