import { serverEnv, siteConfig } from './config.js';
import { signToken, verifyToken } from './crypto.js';
import { prepared } from './db.js';

// OpenRouter does not take a video inside a request: it fetches one from an HTTPS address. So a
// video to edit is reachable through a link made for that one edit, which opens only that video,
// only while OpenRouter is working on the edit, and for a few hours at most. The video is not
// uploaded anywhere; OpenRouter (and the model's provider) fetch it from this server.

const TTL_MS = 3 * 60 * 60 * 1000;
// From being sent until OpenRouter reports back: the only time it may need the video.
const FETCHABLE = ['submitting', 'pending', 'in_progress'];

export const EDIT_NEEDS_HTTPS =
  'Edit Video requires HTTPS to work: Aurai has to be at a public HTTPS address (SITE_URL). OpenRouter does not take a video inside a request; it fetches it from Aurai, through a link that opens only that video, only while the edit is being made.';

/** This server's public HTTPS address, when it has one OpenRouter can reach; else null. */
export function publicBase() {
  const base = siteConfig.url;
  if (!base?.startsWith('https://') || /\/\/(localhost|127\.|\[::1\])/.test(base)) return null;
  return base.replace(/\/+$/, '');
}

/** Whether Edit Video can work here. Mock jobs never leave this machine, so they always can. */
export const videoEditAvailable = () => Boolean(serverEnv().OPENROUTER_MOCK || publicBase());

/** The link OpenRouter fetches one edit's video by, relative to the site. */
export function editVideoLink(jobId, now = Date.now()) {
  const expires = Math.ceil((now + TTL_MS) / 1000);
  return `/api/public-media/${jobId}.${expires}.${signToken('edit-video', `${jobId}.${expires}`)}`;
}

/**
 * The video a link opens, with its job — or null when the link is forged, altered or expired,
 * or its edit is no longer waiting on OpenRouter (finished, failed, stopped or deleted).
 */
export function linkedVideo(token, now = Date.now()) {
  const [jobId, expires, signature, extra] = String(token ?? '').split('.');
  if (!jobId || !expires || !signature || extra !== undefined) return null;
  if (!/^\d+$/.test(expires) || Number(expires) * 1000 < now) return null;
  if (!verifyToken('edit-video', `${jobId}.${expires}`, signature)) return null;
  const job = prepared('SELECT id, user_id, status, params_json FROM video_jobs WHERE id = ?').get(jobId);
  if (!job || !FETCHABLE.includes(job.status)) return null;
  const params = JSON.parse(job.params_json || '{}');
  if (params.tool !== 'edit') return null;
  const asset = prepared("SELECT * FROM assets WHERE id = ? AND user_id = ? AND mime LIKE 'video/%'").get(params.inputAssetId, job.user_id);
  return asset ? { job, asset } : null;
}
