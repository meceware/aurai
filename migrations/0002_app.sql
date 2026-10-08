-- Application schema. Every row hangs off a user, and everything a session produced hangs off
-- that session, so deleting either cascades through the database. Files on disk mirror the
-- same tree (media/<user>/<session>/), and are removed by the app after the delete commits.
-- Timestamps are milliseconds since the epoch.

CREATE TABLE user_settings (
  user_id            TEXT PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  openrouter_key_enc TEXT,
  key_last4          TEXT,
  prefs_json         TEXT NOT NULL DEFAULT '{}',
  prompts_json       TEXT NOT NULL DEFAULT '{}',
  updated_at         INTEGER NOT NULL
);

CREATE TABLE image_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  title           TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'enhance' CHECK (mode IN ('enhance', 'colorize')),
  source_asset_id TEXT REFERENCES assets (id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX image_sessions_user_idx ON image_sessions (user_id, updated_at DESC);

CREATE TABLE video_sessions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  title             TEXT NOT NULL,
  source_asset_id   TEXT REFERENCES assets (id) ON DELETE SET NULL,
  from_image_run_id TEXT REFERENCES image_runs (id) ON DELETE SET NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX video_sessions_user_idx ON video_sessions (user_id, updated_at DESC);

-- Every file the app stores. `path` is relative to the media directory and always generated
-- by the server. Derived files (thumbnails) point at their parent and go with it.
CREATE TABLE assets (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  image_session_id TEXT REFERENCES image_sessions (id) ON DELETE CASCADE,
  video_session_id TEXT REFERENCES video_sessions (id) ON DELETE CASCADE,
  parent_asset_id  TEXT REFERENCES assets (id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('source', 'ai', 'locked', 'thumb', 'frame', 'video')),
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
CREATE INDEX assets_user_idx ON assets (user_id);
CREATE INDEX assets_image_session_idx ON assets (image_session_id);
CREATE INDEX assets_video_session_idx ON assets (video_session_id);
CREATE INDEX assets_parent_idx ON assets (parent_asset_id);

CREATE TABLE image_runs (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  session_id      TEXT NOT NULL REFERENCES image_sessions (id) ON DELETE CASCADE,
  parent_run_id   TEXT REFERENCES image_runs (id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('enhance', 'colorize', 'followup', 'rerun')),
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
  finished_at     INTEGER
);
CREATE INDEX image_runs_session_idx ON image_runs (session_id, created_at);
CREATE INDEX image_runs_user_idx ON image_runs (user_id);
CREATE INDEX image_runs_active_idx ON image_runs (status, created_at) WHERE status IN ('queued', 'running');

CREATE TABLE video_jobs (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  session_id          TEXT NOT NULL REFERENCES video_sessions (id) ON DELETE CASCADE,
  parent_job_id       TEXT REFERENCES video_jobs (id) ON DELETE SET NULL,
  comparison_group_id TEXT,
  model               TEXT NOT NULL,
  preset              TEXT,
  instruction         TEXT,
  compiled_prompt     TEXT,
  params_json         TEXT NOT NULL DEFAULT '{}',
  frame_asset_id      TEXT REFERENCES assets (id) ON DELETE SET NULL,
  openrouter_id       TEXT,
  webhook_token       TEXT,
  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'submitting', 'pending', 'in_progress', 'downloading',
                                        'completed', 'failed', 'cancelled', 'expired', 'abandoned')),
  lease_until         INTEGER,
  poll_after          INTEGER,
  poll_count          INTEGER NOT NULL DEFAULT 0,
  error               TEXT,
  video_asset_id      TEXT REFERENCES assets (id) ON DELETE SET NULL,
  cost_usd            REAL,
  created_at          INTEGER NOT NULL,
  submitted_at        INTEGER,
  completed_at        INTEGER
);
CREATE INDEX video_jobs_session_idx ON video_jobs (session_id, created_at);
CREATE INDEX video_jobs_user_idx ON video_jobs (user_id);
CREATE INDEX video_jobs_active_idx ON video_jobs (status, poll_after)
  WHERE status IN ('queued', 'submitting', 'pending', 'in_progress', 'downloading');

CREATE TABLE model_catalog (
  kind       TEXT NOT NULL CHECK (kind IN ('image', 'video', 'vision')),
  model_id   TEXT NOT NULL,
  data_json  TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (kind, model_id)
);

-- Fixed-window counters for sign-in and generation limits.
CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
