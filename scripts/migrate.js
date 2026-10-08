import { databasePath } from '../src/lib/config.js';
import { getDb } from '../src/lib/db.js';
import { migrate } from '../src/lib/migrate.js';

const { from, to, applied } = migrate(getDb());
for (const name of applied) console.log(`Applied ${name}`);
console.log(from === to ? `Schema is up to date (version ${to}) at ${databasePath}` : `Migrated ${from} → ${to} at ${databasePath}`);
