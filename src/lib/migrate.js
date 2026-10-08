import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const migrationsDir = /* turbopackIgnore: true */ join(process.cwd(), 'migrations');

// A migration that rebuilds a table (SQLite cannot alter constraints in place) starts with this
// line. Foreign keys are switched off around it — a PRAGMA that is ignored inside a transaction,
// so it has to happen out here — and checked before committing, per
// https://sqlite.org/lang_altertable.html#otheralter
const FOREIGN_KEYS_OFF = /^--\s*migrate:\s*foreign-keys-off\b/m;

/** Applies numbered .sql files in order, tracking progress in PRAGMA user_version. */
export function migrate(db, dir = migrationsDir) {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const from = db.pragma('user_version', { simple: true });

  for (let version = from; version < files.length; version += 1) {
    const sql = readFileSync(join(dir, files[version]), 'utf8');
    const rebuild = FOREIGN_KEYS_OFF.test(sql);
    if (rebuild) db.pragma('foreign_keys = OFF');

    db.exec('BEGIN');
    try {
      db.exec(sql);
      if (rebuild) {
        const broken = db.pragma('foreign_key_check');
        if (broken.length) throw new Error(`foreign key check failed: ${JSON.stringify(broken.slice(0, 3))}`);
      }
      // user_version cannot be parameterised, so the literal comes from the loop index.
      db.pragma(`user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${files[version]} failed: ${error.message}`, { cause: error });
    } finally {
      if (rebuild) db.pragma('foreign_keys = ON');
    }
  }
  return { from, to: Math.max(from, files.length), applied: files.slice(from) };
}
