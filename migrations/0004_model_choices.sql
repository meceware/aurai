-- Models are no longer a list in the code: everything about them comes from OpenRouter's catalog
-- and from runs that have happened.

-- What the image model itself cost, apart from the analysis, so past runs can price future ones.
-- Earlier runs only stored the total; it includes an analysis of a fraction of a cent.
ALTER TABLE image_runs ADD COLUMN model_cost_usd REAL;
UPDATE image_runs SET model_cost_usd = cost_usd WHERE status = 'succeeded' AND cost_usd > 0;

-- Facts learned from requests, such as a model refusing a resolution its catalog entry lists.
CREATE TABLE model_hints (
  model_id       TEXT PRIMARY KEY,
  min_resolution TEXT,
  updated_at     INTEGER NOT NULL
);

-- Preferences used short names for a built-in model list; they become OpenRouter model ids.
-- (Both GPT Image 2 entries map to the one model; quality is now a per-model setting.)
UPDATE user_settings
SET prefs_json = replace(replace(replace(replace(replace(prefs_json,
  '"nano-banana-pro"', '"google/gemini-3-pro-image"'),
  '"gpt-image-2-high"', '"openai/gpt-image-2"'),
  '"gpt-image-2"', '"openai/gpt-image-2"'),
  '"nano-banana-2"', '"google/gemini-3.1-flash-image"'),
  '"seedream-4.5"', '"bytedance-seed/seedream-4.5"')
WHERE prefs_json IS NOT NULL;
