import { boxMean } from './filters.js';

// Shared by the locks that take the AI's pixels only in part of the photo (Repair, Edit Image):
// finding where it changed something, matching its tones to the photo's, and blending it in.

/** Normalised mean of `field` over the pixels in `mask`, in a (2r+1)² window. */
export function maskedMean(field, mask, width, height, radius) {
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
export function tolerantDifference(original, ai, width, height) {
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
export function sampler(field, width, height, fullWidth, fullHeight) {
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
 * The AI's drift in tone per channel (AI minus original), measured where `agree` says the two
 * show the same thing and spread smoothly everywhere else — to be taken out of its pixels.
 */
export function toneDrift(original, ai, agree, width, height, radius) {
  const n = width * height;
  return [0, 1, 2].map((c) => {
    const diff = new Float32Array(n);
    for (let i = 0; i < n; i += 1) diff[i] = ai.data[i * 3 + c] - original.data[i * 3 + c];
    return maskedMean(diff, agree, width, height, radius);
  });
}

/** Luma of the AI's pixels with its tone drift taken out. */
export function correctedLuma(ai, drift, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = 0.2126 * (ai.data[i * 3] - drift[0][i]) + 0.7152 * (ai.data[i * 3 + 1] - drift[1][i]) + 0.0722 * (ai.data[i * 3 + 2] - drift[2][i]);
  }
  return out;
}

/**
 * The full-resolution result: the original, with the AI's pixels (drift taken out) blended in by
 * `fields.mask` (0–1, at the fields' working resolution). `ai.mask` is where the AI has content.
 */
export async function blendIn(original, ai, fields) {
  const { width, height } = original;
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
        const value = original.data[p + c] * (1 - m) + (ai.data[p + c] - driftAt[c](x, y)) * m;
        out[p + c] = value < 0 ? 0 : value > 255 ? 255 : Math.round(value);
      }
    }
  }
  return { data: out, width, height };
}
