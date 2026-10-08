import 'server-only';
import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP, magicLink } from 'better-auth/plugins';
import { serverEnv, siteConfig } from './config.js';
import { getDb } from './db.js';
import { mailFrom, mailSend } from './mail.js';
import { canCreateAccount } from './signup-policy.js';

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const html = ({ url, token }) => `
  <body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;">
    <table role="presentation" style="width:100%;border-collapse:collapse;border:0;">
      <tr>
        <td align="center" style="padding:2rem 1rem;">
          <div style="max-width:28rem;padding:2rem;background:#ffffff;border-radius:12px;text-align:center;color:#1a1a1a;">
            <h1 style="margin:0 0 0.25rem;font-size:1.25rem;">Sign in to ${escape(siteConfig.name)}</h1>
            <p style="margin:0 0 1.5rem;color:#666;">Use the button, or type the code.</p>
            <a href="${escape(url)}" target="_blank" style="display:inline-block;padding:0.75rem 1.5rem;border-radius:8px;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:600;">Sign in</a>
            <div style="margin:1.5rem 0 0.5rem;color:#666;">Your code</div>
            <div style="font-size:1.75rem;font-weight:700;letter-spacing:0.5rem;padding:0.75rem;background:#f4f4f4;border-radius:8px;">${escape(token)}</div>
            <p style="margin:1.5rem 0 0;color:#888;font-size:0.85rem;">The link and code expire in 20 minutes. If you didn't ask to sign in, ignore this email.</p>
          </div>
        </td>
      </tr>
    </table>
  </body>
`;

const text = ({ url, token }) =>
  `Sign in to ${siteConfig.name}\n\nOpen this link:\n${url}\n\nOr enter this code: ${token}\n\nThe link and code expire in 20 minutes. If you didn't ask to sign in, ignore this email.`;

export const ipResolution = {
  ipAddressHeaders: ['x-forwarded-for', 'cf-connecting-ip'],
  // Loopback and the private ranges: every hop between the reverse proxy and the container is our own.
  trustedProxies: ['127.0.0.1/32', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
};

const EXPIRES_IN = 20 * 60;

let instance = null;

export function getAuth() {
  const env = serverEnv();

  instance ??= betterAuth({
    appName: siteConfig.name,
    baseURL: siteConfig.url,
    secret: env.AUTH_SECRET || 'dev-only-secret-change-me-dev-only-secret',
    trustedOrigins: siteConfig.url ? [siteConfig.url] : [],
    database: getDb(),
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    databaseHooks: {
      user: {
        create: {
          // Second lock behind the sign-in form's own check: whatever path reaches account
          // creation, the policy holds.
          async before(user) {
            if (!canCreateAccount(user.email)) {
              throw new APIError('FORBIDDEN', { message: 'Sign-ups are closed.' });
            }
            return { data: user };
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: EXPIRES_IN,
        storeToken: 'hashed',
        sendMagicLink: async ({ email, url }) => {
          // The one-time code is minted here so a single email carries both ways in, which is
          // why emailOTP's own sender below is intentionally silent.
          const otp = await getAuth().api.createVerificationOTP({ body: { email, type: 'sign-in' } });

          await mailSend({
            from: `${siteConfig.from} <${mailFrom}>`,
            to: email,
            subject: `Sign in to ${siteConfig.name}`,
            html: html({ url, token: otp }),
            text: text({ url, token: otp }),
          });
        },
      }),
      emailOTP({
        expiresIn: EXPIRES_IN,
        storeOTP: 'hashed',
        allowedAttempts: 3,
        // Deliberately sends nothing: the code travels inside the magic-link email above.
        async sendVerificationOTP() {},
      }),
      // Must stay last: plugins with `after` hooks that run past it can set cookies which
      // never reach Next's cookie store, which would silently break sign-in.
      nextCookies(),
    ],
    advanced: {
      cookiePrefix: siteConfig.cookiePrefix,
      ipAddress: ipResolution,
    },
    logger: { level: 'warn' },
  });

  return instance;
}
