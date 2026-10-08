// A consistent copy of the database, while the app runs:
//   npm run backup                              (development)
//   docker exec aurai node scripts/backup.js    (Docker)
// It goes to data/backups and the last 14 are kept. Photos and videos are plain files in
// data/media: back up the whole data folder after running this, and you have everything.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { databasePath, dataDir } from './data-paths.js';

const KEEP = 14;
const directory = join(dataDir, 'backups');
mkdirSync(directory, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = join(directory, `aurai-${stamp}.db`);

// SQLite's online backup, not a file copy: the latest changes may still be in the -wal file,
// so a copy of the .db alone would be silently behind.
const db = new Database(databasePath, { fileMustExist: true });
await db.backup(target);
db.close();
console.log(`Wrote ${target}`);

const stale = readdirSync(directory)
  .filter((name) => name.startsWith('aurai-') && name.endsWith('.db'))
  .sort()
  .slice(0, -KEEP);
for (const name of stale) {
  rmSync(join(directory, name));
  console.log(`Removed ${name}`);
}
