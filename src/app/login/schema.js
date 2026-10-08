import { z } from 'zod';

export const emailSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'An email is required.').max(254).email('That does not look like an email.'),
});
export const codeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'The code is six digits.') });

/** Only same-site paths survive as a post-login destination; anything else falls back. */
export function safeNext(value, fallback = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (value.startsWith('/login') || value.startsWith('/api/')) return fallback;
  return value;
}
