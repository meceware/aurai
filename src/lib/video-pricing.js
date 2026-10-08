// What a video model can do and what one clip costs, worked out from the fields OpenRouter's
// video catalog publishes for every model. Pure functions: the composer runs them in the browser
// so the price follows the settings as they change. No model is named here.

export const LOCAL_MOTION = 'local/ken-burns';

// Short side in pixels, to order sizes and to render local clips.
export const SHORT_SIDE = { '480p': 480, '720p': 720, '768p': 768, '1K': 1024, '1080p': 1080, '2K': 1440, '4K': 2160 };
export const VIDEO_TARGETS = ['720p', '1080p', '2K', '4K'];
export const DURATIONS = [4, 5, 6, 8, 10];

const bySize = (values) => (values ?? []).filter((value) => SHORT_SIDE[value]).sort((a, b) => SHORT_SIDE[a] - SHORT_SIDE[b]);
const normalizeSize = (raw) => {
  if (!raw) return null;
  const value = raw.toLowerCase();
  if (/^\d+p$/.test(value)) return value;
  if (/^\d+k$/.test(value)) return value.toUpperCase();
  return null;
};

/**
 * The largest size the model makes that is not above the target — allowing a near size just over
 * it (768p for 720p) rather than dropping a whole step — or its smallest if none fits.
 */
export function videoResolutionFor(profile, target) {
  const sizes = bySize(profile.resolutions);
  if (!sizes.length) return null;
  return sizes.filter((size) => SHORT_SIDE[size] <= SHORT_SIDE[target] * 1.1).at(-1) ?? sizes[0];
}

/** The supported length nearest to the one asked for (the shorter one on a tie). */
export function durationFor(profile, target) {
  const options = [...(profile.durations ?? [])].map(Number).filter((value) => value > 0).sort((a, b) => a - b);
  if (!options.length) return target;
  return options.reduce((best, value) => (Math.abs(value - target) < Math.abs(best - target) ? value : best));
}

const parseRatio = (ratio) => {
  const [w, h] = String(ratio).split(':').map(Number);
  return w > 0 && h > 0 ? { ratio, w, h } : null;
};

/**
 * The model's aspect ratio closest to the photo's, keeping its orientation: a portrait photo
 * becomes a portrait video, never a landscape one cut out of it.
 */
export function aspectFor(ratios, width, height) {
  const parsed = (ratios ?? []).map(parseRatio).filter(Boolean);
  if (!parsed.length) return null;
  const photo = width / height;
  const sameShape = parsed.filter(({ w, h }) => (photo > 1.05 ? w > h : photo < 0.95 ? h > w : w === h));
  const pool = sameShape.length ? sameShape : parsed;
  return pool.reduce((best, option) => (Math.abs(Math.log(option.w / option.h / photo)) < Math.abs(Math.log(best.w / best.h / photo)) ? option : best)).ratio;
}

/**
 * Pricing SKUs as rules: `{ rate, size, audio }` per second of video (dollars), plus a fixed
 * charge per clip, a minimum, and whether the model bills per token instead. Text-to-video,
 * reference and continuation prices do not apply to animating a photo and are skipped.
 */
export function parsePricing(skus) {
  const pricing = { rates: [], fixed: 0, minimum: 0, tokens: false };
  for (const [key, raw] of Object.entries(skus ?? {})) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const dollars = /(^|_)cents_/.test(key) ? value / 100 : value;
    if (/text_to_video|reference|continuation|megapixel|video_input/.test(key)) continue;
    if (key.startsWith('video_tokens')) {
      pricing.tokens = true;
      continue;
    }
    if (/minimum/.test(key)) {
      pricing.minimum = dollars;
      continue;
    }
    if (/image_input/.test(key)) {
      pricing.fixed += dollars;
      continue;
    }
    if (!/second/.test(key)) continue;
    const audio = /_with_audio/.test(key) ? true : /_without_audio/.test(key) ? false : null;
    const size = normalizeSize(key.match(/_(\d+[pk])$/i)?.[1]);
    pricing.rates.push({ rate: dollars, size, audio });
  }
  return pricing;
}

/** The per-second rate that applies, and whether it is only near the real one. */
function rateFor(pricing, size, audio) {
  const fits = (rule) => rule.audio === audio || rule.audio === null;
  const tiers = [
    (rule) => rule.size === size && rule.audio === audio,
    (rule) => rule.size === size && rule.audio === null,
    (rule) => rule.size === null && rule.audio === audio,
    (rule) => rule.size === null && rule.audio === null,
  ];
  for (const tier of tiers) {
    const rule = pricing.rates.find(tier);
    if (rule) return { rate: rule.rate, approximate: false };
  }
  const near = pricing.rates.filter(fits).sort((a, b) => Math.abs((SHORT_SIDE[a.size] ?? 1080) - SHORT_SIDE[size]) - Math.abs((SHORT_SIDE[b.size] ?? 1080) - SHORT_SIDE[size]))[0];
  return near ? { rate: near.rate, approximate: true } : null;
}

const learnedKey = (size, audio) => `${size ?? '-'}|${audio ? 'audio' : '-'}`;

/**
 * Dollars for one clip: from earlier clips of this model at this size when there are any (the
 * only way to price models billed per token), else from the published price.
 */
export function estimateVideo(profile, { resolution, duration, audio }) {
  if (profile.local) return { cost: 0, approximate: false, basis: 'free' };
  const learned = new Map(profile.learned ?? []);
  const exact = learned.get(learnedKey(resolution, audio));
  if (exact) return { cost: exact.cost * duration, approximate: false, basis: 'runs', runs: exact.runs };

  const pricing = profile.pricing ?? { rates: [] };
  const found = rateFor(pricing, resolution, audio);
  if (found && !pricing.tokens) {
    return { cost: Math.max(pricing.minimum, found.rate * duration + pricing.fixed), approximate: found.approximate, basis: 'price' };
  }
  const other = [...learned].find(([key]) => key.endsWith(audio ? '|audio' : '|-'));
  if (other) return { cost: other[1].cost * duration, approximate: true, basis: 'runs', runs: other[1].runs };
  return { cost: null, approximate: true, basis: pricing.tokens ? 'tokens' : 'unknown' };
}

/** Everything one clip will be made with, for a model and the composer's settings. */
export function planClip(profile, { target, duration, audio, width, height }) {
  const resolution = profile.local ? target : videoResolutionFor(profile, target);
  const length = profile.local ? duration : durationFor(profile, duration);
  const withAudio = Boolean(audio && profile.audio);
  return {
    resolution,
    duration: length,
    audio: withAudio,
    aspect: profile.local ? aspectFor(['16:9', '9:16', '4:3', '3:4', '1:1'], width, height) : aspectFor(profile.aspectRatios, width, height),
    ...estimateVideo(profile, { resolution, duration: length, audio: withAudio }),
  };
}
