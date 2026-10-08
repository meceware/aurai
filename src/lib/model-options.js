import { imageModels, modelHints, TOP, visionModels } from './catalog.js';
import { costKey, runStats } from './model-stats.js';

// The models a person can choose from, described for choosing: what one run costs at the size it
// will be drawn at, how long it takes, and whether it has been failing. Everything comes from
// OpenRouter's catalog and from finished runs — no model is named in the code.

export const RESOLUTIONS = ['1K', '2K', '4K'];
const EDGE = { 512: 512, '1K': 1024, '1.5K': 1536, '2K': 2048, '4K': 4096 };
const MEGAPIXELS = { 512: 0.26, '1K': 1.05, '1.5K': 2.36, '2K': 4.19, '4K': 16.8 };
// A new account starts with this many of the week's most used models.
export const STARTER_MODELS = 5;
// An input photo is roughly this many tokens for models that bill input images per token.
const INPUT_IMAGE_TOKENS = 1100;

export const MODEL_ID = /^[\w.-]+\/[\w.:~-]+$/;

// Upscale's free option: the photo enlarged here, with nothing drawn by a model.
export const LOCAL_RESIZE = 'local/resize';
// What Upscale asks for: the most a model draws, and at least this, or it adds nothing.
const UPSCALE_MINIMUM = '2K';
export const edgeOf = (resolution) => EDGE[resolution] ?? null;
const shortName = (name, id) => String(name || id.split('/').pop()).replace(/^[^:]+:\s*/, '');
const provider = (id) => id.split('/')[0];

const supportedResolutions = (model) => model?._resolutions ?? model?.supported_parameters?.resolution?.values ?? null;
const ordered = (values) => (values ?? []).filter((value) => EDGE[value]).sort((a, b) => EDGE[a] - EDGE[b]);

/** Enough resolution for the photo, capped by the person's maximum. */
export function targetResolution(longEdge, maxResolution = '2K') {
  const needed = RESOLUTIONS.find((value) => EDGE[value] >= longEdge) ?? '4K';
  return EDGE[needed] <= EDGE[maxResolution] ? needed : maxResolution;
}

/**
 * The largest supported resolution not above the target (the smallest one if none is), raised to
 * any minimum the model has shown it needs by refusing smaller ones. Null for models without one.
 */
export function resolutionFor(model, target, hint = modelHints().get(model?.id)) {
  const supported = ordered(supportedResolutions(model));
  if (!supported.length) return null;
  let resolution = supported.filter((value) => EDGE[value] <= EDGE[target]).at(-1) ?? supported[0];
  const minimum = hint?.min_resolution;
  if (minimum && EDGE[resolution] < EDGE[minimum]) resolution = minimum;
  return resolution;
}

/** The next resolution up, for a model that refused the one it was asked for. */
export function largerResolution(model, resolution) {
  return ordered(supportedResolutions(model)).find((value) => EDGE[value] > EDGE[resolution]) ?? null;
}

/** Quality levels a model takes, e.g. ['auto', 'low', 'medium', 'high']; empty when it has none. */
export const qualitiesOf = (model) => model?.supported_parameters?.quality?.values ?? [];

/**
 * Estimated dollars for one edit. Runs that already happened at the same size and quality are
 * the best guide; then the published price, which is exact for models billed per image or per
 * megapixel. Models billed per token cannot be priced before they have run once.
 */
export function estimateCost(model, { resolution, quality, stats }) {
  const learned = stats?.costs;
  // Runs from before sizes were recorded were all asked for 1K.
  const exact = learned?.get(costKey(resolution, quality)) ?? (resolution === '1K' ? learned?.get(costKey(null, quality)) : null);
  if (exact) return { cost: exact.cost, approximate: false, basis: 'runs', runs: exact.runs };

  const pricing = model?._pricing ?? [];
  const outputs = pricing.filter((entry) => entry.billable === 'output_image');
  const size = resolution ?? '1K';
  const variant = outputs.find((entry) => String(entry.variant ?? '').toLowerCase() === size.toLowerCase());
  const output = variant ?? outputs.find((entry) => !entry.variant) ?? outputs[0];
  const input = pricing.find((entry) => entry.billable === 'input_image');
  const inputCost = !input ? 0 : input.unit === 'token' ? input.cost_usd * INPUT_IMAGE_TOKENS : input.unit === 'image' ? input.cost_usd : input.cost_usd * MEGAPIXELS['2K'];

  if (output?.unit === 'image') return { cost: output.cost_usd + inputCost, approximate: false, basis: 'price' };
  if (output?.unit === 'megapixel') return { cost: output.cost_usd * MEGAPIXELS[size] + inputCost, approximate: !resolution, basis: 'price' };

  // Billed per token: a run at another size is a rough guide; otherwise there is nothing to go on.
  const sameQuality = [...(learned ?? [])].filter(([key]) => key.endsWith(`|${quality ?? '-'}`));
  if (sameQuality.length) {
    const [, nearest] = sameQuality.sort((a, b) => b[1].runs - a[1].runs)[0];
    return { cost: nearest.cost, approximate: true, basis: 'runs', runs: nearest.runs };
  }
  return { cost: null, approximate: true, basis: output?.unit === 'token' ? 'tokens' : 'unknown' };
}

function caveatFor(stats, listed) {
  if (!listed) return 'No longer listed on OpenRouter';
  if (stats?.failures && stats.failures / stats.runs >= 0.2) return `Failed ${stats.failures} of its last ${stats.runs} runs`;
  return null;
}

