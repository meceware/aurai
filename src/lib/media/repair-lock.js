import { estimateAlignment, warpToGrid } from './align.js';
import { boxMean } from './filters.js';
import { encodeRgb, loadRgb, luminance } from './image-io.js';

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

/** Normalised mean of `field` over the pixels in `mask`, in a (2r+1)² window. */
function maskedMean(field, mask, width, height, radius) {
  const weighted = new Float32Array(field.length);
  const weights = new Float32Array(field.length);
  for (let i = 0; i < field.length; i += 1) {
    weights[i] = mask[i];
    weighted[i] = mask[i] * field[i];
  }
  const num = boxMean(weighted, width, height, radius);
  const den = boxMean(weights, width, height, radius);
  for (let i = 0; i < num.length; i += 1) num[i] = den[i] > 1e-3 ? num[i] / den[i] : 0;
  return num;
}

/**
 * How far each original pixel is from the AI's, allowing a one-pixel shift either way, so edges
 * that the redraw moved a hair do not count as changes.
 */
function tolerantDifference(original, ai, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      let best = Infinity;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          best = Math.min(best, Math.abs(ai[yy * width + xx] - original[i]));
        }
      }
      out[i] = best;
    }
  }
  return out;
}

/** Bilinear sample of a work-resolution field at full-resolution pixel (x, y). */
function sampler(field, width, height, fullWidth, fullHeight) {
  const sx = width / fullWidth;
  const sy = height / fullHeight;
  return (x, y) => {
    const fx = Math.min(width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
    const fy = Math.min(height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const top = field[y0 * width + x0] * (1 - tx) + field[y0 * width + x1] * tx;
    const bottom = field[y1 * width + x0] * (1 - tx) + field[y1 * width + x1] * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

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
  const radius = Math.max(8, Math.round(Math.max(width, height) / 32));
  const drift = [0, 1, 2].map((c) => {
    const diff = new Float32Array(n);
    for (let i = 0; i < n; i += 1) diff[i] = ai.data[i * 3 + c] - original.data[i * 3 + c];
    return maskedMean(diff, agree, width, height, radius);
  });

  const corrected = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = ai.data[i * 3] - drift[0][i];
    const g = ai.data[i * 3 + 1] - drift[1][i];
    const b = ai.data[i * 3 + 2] - drift[2][i];
    corrected[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const difference = tolerantDifference(lo, corrected, width, height);
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

  const maskAt = sampler(fields.mask, fields.width, fields.height, width, height);
  const driftAt = fields.drift.map((field) => sampler(field, fields.width, fields.height, width, height));
  const out = new Uint8Array(original.data.length);
  for (let y = 0; y < height; y += 1) {
    // A large photo takes a second or two here; let other requests through between strips.
    if (y % 128 === 0) await new Promise((resolve) => setImmediate(resolve));
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const p = i * 3;
      const m = ai.mask[i] ? maskAt(x, y) : 0;
      for (let c = 0; c < 3; c += 1) {
        if (m < 0.002) {
          out[p + c] = original.data[p + c];
          continue;
        }
        const repairedValue = ai.data[p + c] - driftAt[c](x, y);
        const value = original.data[p + c] * (1 - m) + repairedValue * m;
        out[p + c] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
      }
    }
  }
  return {
    buffer: await encodeRgb({ data: out, width, height }, format, { exif }),
    width,
    height,
    fit: { map, repaired: fields.repaired },
  };
}
