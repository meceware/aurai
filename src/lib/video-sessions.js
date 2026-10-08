import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assetFor, previewOf, recordAsset, storeAsset, thumbOf } from './assets.js';
import { prepared, transaction } from './db.js';
import { inspectUpload, renderPreview, renderThumb, UploadError } from './media/ingest.js';
import { frameFromPhoto, inspectVideo, normalizeVideo, videoStill, zoomedFrame } from './media/video.js';
import { absolutePath, newAssetPath, removeFile, removeFolder, sessionFolder } from './storage.js';
import { planClip } from './video-pricing.js';

// A video session is what the clips are made from — a photo in Animate, a video in Edit Video —
// and every clip made from it. Clips are jobs: queued here, worked off by the video runner
// (which talks to OpenRouter or renders locally), and shown on the page.

export const VIDEO_TOOLS = { animate: '/animate', edit: '/edit-video' };
// Under the 100 MB a request may carry through Cloudflare (tunnels included) on its free plan,
// so a too-large video gets this app's message rather than Cloudflare's error page.
export const MAX_VIDEO_UPLOAD_BYTES = 90 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 30;

export const ACTIVE = ['queued', 'submitting', 'pending', 'in_progress', 'downloading'];

function titleFrom(filename, what = 'Photo') {
  const base = String(filename || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  if (base && !/^(img|dsc|dscn|image|photo|pxl|scan)?[\s\d]*$/i.test(base)) return base;
  return `${what} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

/** A new session from a photo (an upload, or a result from an image tool), with its preview and thumbnail. */
export async function createVideoSession({ userId, buffer, filename, title = null, fromImageRunId = null }) {
  const info = await inspectUpload(buffer);
  const id = randomUUID();
  const folder = sessionFolder(userId, 'video', id);
  const now = Date.now();
  prepared('INSERT INTO video_sessions (id, user_id, title, from_image_run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    userId,
    title ?? titleFrom(filename),
    fromImageRunId,
    now,
    now,
  );
  try {
    const source = await storeAsset({
      userId,
      videoSessionId: id,
      folder,
      kind: 'source',
      data: buffer,
      mime: info.mime,
      ext: info.ext,
      width: info.width,
      height: info.height,
      meta: { filename: String(filename || '').slice(0, 200) },
    });
    const [preview, thumb] = await Promise.all([renderPreview(buffer), renderThumb(buffer)]);
    await storeAsset({ userId, videoSessionId: id, folder, kind: 'preview', parentAssetId: source.id, ...preview });
    await storeAsset({ userId, videoSessionId: id, folder, kind: 'thumb', parentAssetId: source.id, ...thumb });
    prepared('UPDATE video_sessions SET source_asset_id = ? WHERE id = ?').run(source.id, id);
    return id;
  } catch (error) {
    prepared('DELETE FROM video_sessions WHERE id = ?').run(id);
    await removeFolder(folder);
    throw error;
  }
}

/**
 * A new Edit Video session from an uploaded video (a file on disk): checked, made ready to send
 * (see normalizeVideo), with its first frame as preview and thumbnail.
 */
export async function createVideoEditSession({ userId, file, filename }) {
  const info = await inspectVideo(file).catch(() => null);
  if (!info) throw new UploadError('That file is not a video Aurai can read. Try an MP4, MOV or WebM.');
  if (info.duration && info.duration > MAX_VIDEO_SECONDS + 0.5) throw new UploadError(`Videos can be up to ${MAX_VIDEO_SECONDS} seconds. Trim it, then upload it again.`);

  const id = randomUUID();
  const folder = sessionFolder(userId, 'video', id);
  const now = Date.now();
  prepared("INSERT INTO video_sessions (id, user_id, title, tool, created_at, updated_at) VALUES (?, ?, ?, 'edit', ?, ?)").run(id, userId, titleFrom(filename, 'Video'), now, now);
  const path = newAssetPath(folder, 'mp4');
  const temp = `${absolutePath(path)}.part.mp4`;
  try {
    await mkdir(dirname(absolutePath(path)), { recursive: true });
    await normalizeVideo({ input: file, output: temp, info });
    const ready = await inspectVideo(temp);
    if (!ready) throw new UploadError('That video could not be read. Try another file.');
    await rename(temp, absolutePath(path));
    const source = recordAsset({
      userId,
      videoSessionId: id,
      path,
      kind: 'source',
      mime: 'video/mp4',
      bytes: (await stat(absolutePath(path))).size,
      width: ready.width,
      height: ready.height,
      durationS: ready.duration,
      meta: { filename: String(filename || '').slice(0, 200), audio: ready.audio },
    });
    const still = await videoStill(absolutePath(path));
    const [preview, thumb] = await Promise.all([renderPreview(still), renderThumb(still)]);
    await storeAsset({ userId, videoSessionId: id, folder, kind: 'preview', parentAssetId: source.id, ...preview });
    await storeAsset({ userId, videoSessionId: id, folder, kind: 'thumb', parentAssetId: source.id, ...thumb });
    prepared('UPDATE video_sessions SET source_asset_id = ? WHERE id = ?').run(source.id, id);
    return id;
  } catch (error) {
    prepared('DELETE FROM video_sessions WHERE id = ?').run(id);
    await removeFolder(folder);
    throw error;
  } finally {
    await rm(temp, { force: true });
  }
}

export function listVideoSessions(userId, tool = 'animate', limit = 60) {
  return prepared(
    `SELECT s.id, s.title, s.updated_at, s.closed_at,
            (SELECT t.id FROM assets t WHERE t.parent_asset_id = s.source_asset_id AND t.kind = 'thumb') AS thumb_id
       FROM video_sessions s
      WHERE s.user_id = ? AND s.tool = ?
      ORDER BY s.updated_at DESC
      LIMIT ?`,
  ).all(userId, tool, limit);
}

/** Marks a video session as done (it moves to the Done group of its history), or back in progress. */
export function setVideoSessionDone(userId, sessionId, done) {
  return prepared('UPDATE video_sessions SET closed_at = ? WHERE id = ? AND user_id = ?').run(done ? Date.now() : null, sessionId, userId).changes > 0;
}

export const getVideoSession = (userId, sessionId) => prepared('SELECT * FROM video_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId) ?? null;
export const getVideoJob = (userId, jobId) => prepared('SELECT * FROM video_jobs WHERE id = ? AND user_id = ?').get(jobId, userId) ?? null;

/**
 * A still for a clip to start or end on: the photo cut to `aspect`, and for a `view` closer than
 * the whole photo (`{ zoom, x, y }`, as in a motion's camera), that part of it. Made once per
 * session, shape and view, then reused by every clip that needs it.
 */
export async function frameFor(userId, sessionId, aspect, view = null) {
  const close = view && view.zoom > 1 ? view : null;
  const key = close ? `${aspect}@${close.zoom},${close.x},${close.y}` : aspect;
  const existing = prepared("SELECT id FROM assets WHERE video_session_id = ? AND kind = 'frame' AND json_extract(meta_json, '$.key') = ?").get(sessionId, key);
  if (existing) return existing.id;

  const session = getVideoSession(userId, sessionId);
  const source = assetFor(userId, session?.source_asset_id);
  if (!source) throw new Error('The photo for this video is gone.');
  let frame = await frameFromPhoto(await readFile(absolutePath(source.path)), aspect);
  if (close) frame = await zoomedFrame(frame.data, close);
  const stored = await storeAsset({
    userId,
    videoSessionId: sessionId,
    folder: sessionFolder(userId, 'video', sessionId),
    kind: 'frame',
    parentAssetId: source.id,
    data: frame.data,
    mime: 'image/jpeg',
    ext: 'jpg',
    width: frame.width,
    height: frame.height,
    meta: { key, aspect, view: close },
  });
  return stored.id;
}

/**
 * The clips for an Edit Video request, one per model: each changes the whole video, so it is as
 * long as the video — or the nearest length the model makes, for models that publish lengths —
 * at the size nearest to `resolution`, in the video's own shape.
 */
export function editJobs({ source, profiles, resolution, instruction }) {
  const seconds = Math.max(1, Math.round(source.duration_s ?? 5));
  // While a clip is being made, its card shows the video's first frame.
  const poster = previewOf(source.id)?.id ?? null;
  return profiles.map((profile) => {
    const clip = planClip(profile, { target: resolution, duration: seconds, audio: false, width: source.width, height: source.height });
    return {
      model: profile.id,
      preset: null,
      instruction,
      frameAssetId: poster,
      params: {
        tool: 'edit',
        inputAssetId: source.id,
        resolution: clip.resolution,
        duration: profile.durations.length ? clip.duration : null,
        aspect: clip.aspect,
        // The video's own shape, for the card while the clip is made (when no aspect is sent).
        shape: `${source.width}:${source.height}`,
        audio: false,
        audioOption: profile.audio,
        estimate: clip.cost,
      },
    };
  });
}

/** Queues clips: one, or several made side by side for comparison (sharing a group id). */
export function createVideoJobs({ userId, sessionId, jobs, parentJobId = null }) {
  const groupId = jobs.length > 1 ? randomUUID() : null;
  const now = Date.now();
  const ids = jobs.map(() => randomUUID());
  transaction(() => {
    const insert = prepared(
      `INSERT INTO video_jobs (id, user_id, session_id, parent_job_id, comparison_group_id, model, preset, instruction, params_json, frame_asset_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    );
    jobs.forEach((job, index) =>
      insert.run(ids[index], userId, sessionId, parentJobId, groupId, job.model, job.preset, job.instruction ?? null, JSON.stringify(job.params), job.frameAssetId, now + index),
    );
    // Working on it again means it is not done.
    prepared('UPDATE video_sessions SET updated_at = ?, closed_at = NULL WHERE id = ?').run(now, sessionId);
  });
  return ids;
}

