-- Learned when a model's provider rejects the extra settings (such as a negative prompt) its
-- catalog entry says it takes; those requests then go without them.
ALTER TABLE model_hints ADD COLUMN no_passthrough INTEGER NOT NULL DEFAULT 0;
