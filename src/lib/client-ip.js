import { isIP } from 'node:net';

// Mirrors the auth config's trusted proxies: loopback and private ranges are our own hops.
function isPrivate(ip) {
  if (ip === '::1' || ip.startsWith('127.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  const second = Number(ip.split('.')[1]);
  if (ip.startsWith('172.') && second >= 16 && second <= 31) return true;
  const lower = ip.toLowerCase();
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('::ffff:127.') || lower.startsWith('::ffff:10.');
}

/**
 * The client address as seen by our own reverse proxy: the right-most X-Forwarded-For entry
 * that is not one of our hops. Entries further left are whatever the client chose to send.
 * IPv6 addresses are bucketed to their /64, like better-auth does.
 */
export function clientIp(headers) {
  const cf = headers.get('cf-connecting-ip');
  if (cf && isIP(cf.trim())) return bucket(cf.trim());

  const chain = (headers.get('x-forwarded-for') || '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => isIP(part));
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (!isPrivate(chain[i])) return bucket(chain[i]);
  }
  return chain[0] ? bucket(chain[0]) : 'unknown';
}

function bucket(ip) {
  if (isIP(ip) !== 6) return ip;
  return ip.split(':').slice(0, 4).join(':') + '::/64';
}
