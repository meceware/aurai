import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from './auth.js';

/**
 * The request's session, looked up once per request: the layout, the page and its metadata all
 * ask, and React's cache() makes those one database read instead of three.
 */
export const currentSession = cache(async () => {
  // Read the request before touching auth: `headers()` aborts the render during `next build`,
  // so this ordering is what keeps the build from opening (and creating) the database.
  const requestHeaders = await headers();
  return getAuth().api.getSession({ headers: requestHeaders });
});

/** The signed-in user, or null — for callers that answer rather than redirect. */
export async function currentUser() {
  const session = await currentSession();
  return session?.user ? { id: session.user.id, email: session.user.email } : null;
}

/** For pages and server actions: the signed-in user, or a redirect to sign in. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

export class Unauthorized extends Error {}

/** For route handlers, which answer 401 instead of redirecting. */
export async function requireApiUser(request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session?.user) throw new Unauthorized();
  return { id: session.user.id, email: session.user.email };
}
