import { refreshIfStale } from './catalog.js';
import { getDb } from './db.js';
import { startImageRunner } from './jobs/image-runner.js';
import { startVideoRunner } from './jobs/video-runner.js';
import { migrate } from './migrate.js';
import { sweepRateLimits } from './rate-limit.js';
import { sweepOrphanFiles } from './storage.js';

/**
 * Brings the schema up to date and starts background work. Called from instrumentation at
 * server start, and again (cheaply) by request handlers that need the runner — which is also
 * how a dev server picks up new migrations and runner code without a restart.
 */
export function boot() {
  // Schema first: the housekeeping below reads tables a fresh database only has once migrated.
  // Production migrates once; development re-checks so a new migration file applies on the next request.
  if (!globalThis.__auraiMigrated || process.env.NODE_ENV !== 'production') {
    const { from, to } = migrate(getDb());
    if (from !== to) console.info(`[aurai] database migrated ${from} → ${to}`);
    globalThis.__auraiMigrated = true;
  }
  if (!globalThis.__auraiHousekeeping) {
    globalThis.__auraiHousekeeping = setInterval(sweepRateLimits, 6 * 60 * 60 * 1000);
    globalThis.__auraiHousekeeping.unref?.();
    sweepRateLimits();
    // Model catalogs refresh in the background, daily; pages only read the cache.
    globalThis.__auraiCatalogTimer = setInterval(refreshIfStale, 60 * 60 * 1000);
    globalThis.__auraiCatalogTimer.unref?.();
    // Media files left behind by a crash: a minute after start, then daily.
    const sweep = () => sweepOrphanFiles().catch((error) => console.warn(`[aurai] media sweep failed: ${error.message}`));
    setTimeout(sweep, 60 * 1000).unref?.();
    setInterval(sweep, 24 * 60 * 60 * 1000).unref?.();
  }
  refreshIfStale();
  return { imageRunner: startImageRunner(), videoRunner: startVideoRunner() };
}
