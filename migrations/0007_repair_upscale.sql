-- migrate: foreign-keys-off
-- Two more image tools, Repair and Upscale: their sessions carry the tool as `mode`, and a run
-- that starts from the original carries it as `kind`. A CHECK constraint cannot be altered in
-- SQLite, so both tables are rebuilt.

CREATE TABLE image_sessions_new (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  title           TEXT NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'enhance' CHECK (mode IN ('enhance', 'colorize', 'repair', 'upscale')),
  source_asset_id TEXT REFERENCES assets (id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
INSERT INTO image_sessions_new (id, user_id, title, mode, source_asset_id, created_at, updated_at)
SELECT id, user_id, title, mode, source_asset_id, created_at, updated_at FROM image_sessions;
DROP TABLE image_sessions;
ALTER TABLE image_sessions_new RENAME TO image_sessions;
CREATE INDEX image_sessions_user_idx ON image_sessions (user_id, updated_at DESC);

CREATE TABLE image_runs_new (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  session_id      TEXT NOT NULL REFERENCES image_sessions (id) ON DELETE CASCADE,
  parent_run_id   TEXT REFERENCES image_runs (id) ON DELETE SET NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('enhance', 'colorize', 'repair', 'upscale', 'followup', 'rerun')),
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
