import { z } from 'zod';
import { prepared } from './db.js';
import { MODEL_ID, starterImageModels, starterVisionModel } from './model-options.js';
import { starterEditModels, starterVideoModels } from './video-options.js';
import { DURATIONS, VIDEO_TARGETS } from './video-pricing.js';
import { DEFAULT_PROMPTS, ANALYSIS_PROMPT, EDIT_AREA_PROMPT, MOTION_PRESETS, REPAIR_FOLLOWUP_PROMPT, VIDEO_EDIT_PROMPT, VIDEO_NEGATIVE_PROMPT } from './prompts/defaults.js';

// A person's defaults. Stored as JSON so new settings need no migration; read through this
// schema so stored values from older versions (or hand edits) can never break a run.

// An OpenRouter model id, "vendor/model".
const modelId = z.string().regex(MODEL_ID).max(120);

export const prefsSchema = z.object({
  // The models offered in the composer, in order. Empty means "not chosen yet".
  enabledModels: z.array(z.string().max(120)).max(30).catch([]),
  enhanceModel: modelId.nullable().catch(null),
  colorizeModel: modelId.nullable().catch(null),
  repairModel: modelId.nullable().catch(null),
  upscaleModel: modelId.nullable().catch(null),
  // Edit Image's (not Edit Video's: those are `editModels`, video models).
  editModel: modelId.nullable().catch(null),
  // Per model, for models that take a quality level; unset leaves it to the model.
  qualities: z.record(z.string(), z.enum(['auto', 'low', 'medium', 'high'])).catch({}),
  // The AI redraw matches the photo's size up to this; Local results are always full size.
  maxResolution: z.enum(['1K', '2K', '4K']).catch('2K'),
  analysis: z.boolean().catch(true),
  analysisModel: modelId.nullable().catch(null),
  lock: z.enum(['local', 'global']).catch('local'),
  downloadFormat: z.enum(['jpeg', 'png']).catch('jpeg'),
  jpegQuality: z.enum(['max', 'high', 'medium', 'small']).catch('max'),
  // Ask before starting anything estimated above this many dollars. 0 means never ask.
  confirmAbove: z.number().min(0).max(100).catch(0.25),
  // Video: the models offered when animating a photo, and what a new clip starts with.
  videoModels: z.array(z.string().max(120)).max(30).catch([]),
  videoModel: z.string().max(120).nullable().catch(null),
  videoResolution: z.enum(VIDEO_TARGETS).catch('720p'),
  videoDuration: z.number().int().min(1).max(30).catch(5),
  videoPreset: z.string().max(40).catch('parallax-in'),
  videoAudio: z.boolean().catch(false),
  // Experimental: also give the model the last frame (the photo, zoomed in), so the camera has
  // to end on the real photo instead of wherever it drifts.
  videoAnchor: z.boolean().catch(false),
  // What the last clip was made with, so Animate opens on it again.
  lastVideo: z
    .object({
      models: z.array(z.string().max(160)).max(4),
      preset: z.string().max(40),
      resolution: z.enum(VIDEO_TARGETS),
      duration: z.number().int().min(1).max(30),
      audio: z.boolean(),
    })
    .nullable()
    .catch(null),
  // Edit Video: the models offered when changing a video.
  editModels: z.array(z.string().max(120)).max(30).catch([]),
  // What the last edit was made with, so Edit Video opens on it again.
  lastEdit: z
    .object({
      models: z.array(z.string().max(160)).max(4),
      resolution: z.enum(VIDEO_TARGETS),
    })
    .nullable()
    .catch(null),
});

export const DEFAULT_PREFS = prefsSchema.parse({});

/**
 * Model choices made whole: valid ids only, no repeats, the defaults among the enabled models,
 * and — for an account that has not chosen yet — the week's most used models from the catalog.
 */
