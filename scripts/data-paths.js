import { join } from 'node:path';

// Where the data lives, as the app reads it (src/lib/config.js), for scripts that also run in the
// container, where the app's own source is not present.
export const dataDir = process.env.DATA_DIR || 'data';
export const databasePath = process.env.DATABASE_PATH || join(dataDir, 'aurai.db');
export const mediaDir = join(dataDir, 'media');
