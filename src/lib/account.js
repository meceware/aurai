import 'server-only';
import { headers } from 'next/headers';
import { getAuth } from './auth.js';
import { prepared } from './db.js';
import { deleteImageSession } from './image-sessions.js';
import { deleteVideoSession } from './video-sessions.js';
import { currentSession } from './session.js';
import { removeUserMedia } from './storage.js';

// Browser names for the sessions list, from the user agent. Enough to recognise a device.
function device(userAgent = '') {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

/**
 * Signed-in devices, without their tokens: the client only ever sees an id to revoke. Read from
 * the database rather than better-auth's list-sessions endpoint, which only answers a session
 * signed in within the last day — so Settings would fail for everyone else.
 */
export async function listDevices(userId) {
  const current = (await currentSession())?.session?.id;
  // better-auth stores these as ISO timestamps, which sort as text.
  const sessions = prepared('SELECT id, "userAgent", "ipAddress", "updatedAt" FROM "session" WHERE "userId" = ? AND "expiresAt" > ?').all(userId, new Date().toISOString());
  return sessions
    .map((session) => ({
      id: session.id,
      device: device(session.userAgent ?? ''),
      ip: session.ipAddress ?? null,
      lastActive: new Date(session.updatedAt).getTime(),
      current: session.id === current,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActive - a.lastActive);
}

/** Signs one device out. Scoped to the user, so an id from someone else's account does nothing. */
export function revokeDevice(userId, sessionId) {
  return prepared('DELETE FROM "session" WHERE id = ? AND "userId" = ?').run(sessionId, userId).changes > 0;
}

export async function revokeOtherDevices() {
  await getAuth().api.revokeOtherSessions({ headers: await headers() });
}

const ACTIVE_VIDEO = "('queued', 'submitting', 'pending', 'in_progress', 'downloading')";

/**
 * Every photo the person has, in every tool, with all results, videos and files. `abort` stops
 * the work in flight (`{ image(runId), video(jobId) }`). Returns how many photos were removed.
 */
export async function deleteAllPhotos(userId, abort) {
  const sessions = prepared('SELECT id FROM image_sessions WHERE user_id = ?').all(userId);
  for (const { id } of sessions) {
    for (const run of prepared("SELECT id FROM image_runs WHERE session_id = ? AND status IN ('queued', 'running')").all(id)) abort.image(run.id);
    await deleteImageSession(userId, id);
  }
  const videos = prepared('SELECT id FROM video_sessions WHERE user_id = ?').all(userId);
  for (const { id } of videos) {
    for (const job of prepared(`SELECT id FROM video_jobs WHERE session_id = ? AND status IN ${ACTIVE_VIDEO}`).all(id)) abort.video(job.id);
    await deleteVideoSession(userId, id);
  }
  return sessions.length + videos.length;
}

/**
 * Removes the account and everything in it. The user row cascades through every table (sessions,
 * settings, photos, runs, files' records); the media folder goes after the rows are gone.
 */
export async function deleteAccount(userId, abort) {
  for (const run of prepared("SELECT id FROM image_runs WHERE user_id = ? AND status IN ('queued', 'running')").all(userId)) abort.image(run.id);
  for (const job of prepared(`SELECT id FROM video_jobs WHERE user_id = ? AND status IN ${ACTIVE_VIDEO}`).all(userId)) abort.video(job.id);
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    // The rows below go either way.
  }
  prepared('DELETE FROM "user" WHERE id = ?').run(userId);
  await removeUserMedia(userId);
}
