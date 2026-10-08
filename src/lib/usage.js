import 'server-only';
import { serverEnv } from './config.js';
import { prepared } from './db.js';
import { usedBytes } from './storage.js';

// Image runs and video jobs, as one list of billed work.
const BILLED = `
  SELECT created_at, cost_usd, COALESCE(json_extract(params_json, '$.mode'), 'enhance') AS tool FROM image_runs WHERE user_id = @user AND cost_usd IS NOT NULL
  UNION ALL
  SELECT j.created_at, j.cost_usd, CASE s.tool WHEN 'edit' THEN 'edit-video' ELSE 'animate' END AS tool
    FROM video_jobs j JOIN video_sessions s ON s.id = j.session_id
   WHERE j.user_id = @user AND j.cost_usd IS NOT NULL AND (j.cost_usd > 0 OR j.model NOT LIKE 'local/%')`;

/** What this person has spent through Aurai, from the cost OpenRouter reports for each run. */
export function spending(userId) {
  const total = prepared(`SELECT COALESCE(SUM(cost_usd), 0) AS usd, COUNT(*) AS runs FROM (${BILLED})`).get({ user: userId });
  const months = prepared(
    `SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch') AS month, SUM(cost_usd) AS usd, COUNT(*) AS runs
       FROM (${BILLED}) GROUP BY month ORDER BY month DESC LIMIT 6`,
  ).all({ user: userId });
  const tools = prepared(`SELECT tool, SUM(cost_usd) AS usd, COUNT(*) AS runs FROM (${BILLED}) GROUP BY tool`).all({ user: userId });
  return { total: total.usd, runs: total.runs, months, tools };
}

export function storageUsage(userId) {
  const sessions = prepared('SELECT mode, COUNT(*) AS photos FROM image_sessions WHERE user_id = ? GROUP BY mode').all(userId);
  const videos = Object.fromEntries(prepared('SELECT tool, COUNT(*) AS n FROM video_sessions WHERE user_id = ? GROUP BY tool').all(userId).map((row) => [row.tool, row.n]));
  const results = prepared("SELECT COUNT(*) AS n FROM image_runs WHERE user_id = ? AND status = 'succeeded'").get(userId).n;
  const clips = prepared("SELECT COUNT(*) AS n FROM video_jobs WHERE user_id = ? AND status = 'completed'").get(userId).n;
  return {
    bytes: usedBytes(userId),
    quotaBytes: serverEnv().USER_QUOTA_MB * 1024 * 1024,
    photos: { ...Object.fromEntries(sessions.map((row) => [row.mode, row.photos])), animate: videos.animate ?? 0, 'edit-video': videos.edit ?? 0 },
    results,
    clips,
  };
}

/**
 * Recent work for the home page, per tool: the newest few still in progress, with a thumbnail and
 * how much has been made from each, how many are in progress in all, and how many are done.
 */
export function recentWork(userId, perTool = 4) {
  const photos = prepared(
    `SELECT s.id, s.title, s.mode AS tool, s.updated_at AS at, s.closed_at,
            (SELECT t.id FROM assets t WHERE t.parent_asset_id = s.source_asset_id AND t.kind = 'thumb') AS thumb_id,
            (SELECT COUNT(*) FROM image_runs r WHERE r.session_id = s.id AND r.status = 'succeeded') AS results
       FROM image_sessions s WHERE s.user_id = ? ORDER BY s.updated_at DESC`,
  ).all(userId);
  const videos = prepared(
    `SELECT v.id, v.title, v.tool, v.updated_at AS at, v.closed_at,
            (SELECT t.id FROM assets t WHERE t.parent_asset_id = v.source_asset_id AND t.kind = 'thumb') AS thumb_id,
            (SELECT COUNT(*) FROM video_jobs j WHERE j.session_id = v.id AND j.status = 'completed') AS results
       FROM video_sessions v WHERE v.user_id = ? ORDER BY v.updated_at DESC`,
  ).all(userId);
  const group = (items) => {
    const open = items.filter((item) => !item.closed_at);
    return { items: open.slice(0, perTool), total: open.length, done: items.length - open.length, latest: open[0]?.at ?? 0 };
  };
  return {
    enhance: group(photos.filter((item) => item.tool === 'enhance')),
    colorize: group(photos.filter((item) => item.tool === 'colorize')),
    repair: group(photos.filter((item) => item.tool === 'repair')),
    upscale: group(photos.filter((item) => item.tool === 'upscale')),
    animate: group(videos.filter((item) => item.tool === 'animate')),
    'edit-video': group(videos.filter((item) => item.tool === 'edit')),
  };
}

/** Anything still being worked on right now, so the home page can say so. */
export function activeCount(userId) {
  const runs = prepared("SELECT COUNT(*) AS n FROM image_runs WHERE user_id = ? AND status IN ('queued', 'running')").get(userId).n;
  const clips = prepared(
    "SELECT COUNT(*) AS n FROM video_jobs WHERE user_id = ? AND status IN ('queued', 'submitting', 'pending', 'in_progress', 'downloading')",
  ).get(userId).n;
  return runs + clips;
}
