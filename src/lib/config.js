import { join } from 'node:path';
import { z } from 'zod';

const production = process.env.NODE_ENV === 'production';

export const siteConfig = {
  name: 'Aurai',
  title: 'Aurai — true colors for old photos',
  description: 'Restore the colors of your photos without touching the people in them, and bring them to life as parallax video.',
  url: process.env.SITE_URL || (production ? '' : 'http://localhost:3000'),
  from: 'Aurai',
  // Shared by the auth config and the proxy's cookie check; they must agree.
  cookiePrefix: 'aurai',
};

// turbopackIgnore, inside each path call, keeps the build tracer from taking these for files of
// the project and copying the local data folder into the build; data lives on a volume.
export const dataDir = process.env.DATA_DIR || 'data';
export const databasePath = process.env.DATABASE_PATH || join(/* turbopackIgnore: true */ dataDir, 'aurai.db');
export const mediaDir = join(/* turbopackIgnore: true */ dataDir, 'media');

const flag = (fallback) =>
  z
    .enum(['1', '0', 'true', 'false', 'yes', 'no', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : ['1', 'true', 'yes'].includes(v)));

const schema = z
  .object({
    AUTH_SECRET: z.string().optional(),
    ENCRYPTION_KEY: z.string().optional(),
    EMAIL_SERVER_HOST: z.string().optional(),
    SIGNUP_ENABLED: flag(true),
    ALLOWED_EMAIL_DOMAINS: z
      .string()
      .optional()
      .transform((v) => (v ? v.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean) : [])),
    MAX_USERS: z.coerce.number().int().min(0).default(0),
    USER_QUOTA_MB: z.coerce.number().int().min(1).default(2048),
    TURNSTILE_SITE_KEY: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),
    OPENROUTER_MOCK: flag(false),
  })
  .superRefine((env, ctx) => {
    if (!production) return;
    if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
      ctx.addIssue({ code: 'custom', path: ['AUTH_SECRET'], message: 'must be set to at least 32 characters in production' });
    }
    if (!env.ENCRYPTION_KEY) ctx.addIssue({ code: 'custom', path: ['ENCRYPTION_KEY'], message: 'must be set in production' });
    if (env.ENCRYPTION_KEY && env.ENCRYPTION_KEY === env.AUTH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['ENCRYPTION_KEY'], message: 'must differ from AUTH_SECRET' });
    }
  });

let cached = null;

/**
 * Validated server settings. Read lazily, on first use at request time, so `next build`
 * never needs production secrets.
 */
export function serverEnv() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}
