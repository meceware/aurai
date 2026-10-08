-- Video sessions belong to a tool: Animate (a photo made into clips) or Edit Video (a video
-- changed by a prompt). Everything made before this was animated.
ALTER TABLE video_sessions ADD COLUMN tool TEXT NOT NULL DEFAULT 'animate' CHECK (tool IN ('animate', 'edit'));

-- The catalog keeps the models that can edit a video as their own kind. A CHECK constraint
-- cannot be altered in SQLite, so the table is rebuilt; it is only a cache, refetched daily.
CREATE TABLE model_catalog_next (
  kind       TEXT NOT NULL CHECK (kind IN ('image', 'video', 'video-edit', 'vision')),
  model_id   TEXT NOT NULL,
  data_json  TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (kind, model_id)
);
INSERT INTO model_catalog_next (kind, model_id, data_json, fetched_at) SELECT kind, model_id, data_json, fetched_at FROM model_catalog;
DROP TABLE model_catalog;
ALTER TABLE model_catalog_next RENAME TO model_catalog;
