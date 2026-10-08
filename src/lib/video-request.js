// The request a clip is sent to OpenRouter with, built apart from the runner so tests can pin
// the exact JSON. OpenRouter drops extra settings it does not recognise without a word, so a
// setting in the wrong shape fails silently: nothing but the request itself shows it.

// OpenRouter's own video guide gives one shape for every provider:
// `provider.options.<slug>.parameters.<key>`, the keys named as in the model's
// `allowed_passthrough_parameters` (each provider's own casing). Checked with paid runs
// (2026-10): a setting there reached both google-vertex (Veo) and atlas-cloud (Kling, Wan).
// A value the provider cannot use is ignored, not refused, so a mistake shows only in the clip.

/** The model's own name for a setting, among the extra settings its catalog entry allows. */
export function passthroughName(entry, pattern) {
  return entry?.allowed_passthrough_parameters?.find((name) => pattern.test(name)) ?? null;
}

export const NEGATIVE_PROMPT = /^negative_?prompt$/i;

/**
 * `provider.options` carrying `settings` ({ name: value }) to every provider that serves the
 * model. Null when there is nothing to send.
 */
export function providerOptions(providers, settings) {
  if (!providers?.length || !Object.keys(settings ?? {}).length) return null;
  return { options: Object.fromEntries(providers.map((provider) => [provider, { parameters: { ...settings } }])) };
}

/**
 * The body for `POST /videos`. `frames` are `{ url, type }` with type `first_frame` or
 * `last_frame`; `videos` are videos to work from (a video to edit). Anything left out is left
 * to the model's defaults.
 */
export function videoRequest({ model, prompt, duration, frames = [], videos = [], resolution, aspect, audio, callback, provider }) {
  const body = { model, prompt };
  if (duration) body.duration = duration;
  if (frames.length) body.frame_images = frames.map((frame) => ({ type: 'image_url', image_url: { url: frame.url }, frame_type: frame.type }));
  if (videos.length) body.input_references = videos.map((url) => ({ type: 'video_url', video_url: { url } }));
  if (resolution) body.resolution = resolution;
  if (aspect) body.aspect_ratio = aspect;
  // Only models that offer sound get the switch.
  if (audio !== undefined) body.generate_audio = Boolean(audio);
  if (callback) body.callback_url = callback;
  if (provider) body.provider = provider;
  return body;
}
