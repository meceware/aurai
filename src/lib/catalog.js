import { prepared, transaction } from './db.js';
import { createClient } from './openrouter/client.js';

// OpenRouter's public catalogs, cached in SQLite and refreshed daily in the background:
// - image models that accept an input photo, ranked by this week's usage, with exact pricing
//   (per image, per megapixel or per token) for the most used ones and for any model someone chose;
// - vision models that support structured output (for the analysis step), ranked the same way;
// - video models that can start from a photo (a first frame), ranked the same way;
// - video models that take a video in, to change it by a prompt (Edit Video), ranked the same way.
// Pages only ever read the cache, so a slow or unreachable OpenRouter never slows them down.
// No model is named in the code: what is offered, and the defaults, come from here.

const TTL = 24 * 60 * 60 * 1000;
export const TOP = 15;

const rankedIds = async (client, query) => (await client.models(`${query}&sort=top-weekly`)).data.map((model) => model.id);

/** Every model id someone has picked, so their prices stay current even when they drop out of the top. */
function chosenIds() {
  const rows = prepared(
    `SELECT DISTINCT value AS id FROM user_settings, json_each(user_settings.prefs_json, '$.enabledModels')
     WHERE json_valid(user_settings.prefs_json)`,
  ).all();
  return rows.map((row) => row.id).filter((id) => typeof id === 'string');
}

async function price(client, model) {
  try {
    const { endpoints } = await client.imageModelEndpoints(model.id);
    const primary = endpoints?.[0];
    model._pricing = primary?.pricing ?? [];
    model._resolutions = primary?.supported_parameters?.resolution?.values ?? null;
  } catch {
    model._pricing = null;
  }
  return model;
}

export async function refreshCatalogs() {
  const client = createClient();
  const [images, imageRanking, vision, videos, videoListing] = await Promise.all([
    client.imageModels(),
    rankedIds(client, '?output_modalities=image'),
    client.models('?input_modalities=image&output_modalities=text&sort=top-weekly'),
    client.videoModels(),
    client.models('?output_modalities=video&sort=top-weekly'),
  ]);
  const videoRanking = videoListing.data.map((model) => model.id);
  // The video catalog does not say what a model takes in; the general model list does.
  const takesVideo = new Set(videoListing.data.filter((model) => model.architecture?.input_modalities?.includes('video')).map((model) => model.id));
  const rank = new Map(imageRanking.map((id, index) => [id, index]));
  // OpenRouter has no usage ranking for some kinds and then lists them by vendor name; newest
  // first says more than the alphabet.
  const byVendor = (ids) => ids.every((id, index) => index === 0 || ids[index - 1].split('/')[0] <= id.split('/')[0]);
  const videoRankBy = byVendor(videoRanking) ? 'newest' : 'usage';
  const videoOrder = videoRankBy === 'usage' ? videoRanking : [...videos.data].sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).map((model) => model.id);
  const videoRank = new Map(videoOrder.map((id, index) => [id, index]));

  const editors = images.data
    .filter((model) => (model.supported_parameters?.input_references?.max ?? 0) > 0)
    .map((model) => ({ ...model, _rank: rank.get(model.id) ?? 999 }))
    .sort((a, b) => a._rank - b._rank);

  // Exact pricing for what people will see: the most used models, plus every chosen one.
  const priced = new Set([...editors.slice(0, TOP).map((m) => m.id), ...chosenIds()]);
  await Promise.all(editors.filter((model) => priced.has(model.id)).map((model) => price(client, model)));

  const visionModels = vision.data
    .filter((model) => (model.supported_parameters ?? []).includes('structured_outputs'))
    .map((model, index) => ({ id: model.id, name: model.name, pricing: model.pricing, context_length: model.context_length, _rank: index }));

  // Animating a photo needs a model that starts from a given first frame.
  const animators = videos.data
    .filter((model) => model.supported_frame_images?.includes('first_frame') && model.supported_durations?.length && model.supported_resolutions?.length)
    .map((model) => ({ ...model, _rank: videoRank.get(model.id) ?? 999, _rankBy: videoRankBy }))
    .sort((a, b) => a._rank - b._rank);
  // Extra settings (a negative prompt) are addressed to the provider serving the model, by its slug.
  await Promise.all(
    animators
      .filter((model) => model.allowed_passthrough_parameters?.length)
      .map(async (model) => {
        try {
          model._providers = (await client.modelEndpoints(model.id)).data?.endpoints?.map((endpoint) => endpoint.tag).filter(Boolean) ?? [];
        } catch {
          model._providers = [];
        }
      }),
  );

  // Editing a video needs a model that takes one in.
  const videoEditors = videos.data
    .filter((model) => takesVideo.has(model.id))
    .map((model) => ({ ...model, _rank: videoRank.get(model.id) ?? 999, _rankBy: videoRankBy }))
    .sort((a, b) => a._rank - b._rank);

  const now = Date.now();
  transaction(() => {
    prepared("DELETE FROM model_catalog WHERE kind IN ('image', 'vision', 'video', 'video-edit')").run();
    const insert = prepared('INSERT INTO model_catalog (kind, model_id, data_json, fetched_at) VALUES (?, ?, ?, ?)');
    for (const model of editors) insert.run('image', model.id, JSON.stringify(model), now);
    for (const model of visionModels) insert.run('vision', model.id, JSON.stringify(model), now);
    for (const model of animators) insert.run('video', model.id, JSON.stringify(model), now);
    for (const model of videoEditors) insert.run('video-edit', model.id, JSON.stringify(model), now);
  });
  return { images: editors.length, vision: visionModels.length, video: animators.length, videoEdit: videoEditors.length };
}