/** One image model as the pickers show it. */
function describeImage(id, entry, { target, prefs, stats, hints }) {
  const model = entry ?? { id };
  const resolution = resolutionFor(model, target, hints.get(id));
  const qualities = qualitiesOf(model);
  const chosen = prefs.qualities?.[id];
  const quality = qualities.includes(chosen) ? chosen : null;
  const modelStats = stats.get(id);
  const estimate = estimateCost(model, { resolution, quality, stats: modelStats });
  const sizes = ordered(supportedResolutions(model));
  return {
    id,
    label: shortName(entry?.name, id),
    provider: provider(id),
    rank: entry?._rank ?? null,
    resolution,
    maxResolution: sizes.at(-1) ?? null,
    qualities,
    quality,
    ...estimate,
    seconds: modelStats?.seconds ?? null,
    caveat: caveatFor(modelStats, Boolean(entry)),
  };
}

function imageContext(prefs, target) {
  const catalog = imageModels();
  return { catalog, byId: new Map(catalog.map((model) => [model.id, model])), ctx: { target, prefs, stats: runStats(), hints: modelHints() } };
}

/** The week's most used models, for a new account. */
export const starterImageModels = () =>
  imageModels()
    .slice(0, STARTER_MODELS)
    .map((model) => model.id);
export const starterVisionModel = () => visionModels()[0]?.id ?? null;

/**
 * What Settings lists: the person's models (in their order), the week's most used ones they have
 * not picked, and every image editor for the "add a model" box.
 */
export function imageChoices(prefs) {
  const { catalog, byId, ctx } = imageContext(prefs, prefs.maxResolution);
  const enabled = new Set(prefs.enabledModels);
  return {
    selected: prefs.enabledModels.map((id) => describeImage(id, byId.get(id), ctx)),
    popular: catalog
      .slice(0, TOP)
      .filter((model) => !enabled.has(model.id))
      .map((model) => describeImage(model.id, model, ctx)),
    all: catalog.filter((model) => !enabled.has(model.id)).map((model) => ({ id: model.id, label: shortName(model.name, model.id) })),
  };
}

/**
 * What the composer offers for one photo: the person's models, priced at the size they will draw
 * it. Upscale asks each model for the most it draws, offers only models that draw at 2K or more,
 * and adds the free resize made here.
 */
export function imageOptionsFor(prefs, { longEdge, mode = 'enhance' }) {
  const upscale = mode === 'upscale';
  const { byId, ctx } = imageContext(prefs, upscale ? '4K' : targetResolution(longEdge, prefs.maxResolution));
  let options = prefs.enabledModels.map((id) => describeImage(id, byId.get(id), ctx));
  if (upscale) {
    options = options
      .filter((option) => EDGE[option.resolution] >= EDGE[UPSCALE_MINIMUM])
      .map((option) => (EDGE[option.resolution] <= longEdge ? { ...option, caveat: option.caveat ?? 'Draws no larger than your photo' } : option));
    options.push({
      id: LOCAL_RESIZE,
      label: 'Resize only',
      provider: 'made here, free',
      local: true,
      resolution: '4K',
      cost: 0,
      approximate: false,
      basis: 'free',
      seconds: null,
      caveat: longEdge >= EDGE['4K'] ? 'Your photo is already this large' : null,
      qualities: [],
      quality: null,
    });
  }
  // Labels worked out from reliable numbers, when there is more than one to compare.
  const lowest = (field) => {
    const known = options.filter((option) => !option.local && typeof option[field] === 'number' && !(field === 'cost' && option.approximate));
    return known.length > 1 ? known.reduce((best, option) => (option[field] < best[field] ? option : best)).id : null;
  };
  const cheapest = lowest('cost');
  const fastest = lowest('seconds');
  return options.map((option) => ({ ...option, badge: option.id === cheapest ? 'Cheapest' : option.id === fastest ? 'Fastest' : null }));
}

/** Display names for the models runs were made with. */
export function modelLabels(ids) {
  const byId = new Map(imageModels().map((model) => [model.id, model]));
  return Object.fromEntries([...new Set(ids)].map((id) => [id, id === LOCAL_RESIZE ? 'Resize only' : shortName(byId.get(id)?.name, id)]));
}

// One analysis is about 1.7k tokens in (prompt + a 1024 px image) and 0.35k out.
const analysisCost = (pricing) => (pricing ? Number(pricing.prompt) * 1700 + Number(pricing.completion) * 350 + Number(pricing.image ?? 0) : null);

function describeVision(id, entry) {
  return {
    id,
    label: shortName(entry?.name, id),
    provider: provider(id),
    rank: entry?._rank ?? null,
    cost: entry ? analysisCost(entry.pricing) : null,
    caveat: entry ? null : 'No longer listed on OpenRouter',
  };
}

export function visionChoices(prefs) {
  const catalog = visionModels();
  const byId = new Map(catalog.map((model) => [model.id, model]));
  const current = prefs.analysisModel;
  return {
    selected: current ? describeVision(current, byId.get(current)) : null,
    popular: catalog
      .filter((model) => model.id !== current)
      .slice(0, TOP)
      .map((model) => describeVision(model.id, model)),
    all: catalog.filter((model) => model.id !== current).map((model) => ({ id: model.id, label: shortName(model.name, model.id) })),
  };
}

/** Dollars for one analysis with the person's model, or 0 when analysis is off. */
export function analysisCostFor(prefs) {
  if (!prefs.analysis || !prefs.analysisModel) return 0;
  return describeVision(prefs.analysisModel, visionModels().find((model) => model.id === prefs.analysisModel)).cost ?? 0;
}
