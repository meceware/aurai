-- migrate: foreign-keys-off
-- Adds 'preview' (a display-size rendition the browser loads instead of a full-resolution file)
-- to the asset kinds. A CHECK constraint cannot be altered in SQLite, so the table is rebuilt.

CREATE TABLE assets_new (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  image_session_id TEXT REFERENCES image_sessions (id) ON DELETE CASCADE,
  video_session_id TEXT REFERENCES video_sessions (id) ON DELETE CASCADE,
  parent_asset_id  TEXT REFERENCES assets (id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('source', 'ai', 'locked', 'thumb', 'preview', 'frame', 'video')),
  mime             TEXT NOT NULL,
  path             TEXT NOT NULL UNIQUE,
  bytes            INTEGER NOT NULL,
  width            INTEGER,
  height           INTEGER,
  duration_s       REAL,
  meta_json        TEXT,
  created_at       INTEGER NOT NULL,
  CHECK ((image_session_id IS NULL) <> (video_session_id IS NULL))
);

INSERT INTO assets_new
  (id, user_id, image_session_id, video_session_id, parent_asset_id, kind, mime, path, bytes, width, height, duration_s, meta_json, created_at)
SELECT
  id, user_id, image_session_id, video_session_id, parent_asset_id, kind, mime, path, bytes, width, height, duration_s, meta_json, created_at
FROM assets;

DROP TABLE assets;
ALTER TABLE assets_new RENAME TO assets;

CREATE INDEX assets_user_idx ON assets (user_id);
CREATE INDEX assets_image_session_idx ON assets (image_session_id);
CREATE INDEX assets_video_session_idx ON assets (video_session_id);
CREATE INDEX assets_parent_idx ON assets (parent_asset_id);
