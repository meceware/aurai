-- migrate: foreign-keys-off
-- Edit Image: a photo changed by a prompt, optionally only where the person painted. Its sessions
-- and first runs carry 'edit', and the painted area is kept as a file of its own ('mask'). A CHECK
-- constraint cannot be altered in SQLite, so the three tables are rebuilt.

CREATE TABLE image_sessions_new (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  title           TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'enhance' CHECK (mode IN ('enhance', 'colorize', 'repair', 'upscale', 'edit')),
  source_asset_id TEXT REFERENCES assets (id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  closed_at       INTEGER
);
INSERT INTO image_sessions_new (id, user_id, title, mode, source_asset_id, created_at, updated_at, closed_at)
SELECT id, user_id, title, mode, source_asset_id, created_at, updated_at, closed_at FROM image_sessions;
DROP TABLE image_sessions;
ALTER TABLE image_sessions_new RENAME TO image_sessions;
CREATE INDEX image_sessions_user_idx ON image_sessions (user_id, updated_at DESC);

CREATE TABLE image_runs_new (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  session_id      TEXT NOT NULL REFERENCES image_sessions (id) ON DELETE CASCADE,
  parent_run_id   TEXT REFERENCES image_runs (id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('enhance', 'colorize', 'repair', 'upscale', 'edit', 'followup', 'rerun')),
  model           TEXT NOT NULL,
  instruction     TEXT,
  compiled_prompt TEXT,
  analysis_json   TEXT,
  params_json     TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  lease_until     INTEGER,
  error           TEXT,
  input_asset_id  TEXT REFERENCES assets (id) ON DELETE SET NULL,
  ai_asset_id     TEXT REFERENCES assets (id) ON DELETE SET NULL,
  locked_asset_id TEXT REFERENCES assets (id) ON DELETE SET NULL,
  fidelity_json   TEXT,
  cost_usd        REAL,
  duration_ms     INTEGER,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER,
  model_cost_usd  REAL
);
INSERT INTO image_runs_new
  (id, user_id, session_id, parent_run_id, kind, model, instruction, compiled_prompt, analysis_json, params_json, status, lease_until, error,
   input_asset_id, ai_asset_id, locked_asset_id, fidelity_json, cost_usd, duration_ms, created_at, started_at, finished_at, model_cost_usd)
SELECT
  id, user_id, session_id, parent_run_id, kind, model, instruction, compiled_prompt, analysis_json, params_json, status, lease_until, error,
  input_asset_id, ai_asset_id, locked_asset_id, fidelity_json, cost_usd, duration_ms, created_at, started_at, finished_at, model_cost_usd
FROM image_runs;
DROP TABLE image_runs;
ALTER TABLE image_runs_new RENAME TO image_runs;
CREATE INDEX image_runs_session_idx ON image_runs (session_id, created_at);
CREATE INDEX image_runs_user_idx ON image_runs (user_id);
CREATE INDEX image_runs_active_idx ON image_runs (status, created_at) WHERE status IN ('queued', 'running');

CREATE TABLE assets_new (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  image_session_id TEXT REFERENCES image_sessions (id) ON DELETE CASCADE,
  video_session_id TEXT REFERENCES video_sessions (id) ON DELETE CASCADE,
  parent_asset_id  TEXT REFERENCES assets (id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('source', 'ai', 'locked', 'thumb', 'preview', 'frame', 'video', 'mask')),
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
