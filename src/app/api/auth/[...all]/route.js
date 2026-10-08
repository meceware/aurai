import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth';
import { clientIp } from '@/lib/client-ip';
import { hit } from '@/lib/rate-limit';

// Every sign-in step runs through server actions, which apply this app's own rate limits and
// signup policy. The only endpoint the browser needs directly is the link in the email, so
// nothing else is exposed: no unthrottled side door to send mail or guess codes.
const VERIFY = '/api/auth/magic-link/verify';

const notFound = () => new Response('Not found', { status: 404 });

export async function GET(request) {
  if (new URL(request.url).pathname !== VERIFY) return notFound();

  const limited = hit(`verify-link:ip:${clientIp(request.headers)}`, { limit: 30, windowSeconds: 15 * 60 });
  if (!limited.ok) return new Response('Too many requests', { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } });

  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST() {
  return notFound();
}
