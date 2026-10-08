import { randomUUID } from 'node:crypto';
import { assetFor, previewOf, storeAsset, thumbOf } from './assets.js';
import { prepared, transaction } from './db.js';
import { inspectUpload, renderPreview, renderThumb } from './media/ingest.js';
import { computeStats, describeStats } from './media/stats.js';
import { removeFile, removeFolder, sessionFolder } from './storage.js';

function titleFrom(filename) {
  const base = String(filename || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  // Camera and scanner names ("IMG 1234", "10 07 2003 006") say nothing; use a date instead.
  if (base && !/^(img|dsc|dscn|image|photo|pxl|scan)?[\s\d]*$/i.test(base)) return base;
  return `Photo · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
}

/**
 * A new session from an uploaded photo: the original bytes exactly as uploaded, a display
 * preview, a thumbnail, and the colour statistics. All or nothing — a failure removes
 * whatever was already written.
 */
export async function createImageSession({ userId, buffer, filename, mode = null }) {
  const info = await inspectUpload(buffer);
  const stats = await computeStats(buffer);
  const id = randomUUID();
  const folder = sessionFolder(userId, 'image', id);
  const now = Date.now();

  prepared('INSERT INTO image_sessions (id, user_id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    userId,
    titleFrom(filename),
    mode ?? (stats.grayscale ? 'colorize' : 'enhance'),
    now,
    now,
  );

  try {
    const { histogram, ...summary } = stats;
    const source = await storeAsset({
      userId,
      imageSessionId: id,
      folder,
      kind: 'source',
      data: buffer,
      mime: info.mime,
      ext: info.ext,
      width: info.width,
      height: info.height,
      meta: { filename: String(filename || '').slice(0, 200), stats: summary, histogram },
    });
    const [preview, thumb] = await Promise.all([renderPreview(buffer), renderThumb(buffer)]);
    await storeAsset({ userId, imageSessionId: id, folder, kind: 'preview', parentAssetId: source.id, ...preview });
    await storeAsset({ userId, imageSessionId: id, folder, kind: 'thumb', parentAssetId: source.id, ...thumb });
    prepared('UPDATE image_sessions SET source_asset_id = ? WHERE id = ?').run(source.id, id);
    return id;
  } catch (error) {
    prepared('DELETE FROM image_sessions WHERE id = ?').run(id);
    await removeFolder(folder);
    throw error;
  }
}

export function listImageSessions(userId, limit = 60) {
  return prepared(
    `SELECT s.id, s.title, s.mode, s.updated_at, s.closed_at,
            (SELECT t.id FROM assets t WHERE t.parent_asset_id = s.source_asset_id AND t.kind = 'thumb') AS thumb_id
       FROM image_sessions s
      WHERE s.user_id = ?
      ORDER BY s.updated_at DESC
      LIMIT ?`,
  ).all(userId, limit);
}

/** Marks a photo as done (it moves to the Done group of its history), or back in progress. */
export function setImageSessionDone(userId, sessionId, done) {
  return prepared('UPDATE image_sessions SET closed_at = ? WHERE id = ? AND user_id = ?').run(done ? Date.now() : null, sessionId, userId).changes > 0;
}

/** Moves a photo to the other tool (e.g. a black-and-white photo uploaded to Enhance). */
export function setImageSessionMode(userId, sessionId, mode) {
  return prepared('UPDATE image_sessions SET mode = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(mode, Date.now(), sessionId, userId).changes > 0;
}

function display(asset) {
  if (!asset) return null;
  const preview = previewOf(asset.id);
  return {
    id: asset.id,
    displayId: preview?.id ?? asset.id,
    width: asset.width,
    height: asset.height,
    mime: asset.mime,
  };
}

/** Everything the session page shows, already shaped for the client (no paths, no internals). */
export function getImageSessionView(userId, sessionId) {
  const session = prepared('SELECT * FROM image_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
  if (!session) return null;

  const source = assetFor(userId, session.source_asset_id);
  const runs = prepared('SELECT * FROM image_runs WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);

  return {
    id: session.id,
    title: session.title,
    mode: session.mode,
    createdAt: session.created_at,
    closedAt: session.closed_at ?? null,
    source: source
      ? {
          ...display(source),
          thumbId: thumbOf(source.id),
          filename: source.meta?.filename ?? null,
          stats: source.meta?.stats ?? null,
          histogram: source.meta?.histogram ?? null,
          summary: source.meta?.stats ? describeStats(source.meta.stats) : null,
        }
      : null,
    runs: runs.map((run) => ({
      id: run.id,
      kind: run.kind,
      mode: JSON.parse(run.params_json || '{}').mode ?? (run.kind === 'colorize' ? 'colorize' : 'enhance'),
      model: run.model,
      quality: JSON.parse(run.params_json || '{}').quality ?? null,
      instruction: run.instruction,
      status: run.status,
      error: run.error,
      parentRunId: run.parent_run_id,
      costUsd: run.cost_usd,
      durationMs: run.duration_ms,
      createdAt: run.created_at,
      startedAt: run.started_at,
      fidelity: run.fidelity_json ? JSON.parse(run.fidelity_json) : null,
      analysis: run.analysis_json ? JSON.parse(run.analysis_json) : null,
      ai: display(assetFor(userId, run.ai_asset_id)),
      locked: display(assetFor(userId, run.locked_asset_id)),
    })),
  };
}

/**
 * Several photos of one tool, in the order given, for the screen that starts them together: each
 * with its picture and its latest run. Ids that are not the person's, or not in this tool, are
 * left out.
 */
export function getBatchView(userId, sessionIds, mode) {
  return sessionIds
    .map((id) => prepared('SELECT * FROM image_sessions WHERE id = ? AND user_id = ? AND mode = ?').get(id, userId, mode))
    .filter(Boolean)
    .map((session) => {
      const source = assetFor(userId, session.source_asset_id);
      const run = prepared('SELECT id, status, error, locked_asset_id FROM image_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(session.id);
      const locked = run?.locked_asset_id ? assetFor(userId, run.locked_asset_id) : null;
      return {
        id: session.id,
        title: session.title,
        source: source ? { ...display(source), thumbId: thumbOf(source.id) } : null,
        run: run ? { id: run.id, status: run.status, error: run.error, result: locked ? display(locked).displayId : null } : null,
      };
    });
}

export function sessionRunStatuses(userId, sessionId) {
  return prepared('SELECT id, status FROM image_runs WHERE session_id = ? AND user_id = ? ORDER BY created_at').all(sessionId, userId);
}

export function getRun(userId, runId) {
  return prepared('SELECT * FROM image_runs WHERE id = ? AND user_id = ?').get(runId, userId) ?? null;
}

export function ownsImageSession(userId, sessionId) {
  return Boolean(prepared('SELECT 1 FROM image_sessions WHERE id = ? AND user_id = ?').get(sessionId, userId));
}

export function createImageRun({ userId, sessionId, kind, model, instruction = null, parentRunId = null, params = {} }) {
  const id = randomUUID();
  const now = Date.now();
  transaction(() => {
    prepared(
      `INSERT INTO image_runs (id, user_id, session_id, parent_run_id, kind, model, instruction, params_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
    ).run(id, userId, sessionId, parentRunId, kind, model, instruction, JSON.stringify(params), now);
    // Working on a photo again means it is not done.
    prepared('UPDATE image_sessions SET updated_at = ?, closed_at = NULL WHERE id = ?').run(now, sessionId);
  });
  return id;
}

