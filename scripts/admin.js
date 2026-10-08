// Accounts, from the command line (signup is open, so this is how to remove one):
//   npm run admin -- users                      list every account
//   npm run admin -- delete someone@example.com --yes
// In Docker: docker exec aurai node scripts/admin.js users
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { databasePath, mediaDir } from './data-paths.js';

const [command, email, ...flags] = process.argv.slice(2);
const db = new Database(databasePath, { fileMustExist: true });
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const day = (time) => (time ? new Date(time).toISOString().slice(0, 10) : '-');

if (command === 'users') {
  const rows = db
    .prepare(
      `SELECT u.email, u.createdAt,
              (SELECT MAX(s.updatedAt) FROM session s WHERE s.userId = u.id) AS seen,
              (SELECT COUNT(*) FROM image_sessions i WHERE i.user_id = u.id) + (SELECT COUNT(*) FROM video_sessions v WHERE v.user_id = u.id) AS sessions,
              (SELECT COALESCE(SUM(a.bytes), 0) FROM assets a WHERE a.user_id = u.id) AS bytes
         FROM "user" u ORDER BY u.createdAt`,
    )
    .all();
  if (!rows.length) console.log('No accounts yet.');
  for (const row of rows) console.log(`${row.email.padEnd(40)} joined ${day(row.createdAt)}  last seen ${day(row.seen)}  ${String(row.sessions).padStart(4)} photos/videos  ${megabytes(row.bytes)}`);
} else if (command === 'delete' && email) {
  const user = db.prepare('SELECT id, email FROM "user" WHERE lower(email) = lower(?)').get(email);
  if (!user) {
    console.error(`No account for ${email}.`);
    process.exit(1);
  }
  if (!flags.includes('--yes')) {
    console.error(`This deletes ${user.email} with every photo, video and result in it. Run again with --yes to do it.`);
    process.exit(1);
  }
  // Everything the account owns goes with the row; the files go with its folder.
  db.prepare('DELETE FROM "user" WHERE id = ?').run(user.id);
  rmSync(join(mediaDir, user.id), { recursive: true, force: true });
  console.log(`Deleted ${user.email}.`);
} else {
  console.log('Usage: admin.js users | admin.js delete <email> --yes');
  process.exit(command ? 1 : 0);
}
db.close();