function read(kind) {
  return prepared('SELECT data_json, fetched_at FROM model_catalog WHERE kind = ?')
    .all(kind)
    .map((row) => ({ ...JSON.parse(row.data_json), _fetchedAt: row.fetched_at }))
    .sort((a, b) => (a._rank ?? 999) - (b._rank ?? 999));
}

/** When the catalogs were last fetched; null when any is missing (e.g. a cache from an older version). */
export function catalogUpdatedAt() {
  const row = prepared("SELECT COUNT(DISTINCT kind) AS kinds, MIN(fetched_at) AS at FROM model_catalog WHERE kind IN ('image', 'vision', 'video')").get();
  return row?.kinds === 3 ? row.at : null;
}

/**
 * Starts a refresh when the cache is missing or a day old — or, with `kind`, has none of that
 * kind (a cache from before it existed), at most every few minutes. Never waits for it.
 */
export function refreshIfStale(kind = null) {
  const updated = catalogUpdatedAt();
  const missing = kind && !prepared('SELECT 1 FROM model_catalog WHERE kind = ?').get(kind) && Date.now() - (updated ?? 0) > 5 * 60 * 1000;
  if (updated && Date.now() - updated < TTL && !missing) return;
  if (globalThis.__auraiCatalogRefresh) return;
  globalThis.__auraiCatalogRefresh = refreshCatalogs()
    .catch((error) => console.warn(`[aurai] model catalog refresh failed: ${error.message}`))
    .finally(() => {
      globalThis.__auraiCatalogRefresh = null;
    });
}

export const imageModels = () => read('image');
export const visionModels = () => read('vision');
export const videoModels = () => read('video');
export const videoEditModels = () => read('video-edit');

/** By id, for the request builder. Waits for a first refresh when the cache is empty. */
export async function imageCatalog() {
  let rows = read('image');
  if (!rows.length) {
    try {
      await refreshCatalogs();
      rows = read('image');
    } catch (error) {
      console.warn(`[aurai] image catalog unavailable: ${error.message}`);
    }
  } else {
    refreshIfStale();
  }
  return new Map(rows.map((model) => [model.id, model]));
}

const one = (kind, id) => {
  const row = prepared('SELECT data_json FROM model_catalog WHERE kind = ? AND model_id = ?').get(kind, id);
  return row ? JSON.parse(row.data_json) : null;
};

/**
 * A model someone typed in: looked up in the cache, and when it is not there (a model released
 * since the last refresh) after one fresh fetch. Image models get their exact pricing on the way.
 */
export async function findModel(kind, id) {
  let model = one(kind, id);
  // A typo should not refetch everything each time: at most one fresh look every few minutes.
  if (!model && Date.now() - (catalogUpdatedAt() ?? 0) > 5 * 60 * 1000) {
    await (globalThis.__auraiCatalogRefresh ?? refreshCatalogs());
    model = one(kind, id);
  }
  if (model && kind === 'image' && !model._pricing) {
    await price(createClient(), model);
    prepared("UPDATE model_catalog SET data_json = ? WHERE kind = 'image' AND model_id = ?").run(JSON.stringify(model), id);
  }
  return model;
}

export const isListed = (kind, id) => Boolean(prepared('SELECT 1 FROM model_catalog WHERE kind = ? AND model_id = ?').get(kind, id));

/** What requests have taught us about each model, by id. */
export function modelHints() {
  return new Map(prepared('SELECT model_id, min_resolution, no_passthrough FROM model_hints').all().map((row) => [row.model_id, row]));
}

export const videoModel = (id) => one('video', id) ?? one('video-edit', id);

export function learnMinimumResolution(modelId, resolution) {
  prepared(
    `INSERT INTO model_hints (model_id, min_resolution, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(model_id) DO UPDATE SET min_resolution = excluded.min_resolution, updated_at = excluded.updated_at`,
  ).run(modelId, resolution, Date.now());
}

export function learnNoPassthrough(modelId) {
  prepared(
    `INSERT INTO model_hints (model_id, no_passthrough, updated_at) VALUES (?, 1, ?)
     ON CONFLICT(model_id) DO UPDATE SET no_passthrough = 1, updated_at = excluded.updated_at`,
  ).run(modelId, Date.now());
}
