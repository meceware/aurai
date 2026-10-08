import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { turnstileSiteKey } from '@/lib/turnstile';
import { safeNext } from './schema';
import { SignInForm } from './signin-form';

export const metadata = { title: 'Sign in' };

// better-auth reports link failures with its own codes (INVALID_TOKEN, EXPIRED_TOKEN, …);
// to the person holding the link they all mean the same thing.
const LINK_PROBLEM = 'That sign-in link has expired or was already used. Request a new one below.';

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await currentUser()) redirect(next);

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 size-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/10 blur-3xl"
      />
      <SignInForm
        next={next}
        siteKey={turnstileSiteKey()}
        initialProblem={params.error ? LINK_PROBLEM : null}
        initialNotice={params.deleted ? 'Your account and everything in it have been deleted.' : null}
      />
    </main>
  );
}