/** Deletes the session row (the database cascades to runs and assets), then its folder on disk. */
export async function deleteImageSession(userId, sessionId) {
  const deleted = prepared('DELETE FROM image_sessions WHERE id = ? AND user_id = ?').run(sessionId, userId).changes > 0;
  if (deleted) await removeFolder(sessionFolder(userId, 'image', sessionId));
  return deleted;
}

/** Deletes one result and its files. Other runs keep their own assets and are unaffected. */
export async function deleteImageRun(userId, runId) {
  const run = getRun(userId, runId);
  if (!run) return false;

  const assetIds = [run.ai_asset_id, run.locked_asset_id].filter(Boolean);
  const paths = assetIds.length
    ? prepared(
        `SELECT path FROM assets WHERE user_id = ? AND (id IN (${assetIds.map(() => '?').join(',')}) OR parent_asset_id IN (${assetIds.map(() => '?').join(',')}))`,
      )
        .all(userId, ...assetIds, ...assetIds)
        .map((row) => row.path)
    : [];

  transaction(() => {
    prepared('DELETE FROM image_runs WHERE id = ?').run(runId);
    for (const id of assetIds) prepared('DELETE FROM assets WHERE id = ?').run(id);
  });
  await Promise.all(paths.map((path) => removeFile(path)));
  return true;
}