function normalize(prefs) {
  const valid = [...new Set(prefs.enabledModels.filter((id) => MODEL_ID.test(id)))];
  const enabled = valid.length ? valid : starterImageModels();
  const first = enabled[0] ?? null;
  return {
    ...prefs,
    enabledModels: enabled,
    enhanceModel: enabled.includes(prefs.enhanceModel) ? prefs.enhanceModel : first,
    colorizeModel: enabled.includes(prefs.colorizeModel) ? prefs.colorizeModel : first,
    repairModel: enabled.includes(prefs.repairModel) ? prefs.repairModel : first,
    // Upscale offers only models that draw at 2K or more; the composer falls back among those.
    upscaleModel: enabled.includes(prefs.upscaleModel) ? prefs.upscaleModel : first,
    editModel: enabled.includes(prefs.editModel) ? prefs.editModel : first,
    qualities: Object.fromEntries(Object.entries(prefs.qualities).filter(([id]) => enabled.includes(id))),
    analysisModel: prefs.analysisModel ?? starterVisionModel(),
    ...normalizeVideo(prefs),
  };
}

function normalizeVideo(prefs) {
  const valid = [...new Set(prefs.videoModels.filter((id) => MODEL_ID.test(id)))];
  const enabled = valid.length ? valid : starterVideoModels();
  const edits = [...new Set(prefs.editModels.filter((id) => MODEL_ID.test(id)))];
  return {
    videoModels: enabled,
    editModels: edits.length ? edits : starterEditModels(),
    videoModel: enabled.includes(prefs.videoModel) ? prefs.videoModel : (enabled[0] ?? null),
    videoDuration: DURATIONS.includes(prefs.videoDuration) ? prefs.videoDuration : 5,
    videoPreset: Object.hasOwn(MOTION_PRESETS, prefs.videoPreset) ? prefs.videoPreset : 'parallax-in',
  };
}

// The editable prompts, what each is for, and the placeholders it understands.
export const PROMPTS = {
  enhance: {
    label: 'Enhance',
    description: 'Sent with the photo when you press Enhance.',
    placeholders: ['stats', 'analysis', 'instruction'],
    default: DEFAULT_PROMPTS.enhance,
  },
  colorize: {
    label: 'Colorize',
    description: 'Sent with the photo when you press Colorize.',
    placeholders: ['stats', 'analysis', 'instruction'],
    default: DEFAULT_PROMPTS.colorize,
  },
  followup: {
    label: 'Refine',
    description: 'Sent with the result you are refining. Must include {{instruction}}.',
    placeholders: ['instruction'],
    required: ['instruction'],
    default: DEFAULT_PROMPTS.followup,
  },
  repair: {
    label: 'Repair',
    description: 'Sent with the photo when you press Repair.',
    placeholders: ['instruction'],
    default: DEFAULT_PROMPTS.repair,
  },
  'repair-refine': {
    label: 'Repair · Refine',
    description: 'Sent with the repaired result you are refining. Must include {{instruction}}.',
    placeholders: ['instruction'],
    required: ['instruction'],
    default: REPAIR_FOLLOWUP_PROMPT,
  },
  upscale: {
    label: 'Upscale',
    description: 'Sent with the photo when you press Upscale.',
    placeholders: ['instruction'],
    default: DEFAULT_PROMPTS.upscale,
  },
  edit: {
    label: 'Edit Image',
    description: 'Sent with the photo when you edit it without painting. Must include {{instruction}}, which is where your words go.',
    placeholders: ['instruction'],
    required: ['instruction'],
    default: DEFAULT_PROMPTS.edit,
  },
  'edit-area': {
    label: 'Edit Image · Painted area',
    description: 'Sent with the photo, the area you painted tinted red, when you edit only part of it. Must include {{instruction}}.',
    placeholders: ['instruction'],
    required: ['instruction'],
    default: EDIT_AREA_PROMPT,
  },
  analysis: {
    label: 'Analysis',
    description: 'Asks the vision model what is wrong with the colors, before each Enhance or Colorize.',
    placeholders: ['stats'],
    default: ANALYSIS_PROMPT,
  },
  ...Object.fromEntries(
    Object.entries(MOTION_PRESETS).map(([key, preset]) => [
      `motion-${key}`,
      {
        label: `Motion · ${preset.label}`,
        description: 'Sent with the photo when you animate it with this motion. {{instruction}} is where your own words for a clip go.',
        placeholders: ['instruction'],
        default: preset.prompt,
      },
    ]),
  ),
  'video-edit': {
    label: 'Edit Video',
    description: 'Sent with the video when you edit it. Must include {{instruction}}, which is where your words go.',
    placeholders: ['instruction'],
    required: ['instruction'],
    default: VIDEO_EDIT_PROMPT,
  },
  avoid: {
    label: 'Motion · Negative prompt',
    description: 'Sent on its own, as a negative prompt, to the video models that take one. Never added to the prompt itself: naming what should not happen tends to make a model do it.',
    placeholders: [],
    default: VIDEO_NEGATIVE_PROMPT,
  },
};

