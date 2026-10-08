import { randomUUID } from 'node:crypto';
import { prepared } from './db.js';
import { newAssetPath, writeFileAtomic } from './storage.js';

/**
 * Writes a file into a session folder and records it. The file goes first so a row never
 * points at nothing; a crash in between leaves only an orphan file, which the sweeper removes.
 */
export async function storeAsset({ userId, imageSessionId = null, videoSessionId = null, folder, kind, data, mime, ext, width = null, height = null, durationS = null, parentAssetId = null, meta = null }) {
  const id = randomUUID();
  const path = newAssetPath(folder, ext);
  await writeFileAtomic(path, data);
  prepared(
    `INSERT INTO assets (id, user_id, image_session_id, video_session_id, parent_asset_id, kind, mime, path, bytes, width, height, duration_s, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, imageSessionId, videoSessionId, parentAssetId, kind, mime, path, data.length, width, height, durationS, meta ? JSON.stringify(meta) : null, Date.now());
  return { id, path, kind, mime, width, height, bytes: data.length };
}

/** Records a file already written to `path` (a stream too large to hold in memory, such as a video). */
export function recordAsset({ userId, imageSessionId = null, videoSessionId = null, path, kind, mime, bytes, width = null, height = null, durationS = null, parentAssetId = null, meta = null }) {
  const id = randomUUID();
  prepared(
    `INSERT INTO assets (id, user_id, image_session_id, video_session_id, parent_asset_id, kind, mime, path, bytes, width, height, duration_s, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, imageSessionId, videoSessionId, parentAssetId, kind, mime, path, bytes, width, height, durationS, meta ? JSON.stringify(meta) : null, Date.now());
  return { id, path, kind, mime, width, height, bytes };
}

export function assetFor(userId, id) {
  if (!id) return null;
  const row = prepared('SELECT * FROM assets WHERE id = ? AND user_id = ?').get(id, userId);
  return row ? { ...row, meta: row.meta_json ? JSON.parse(row.meta_json) : null } : null;
}

/** The display rendition of an asset when there is one, else the asset itself. */
export function previewOf(assetId) {
  return prepared("SELECT id, width, height FROM assets WHERE parent_asset_id = ? AND kind = 'preview'").get(assetId) ?? null;
}

export function thumbOf(assetId) {
  return prepared("SELECT id FROM assets WHERE parent_asset_id = ? AND kind = 'thumb'").get(assetId)?.id ?? null;
}

export const mediaUrl = (id) => (id ? `/api/media/${id}` : null);
