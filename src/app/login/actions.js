'use server';

import { headers } from 'next/headers';
import { getAuth } from '@/lib/auth';
import { clientIp } from '@/lib/client-ip';
import { hitAll } from '@/lib/rate-limit';
import { accountExists, canCreateAccount } from '@/lib/signup-policy';
import { verifyTurnstile } from '@/lib/turnstile';
import { codeSchema, emailSchema } from './schema';

const minutes = (seconds) => Math.max(1, Math.ceil(seconds / 60));

export async function sendSignInEmail(rawEmail, turnstileToken) {
  const parsed = emailSchema.safeParse({ email: rawEmail });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email } = parsed.data;

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);

  // Per address (stops email-bombing someone), per client, and overall (protects the
  // sender's reputation if someone scripts the form across many addresses and IPs).
  const limited = hitAll([
    [`signin:email:${email}`, { limit: 3, windowSeconds: 15 * 60 }],
    [`signin:ip:${ip}`, { limit: 10, windowSeconds: 15 * 60 }],
    ['signin:global', { limit: 300, windowSeconds: 60 * 60 }],
  ]);
  if (!limited.ok) return { error: `Too many sign-in emails. Try again in ${minutes(limited.retryAfter)} min.` };

  if (!(await verifyTurnstile(turnstileToken, ip))) return { error: 'Please complete the check and try again.' };

  // An address that has no account and may not get one is answered exactly like one that
  // was sent an email, so the form never reveals who has an account.
  if (!accountExists(email) && !canCreateAccount(email)) return { sent: true, email };

  try {
    // Sending the link also mints the code that travels in the same email, so this is the
    // only entry point; requesting a code directly would send nothing.
    await getAuth().api.signInMagicLink({
      body: { email, callbackURL: '/', newUserCallbackURL: '/settings?welcome=1', errorCallbackURL: '/login?error=link' },
      headers: requestHeaders,
    });
    return { sent: true, email };
  } catch {
    return { error: 'The email could not be sent. Try again in a moment.' };
  }
}

export async function verifySignInCode(rawEmail, rawCode) {
  const parsedEmail = emailSchema.safeParse({ email: rawEmail });
  const parsedCode = codeSchema.safeParse({ code: rawCode });
  if (!parsedEmail.success || !parsedCode.success) return { error: 'Check the code and try again.' };

  const requestHeaders = await headers();
  const limited = hitAll([
    [`verify:email:${parsedEmail.data.email}`, { limit: 10, windowSeconds: 15 * 60 }],
    [`verify:ip:${clientIp(requestHeaders)}`, { limit: 30, windowSeconds: 15 * 60 }],
  ]);
  if (!limited.ok) return { error: `Too many attempts. Try again in ${minutes(limited.retryAfter)} min.` };

  try {
    const result = await getAuth().api.signInEmailOTP({
      body: { email: parsedEmail.data.email, otp: parsedCode.data.code },
      headers: requestHeaders,
    });
    const created = result?.user?.createdAt && Date.now() - new Date(result.user.createdAt).getTime() < 60_000;
    return { ok: true, isNew: Boolean(created) };
  } catch {
    return { error: 'That code did not work. It may have expired.' };
  }
}

export async function signOut() {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    // Already signed out.
  }
}
