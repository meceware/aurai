import 'server-only';
import { prepared } from './db.js';
import { requireApiUser, Unauthorized } from './session.js';

/**
 * The signed-in user's asset, or a ready-made error response. Every media route goes through
 * here, so ownership is checked in exactly one place.
 */
export async function ownedAsset(request, id) {
  let user;
  try {
    user = await requireApiUser(request);
  } catch (error) {
    if (error instanceof Unauthorized) return { response: new Response('Unauthorized', { status: 401 }) };
    throw error;
  }
  const asset = prepared('SELECT * FROM assets WHERE id = ? AND user_id = ?').get(id, user.id);
  if (!asset) return { response: new Response('Not found', { status: 404 }) };
  return { user, asset };
}

/** The session's original photo, and a rendition of an asset if one exists. */
export function sourceOf(asset) {
  return prepared('SELECT a.* FROM assets a JOIN image_sessions s ON s.source_asset_id = a.id WHERE s.id = ?').get(asset.image_session_id);
}

export function previewOf(assetId) {
  return prepared("SELECT * FROM assets WHERE parent_asset_id = ? AND kind = 'preview'").get(assetId) ?? null;
}

export const SANDBOX_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
};