function display(asset) {
  if (!asset) return null;
  const video = asset.mime.startsWith('video/');
  return { id: asset.id, displayId: previewOf(asset.id)?.id ?? asset.id, width: asset.width, height: asset.height, video, duration: asset.duration_s, audio: Boolean(asset.meta?.audio) };
}

/** Everything the session page shows, shaped for the client. */
export function getVideoSessionView(userId, sessionId) {
  const session = getVideoSession(userId, sessionId);
  if (!session) return null;
  const source = assetFor(userId, session.source_asset_id);
  const jobs = prepared('SELECT * FROM video_jobs WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
  return {
    id: session.id,
    title: session.title,
    tool: session.tool,
    closedAt: session.closed_at ?? null,
    fromImageRunId: session.from_image_run_id,
    source: source ? { ...display(source), thumbId: thumbOf(source.id) } : null,
    jobs: jobs.map((job) => {
      const video = assetFor(userId, job.video_asset_id);
      const params = JSON.parse(job.params_json || '{}');
      return {
        id: job.id,
        groupId: job.comparison_group_id,
        parentJobId: job.parent_job_id,
        model: job.model,
        preset: job.preset,
        instruction: job.instruction,
        status: job.status,
        error: job.error,
        params: {
          tool: params.tool ?? 'animate',
          resolution: params.resolution,
          duration: params.duration,
          aspect: params.aspect,
          shape: params.shape ?? null,
          audio: Boolean(params.audio),
          anchor: Boolean(params.anchor),
        },
        costUsd: job.cost_usd,
        createdAt: job.created_at,
        submittedAt: job.submitted_at,
        completedAt: job.completed_at,
        posterId: job.frame_asset_id,
        video: video ? { id: video.id, width: video.width, height: video.height, duration: video.duration_s, bytes: video.bytes } : null,
      };
    }),
  };
}

export function videoJobStatuses(userId, sessionId) {
  return prepared('SELECT id, status FROM video_jobs WHERE session_id = ? AND user_id = ? ORDER BY created_at').all(sessionId, userId);
}

export async function deleteVideoSession(userId, sessionId) {
  const deleted = prepared('DELETE FROM video_sessions WHERE id = ? AND user_id = ?').run(sessionId, userId).changes > 0;
  if (deleted) await removeFolder(sessionFolder(userId, 'video', sessionId));
  return deleted;
}

/** Deletes one clip and its video file; the frames stay for the session's other clips. */
export async function deleteVideoJob(userId, jobId) {
  const job = getVideoJob(userId, jobId);
  if (!job) return false;
  const video = assetFor(userId, job.video_asset_id);
  transaction(() => {
    prepared('DELETE FROM video_jobs WHERE id = ?').run(jobId);
    if (video) prepared('DELETE FROM assets WHERE id = ?').run(video.id);
  });
  if (video) await removeFile(video.path);
  return true;
}
