import { estimateAlignment, warpToGrid } from './align.js';
import { boxMean } from './filters.js';
import { encodeRgb, loadRgb, luminance } from './image-io.js';
import { blendIn, correctedLuma, tolerantDifference, toneDrift } from './regions.js';

// Repair lock: the result is the original photo, with the AI's pixels only where it repaired
// damage — scratches, dust, cracks, stains, torn or missing parts. Damage shows as a strong local
// difference between the two; where the AI merely redrew what was fine (a face, a texture), the
// difference is mild and the original stays. The AI's own drift in color and brightness is taken
// out first, so a repaired spot carries the tones around it rather than the model's.

const WORK_EDGE = 2048;
// Luma difference (0–255) between "the same" and "repaired": below LOW is the AI's redraw noise,
// above HIGH certainly a change of content.
const LOW = 14;
const HIGH = 32;

const smoothstep = (value) => {
  const t = Math.min(1, Math.max(0, (value - LOW) / (HIGH - LOW)));
  return t * t * (3 - 2 * t);
};

/**
 * Where the AI repaired something (0–1 per pixel, at a working resolution), and the AI's drift in
 * tone per channel there, to be taken out of its pixels.
 */
async function repairFields(originalInput, aiInput, map) {
  const original = await loadRgb(originalInput, { maxEdge: WORK_EDGE });
  const { width, height } = original;
  const ai = await warpToGrid(aiInput, map, { width, height });
  const n = width * height;

  // First guess of where they agree, then the tone drift measured only there.
  const lo = luminance(original);
  const la = luminance(ai);
  const agree = new Float32Array(n);
  for (let i = 0; i < n; i += 1) agree[i] = ai.mask[i] && Math.abs(la[i] - lo[i]) < 40 ? 1 : 0;
  const drift = toneDrift(original, ai, agree, width, height, Math.max(8, Math.round(Math.max(width, height) / 32)));
  const difference = tolerantDifference(lo, correctedLuma(ai, drift, n), width, height);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i += 1) raw[i] = ai.mask[i] ? smoothstep(difference[i]) : 0;
  // Grown a little and feathered, so a repaired scratch takes its soft edges with it.
  const spread = boxMean(raw, width, height, 2);
  const mask = new Float32Array(n);
  let repaired = 0;
  for (let i = 0; i < n; i += 1) {
    mask[i] = ai.mask[i] ? Math.min(1, spread[i] * 2.5) : 0;
    if (mask[i] > 0.5) repaired += 1;
  }
  return { mask, drift, width, height, repaired: repaired / n };
}

/**
 * The original, with the AI's repairs where it made them. Returns the encoded full-resolution
 * image and what was measured: the alignment, and how much of the photo was repaired.
 */
export async function repairLock(originalInput, aiInput, { format = 'jpeg', exif = null } = {}) {
  const map = await estimateAlignment(originalInput, aiInput);
  const fields = await repairFields(originalInput, aiInput, map);
  const original = await loadRgb(originalInput);
  const { width, height } = original;
  const ai = await warpToGrid(aiInput, map, { width, height });
  const out = await blendIn(original, ai, fields);
  return {
    buffer: await encodeRgb(out, format, { exif }),
    width,
    height,
    fit: { map, repaired: fields.repaired },
  };
}
