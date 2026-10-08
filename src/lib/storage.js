import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { mediaDir } from './config.js';
import { prepared } from './db.js';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function safe(id) {
  if (!SAFE_ID.test(String(id))) throw new Error(`Unsafe path segment: ${id}`);
  return id;
}

const root = () => resolve(/* turbopackIgnore: true */ mediaDir);

/** Folder of one session: media/<user>/<img|vid>-<session>. Deleting a session removes it whole. */
export function sessionFolder(userId, kind, sessionId) {
  return join(/* turbopackIgnore: true */ safe(userId), `${kind === 'video' ? 'vid' : 'img'}-${safe(sessionId)}`);
}

/** A fresh server-chosen relative path inside a session folder. */
export function newAssetPath(folder, extension) {
  return join(/* turbopackIgnore: true */ folder, `${randomUUID()}.${extension.replace(/[^a-z0-9]/gi, '')}`);
}

/** Resolves a stored relative path, refusing anything that would land outside the media root. */
export function absolutePath(relativePath) {
  const full = resolve(/* turbopackIgnore: true */ root(), relativePath);
  const inside = relative(root(), full);
  if (!inside || inside.startsWith('..') || inside.includes(`..${sep}`)) throw new Error('Path escapes media root');
  return full;
}

/** Write-then-rename, so a crash never leaves a half-written file under a real name. */
export async function writeFileAtomic(relativePath, data) {
  const full = absolutePath(relativePath);
  await mkdir(dirname(full), { recursive: true });
  const temp = `${full}.${randomUUID()}.tmp`;
  await writeFile(temp, data);
  await rename(temp, full);
  return full;
}

export async function removeFolder(relativeFolder) {
  await rm(absolutePath(relativeFolder), { recursive: true, force: true });
}

export async function removeUserMedia(userId) {
  await rm(absolutePath(safe(userId)), { recursive: true, force: true });
}

export async function removeFile(relativePath) {
  await rm(absolutePath(relativePath), { force: true });
}

export function usedBytes(userId) {
  return prepared('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM assets WHERE user_id = ?').get(userId).bytes;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Removes files no asset row points at: left by a crash between writing a file and recording it,
 * or by an interrupted download. Only files a day old, so nothing being written is touched — and
 * nothing at all when most files look orphaned, which means the wrong database, not litter.
 */
export async function sweepOrphanFiles({ now = Date.now() } = {}) {
  const base = root();
  let entries;
  try {
    entries = await readdir(base, { recursive: true, withFileTypes: true });
  } catch {
    return { removed: 0 };
  }
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(/* turbopackIgnore: true */ entry.parentPath, entry.name));
  const known = new Set(prepared('SELECT path FROM assets').all().map((row) => row.path));
  const orphans = [];
  for (const full of files) {
    if (known.has(relative(base, full))) continue;
    const info = await stat(full).catch(() => null);
    if (info && now - info.mtimeMs > DAY_MS) orphans.push(full);
  }
  if (orphans.length > 20 && orphans.length > files.length / 2) {
    console.warn(`[aurai] ${orphans.length} of ${files.length} media files have no database record; not removing them. Is DATA_DIR pointing at the right database?`);
    return { removed: 0, skipped: orphans.length };
  }
  for (const full of orphans) await rm(full, { force: true });
  if (orphans.length) console.info(`[aurai] removed ${orphans.length} media file(s) no longer in use`);
  return { removed: orphans.length };
}
