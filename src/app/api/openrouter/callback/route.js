import { NextResponse } from 'next/server';
import { COOKIE, exchangeCode, readFlow } from '@/lib/openrouter/pkce';
import { keyDetailsForKey } from '@/lib/openrouter/key-details';
import { requireApiUser, Unauthorized } from '@/lib/session';
import { saveOpenRouterKey } from '@/lib/settings';

/** Where OpenRouter sends the person back: trade the code for a key and keep it. */
export async function GET(request) {
  const url = new URL(request.url);
  const back = (params) => {
    const response = NextResponse.redirect(new URL(`/settings?tab=openrouter&${params}`, request.url));
    response.cookies.set(COOKIE, '', { path: '/api/openrouter', maxAge: 0 });
    return response;
  };

  let user;
  try {
    user = await requireApiUser(request);
  } catch (error) {
    if (error instanceof Unauthorized) return NextResponse.redirect(new URL('/login?next=/settings', request.url));
    throw error;
  }

  const code = url.searchParams.get('code');
  if (!code) return back('connect_error=denied');
  const flow = readFlow(request.cookies.get(COOKIE)?.value, user.id);
  if (!flow || flow.state !== url.searchParams.get('state')) return back('connect_error=expired');

  try {
    const apiKey = await exchangeCode(code, flow.verifier);
    const { error } = await keyDetailsForKey(apiKey);
    if (error) return back('connect_error=rejected');
    saveOpenRouterKey(user.id, apiKey);
    return back('connected=1');
  } catch (error) {
    console.warn(`[aurai] OpenRouter connect failed: ${error.message}`);
    return back('connect_error=failed');
  }
}
