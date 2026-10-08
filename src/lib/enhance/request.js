/** Nearest "w:h" from a list to the given aspect ratio, compared on a log scale. */
export function nearestRatio(ratio, options) {
  let best = null;
  for (const option of options) {
    const [w, h] = option.split(':').map(Number);
    if (!w || !h) continue;
    const distance = Math.abs(Math.log(w / h) - Math.log(ratio));
    if (!best || distance < best.distance) best = { option, distance };
  }
  return best?.option;
}

/**
 * Images API body for one edit. Only parameters the model declares are sent. `resolution` is
 * decided when the run is started (the photo's size, capped by Settings) so the price shown is
 * the price paid; `quality` is the person's choice for this model, or the model's own default.
 */
export function buildImageRequest({ model, prompt, dataUrl, width, height, catalogEntry, quality = null, resolution = null }) {
  const params = catalogEntry?.supported_parameters ?? {};
  const body = { model, prompt, input_references: [{ type: 'image_url', image_url: { url: dataUrl } }] };

  if (resolution && params.resolution?.values?.includes(resolution)) body.resolution = resolution;
  if (params.aspect_ratio?.values) {
    body.aspect_ratio = params.aspect_ratio.values.includes('auto') ? 'auto' : nearestRatio(width / height, params.aspect_ratio.values);
  }
  if (params.quality?.values?.includes(quality)) body.quality = quality;
  if (params.n) body.n = 1;
  return body;
}
