import { TOP, videoEditModels, videoModels } from './catalog.js';
import { videoStats } from './model-stats.js';
import { durationFor, estimateVideo, LOCAL_MOTION, parsePricing, videoResolutionFor } from './video-pricing.js';

// The video models a person can choose from, as "profiles": what each can do and the raw
// ingredients of its price, so the composer can work out a clip's size, length and cost for
// whatever is picked. Everything comes from OpenRouter's catalog and from finished jobs.

// A new account starts with this many of the top video models (most used, or newest).
export const STARTER_VIDEO_MODELS = 4;

const shortName = (name, id) => String(name || id.split('/').pop()).replace(/^[^:]+:\s*/, '');
const provider = (id) => id.split('/')[0];

function caveatFor(stats, listed) {
  if (!listed) return 'No longer listed on OpenRouter';
  if (stats?.failures && stats.failures / stats.runs >= 0.2) return `Failed ${stats.failures} of its last ${stats.runs} jobs`;
  return null;
}

function profileOf(id, entry, stats) {
  const modelStats = stats.get(id);
  return {
    id,
    label: shortName(entry?.name, id),
    provider: provider(id),
    rank: entry?._rank ?? null,
    resolutions: entry?.supported_resolutions ?? [],
    durations: entry?.supported_durations ?? [],
    aspectRatios: entry?.supported_aspect_ratios ?? [],
    lastFrame: Boolean(entry?.supported_frame_images?.includes('last_frame')),
    // Makes videos from frames too; for Edit Video, a video in is then a guide, not the thing changed.
    frames: Boolean(entry?.supported_frame_images?.length),
    // Takes the things to avoid as a separate negative prompt (see the video runner).
    negative: Boolean(entry?.allowed_passthrough_parameters?.some((name) => /^negative_?prompt$/i.test(name))),
    audio: entry?.generate_audio === true,
    pricing: parsePricing(entry?.pricing_skus),
    learned: [...(modelStats?.perSecond ?? [])],
    seconds: modelStats?.seconds ?? null,
    caveat: caveatFor(modelStats, Boolean(entry)),
  };
}

/** Our own renderer: a slow zoom or pan made from the photo itself, so nothing can be invented. */
export const LOCAL_PROFILE = {
  id: LOCAL_MOTION,
  label: 'Ken Burns',
  provider: 'made here, free',
  local: true,
  rank: null,
  resolutions: ['720p', '1080p', '2K', '4K'],
  durations: [],
  aspectRatios: ['16:9', '9:16', '4:3', '3:4', '1:1'],
  lastFrame: false,
  audio: false,
  learned: [],
  seconds: null,
  caveat: null,
};

export const starterVideoModels = () =>
  videoModels()
    .slice(0, STARTER_VIDEO_MODELS)
    .map((model) => model.id);

/** A profile per id; the local renderer is always among them. */
export function videoProfiles(ids) {
  const byId = new Map(videoModels().map((model) => [model.id, model]));
  const stats = videoStats();
  return ids.map((id) => (id === LOCAL_MOTION ? LOCAL_PROFILE : profileOf(id, byId.get(id), stats)));
}

// Made only to change a video (no frames in), ahead of those that also make videos from frames
// and take a video as a guide.
const editorsFirst = (profiles) => [...profiles.filter((profile) => !profile.frames), ...profiles.filter((profile) => profile.frames)];

/** Profiles for the person's Edit Video models (`ids`), or for every model that takes a video in. */
export function videoEditProfiles(ids = null) {
  const stats = videoStats();
  const byId = new Map(videoEditModels().map((model) => [model.id, model]));
  return editorsFirst((ids ?? [...byId.keys()]).map((id) => profileOf(id, byId.get(id), stats)));
}

/** A new account starts with the top video editors, or the top models that take a video in if there are none. */
export function starterEditModels() {
  const profiles = videoEditProfiles();
  const editors = profiles.filter((profile) => !profile.frames);
  return (editors.length ? editors : profiles).slice(0, STARTER_VIDEO_MODELS).map((profile) => profile.id);
}

/** For Settings: the person's models, the week's most used others, and all of them for the add box. */
export function videoChoices(prefs) {
  const catalog = videoModels();
  const stats = videoStats();
  const enabled = new Set(prefs.videoModels);
  const describe = (id, entry) => {
    const profile = profileOf(id, entry, stats);
    // Priced as one clip with the person's defaults, so rows compare at a glance.
    const resolution = videoResolutionFor(profile, prefs.videoResolution);
    const duration = durationFor(profile, prefs.videoDuration);
    return { ...profile, sample: { resolution, duration, ...estimateVideo(profile, { resolution, duration, audio: false }) } };
  };
  const byId = new Map(catalog.map((model) => [model.id, model]));
  return {
    // 'usage' (this week's most used) or 'newest', when OpenRouter has no usage ranking.
    rankBy: catalog[0]?._rankBy ?? 'usage',
    selected: prefs.videoModels.map((id) => describe(id, byId.get(id))),
    popular: catalog
      .slice(0, TOP)
      .filter((model) => !enabled.has(model.id))
      .map((model) => describe(model.id, model)),
    all: catalog.filter((model) => !enabled.has(model.id)).map((model) => ({ id: model.id, label: shortName(model.name, model.id) })),
  };
}

/** For Settings: the person's Edit Video models, the others that take a video in, and all of them for the add box. */
export function videoEditChoices(prefs) {
  const catalog = videoEditModels();
  const stats = videoStats();
  const enabled = new Set(prefs.editModels);
  const byId = new Map(catalog.map((model) => [model.id, model]));
  // Priced as editing a 5-second video at the person's default size.
  const describe = (id, entry) => {
    const profile = profileOf(id, entry, stats);
    const resolution = videoResolutionFor(profile, prefs.videoResolution);
    const duration = durationFor(profile, 5);
    return { ...profile, sample: { resolution, duration, ...estimateVideo(profile, { resolution, duration, audio: false }) } };
  };
  return {
    rankBy: catalog[0]?._rankBy ?? 'usage',
    selected: prefs.editModels.map((id) => describe(id, byId.get(id))),
    popular: editorsFirst(catalog.filter((model) => !enabled.has(model.id)).map((model) => describe(model.id, model))).slice(0, TOP),
    all: catalog.filter((model) => !enabled.has(model.id)).map((model) => ({ id: model.id, label: shortName(model.name, model.id) })),
  };
}

export function videoLabels(ids) {
  const byId = new Map([...videoEditModels(), ...videoModels()].map((model) => [model.id, model]));
  // Clips from depth parallax, which was tried and removed, keep a readable name.
  const local = { [LOCAL_MOTION]: LOCAL_PROFILE.label, 'local/depth-parallax': 'Depth parallax' };
  return Object.fromEntries([...new Set(ids)].map((id) => [id, local[id] ?? shortName(byId.get(id)?.name, id)]));
}
