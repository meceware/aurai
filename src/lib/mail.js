import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTransport } from 'nodemailer';
import { dataDir } from './config.js';

export const mailFrom = process.env.EMAIL_FROM || 'Aurai <aurai@localhost>';

let transport = null;

function smtp() {
  const port = Number(process.env.EMAIL_SERVER_PORT) || 587;
  const user = process.env.EMAIL_SERVER_USER;

  transport ??= createTransport({
    host: process.env.EMAIL_SERVER_HOST,
    port,
    // Port 465 speaks TLS from the first byte; 587 and 25 start plain and upgrade via STARTTLS.
    secure: port === 465,
    // Omitted entirely for relays that authenticate by IP — an empty user makes nodemailer
    // send AUTH with blank credentials and the server rejects the whole message.
    auth: user ? { user, pass: process.env.EMAIL_SERVER_PASSWORD } : undefined,
  });

  return transport;
}

/**
 * Without an SMTP host the message is written to the terminal, which is enough to sign in
 * during development. Development also appends it to data/dev-outbox.log, so tooling that
 * cannot see the terminal (browser tests) can read the code. Never in production: sign-in
 * codes do not belong on disk.
 */
export async function mailSend({ from, to, subject, html, text }) {
  if (!process.env.EMAIL_SERVER_HOST) {
    const message = `\n──── email to ${to} ────\n${subject}\n\n${text}\n────────────────────────\n`;
    console.info(message);
    if (process.env.NODE_ENV !== 'production') {
      await mkdir(/* turbopackIgnore: true */ dataDir, { recursive: true });
      await appendFile(join(/* turbopackIgnore: true */ dataDir, 'dev-outbox.log'), `${new Date().toISOString()}${message}`);
    }
    return;
  }

  await smtp().sendMail({ from, to, subject, html, text });
}
