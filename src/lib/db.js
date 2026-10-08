import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { databasePath } from './config.js';

function open() {
  // turbopackIgnore: the path is runtime configuration; without it the build tracer copies the
  // local data folder — database, photos and all — into the build output.
  mkdirSync(/* turbopackIgnore: true */ dirname(databasePath), { recursive: true });

  const database = new Database(/* turbopackIgnore: true */ databasePath);
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  return database;
}

/**
 * Opened on first use and cached on globalThis: the dev server's module reloads reuse one
 * handle, and instrumentation and route bundles (separate module instances) share it.
 * Deferring the open keeps `next build` from creating a stray database just by importing this.
 */
export function getDb() {
  globalThis.__auraiDb ??= open();
  return globalThis.__auraiDb;
}

const statements = (globalThis.__auraiStatements ??= new Map());

/** Prepared on first use, so importing a query module does not require the schema to exist yet. */
export function prepared(sql) {
  let statement = statements.get(sql);
  if (!statement) {
    statement = getDb().prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}

export function transaction(fn) {
  return getDb().transaction(fn)();
}