const MAX_PROMPT = 6000;

function row(userId) {
  return prepared('SELECT prefs_json, prompts_json FROM user_settings WHERE user_id = ?').get(userId);
}

function ensure(userId) {
  prepared('INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING').run(userId, Date.now());
}

const parse = (json) => {
  try {
    return JSON.parse(json ?? '{}') ?? {};
  } catch {
    return {};
  }
};

function write(userId, prefs) {
  ensure(userId);
  prepared('UPDATE user_settings SET prefs_json = ?, updated_at = ? WHERE user_id = ?').run(JSON.stringify(prefs), Date.now(), userId);
}

export function getPrefs(userId) {
  const stored = parse(row(userId)?.prefs_json);
  const prefs = normalize(prefsSchema.parse(stored));
  // Starter models are written down the first time they are worked out, so a new account's
  // choices stay put instead of following each week's ranking. Only then: a stored choice this
  // code cannot read is left alone rather than overwritten.
  // (Edit Video's only once the catalog has any, so an older cache does not mean a write each time.)
  const unchosen = !stored.enabledModels?.length || !stored.analysisModel || !stored.videoModels?.length || (!stored.editModels?.length && prefs.editModels.length > 0);
  if (unchosen && prefs.enabledModels.length && prefs.analysisModel && prefs.videoModels.length) write(userId, prefs);
  return prefs;
}

/** Validates and stores a partial update; unknown keys are ignored. */
export function savePrefs(userId, patch) {
  const next = normalize(prefsSchema.parse({ ...getPrefs(userId), ...prefsSchema.partial().strip().parse(patch) }));
  write(userId, next);
  return next;
}

/** The person's own version of each prompt, or the default where they have none. */
export function getPrompts(userId) {
  const custom = parse(row(userId)?.prompts_json);
  return Object.fromEntries(
    Object.entries(PROMPTS).map(([key, prompt]) => {
      const text = typeof custom[key] === 'string' && custom[key].trim() ? custom[key] : null;
      return [key, { text: text ?? prompt.default, custom: Boolean(text) }];
    }),
  );
}

export function promptProblem(key, text) {
  const prompt = PROMPTS[key];
  if (!prompt) return 'Unknown prompt.';
  if (text.length > MAX_PROMPT) return `Keep the prompt under ${MAX_PROMPT} characters.`;
  if (!text.trim()) return 'The prompt cannot be empty. Use "Reset to default" instead.';
  for (const name of prompt.required ?? []) {
    if (!text.includes(`{{${name}}}`)) return `This prompt needs {{${name}}} — that is where your request goes.`;
  }
  const unknown = [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).filter((name) => !prompt.placeholders.includes(name));
  if (unknown.length) return `Unknown placeholder {{${unknown[0]}}}. This prompt understands ${prompt.placeholders.map((p) => `{{${p}}}`).join(', ')}.`;
  return null;
}

/** Stores a custom prompt, or with `text === null` goes back to the default. */
export function savePrompt(userId, key, text) {
  ensure(userId);
  const custom = parse(row(userId)?.prompts_json);
  if (text === null) delete custom[key];
  else custom[key] = text;
  prepared('UPDATE user_settings SET prompts_json = ?, updated_at = ? WHERE user_id = ?').run(JSON.stringify(custom), Date.now(), userId);
}
