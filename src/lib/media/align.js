import { fft2d } from './fft.js';
import { loadRgb, loadRgbExact, luminance, open } from './image-io.js';

/**
 * Sobel gradient magnitude. Edges survive a colour correction almost unchanged while
 * flat colour does not, so gradients are what alignment and fidelity compare.
 */
export function gradientMagnitude(lum, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        lum[i - width + 1] + 2 * lum[i + 1] + lum[i + width + 1] - lum[i - width - 1] - 2 * lum[i - 1] - lum[i + width - 1];
      const gy =
        lum[i + width - 1] + 2 * lum[i + width] + lum[i + width + 1] - lum[i - width - 1] - 2 * lum[i - width] - lum[i - width + 1];
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

export function boxBlur(field, width, height, radius) {
  const tmp = new Float32Array(field.length);
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k += 1) {
        sum += field[y * width + k];
        count += 1;
      }
      tmp[y * width + x] = sum / count;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k += 1) {
        sum += tmp[k * width + x];
        count += 1;
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}

const nextPow2 = (value) => 2 ** Math.ceil(Math.log2(value));

/** Mean-free, Hann-windowed copy of a field, placed top-left in an n×n canvas. */
function embed(field, width, height, n) {
  let mean = 0;
  for (let i = 0; i < field.length; i += 1) mean += field[i];
  mean /= field.length;

  const re = new Float64Array(n * n);
  for (let y = 0; y < height; y += 1) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / height);
    for (let x = 0; x < width; x += 1) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / width);
      re[y * n + x] = (field[y * width + x] - mean) * wx * wy;
    }
  }
  return re;
}

/**
 * Finds d such that b(x) ≈ a(x − d), i.e. the shift that takes `a` onto `b`.
 * `psr` is the peak-to-sidelobe ratio: how far the peak stands above the rest of the
 * correlation surface, which is what separates a real match from noise.
 */
export function phaseCorrelate(a, b, n) {
  const ar = a;
  const ai = new Float64Array(n * n);
  const br = b;
  const bi = new Float64Array(n * n);
  fft2d(ar, ai, n);
  fft2d(br, bi, n);

  const rr = new Float64Array(n * n);
  const ri = new Float64Array(n * n);
  for (let i = 0; i < rr.length; i += 1) {
    // conj(A)·B, whose inverse peaks at +d.
    const re = ar[i] * br[i] + ai[i] * bi[i];
    const im = ar[i] * bi[i] - ai[i] * br[i];
    const mag = Math.hypot(re, im) || 1;
    rr[i] = re / mag;
    ri[i] = im / mag;
  }
  fft2d(rr, ri, n, true);

  let best = 0;
  for (let i = 1; i < rr.length; i += 1) if (rr[i] > rr[best]) best = i;
  const px = best % n;
  const py = Math.floor(best / n);

  // Sub-pixel peak by fitting a parabola through the neighbours on each axis.
  const at = (x, y) => rr[((y + n) % n) * n + ((x + n) % n)];
  const refine = (m, c, p) => {
    const denom = m - 2 * c + p;
    return denom === 0 ? 0 : (0.5 * (m - p)) / denom;
  };
  let dx = px + refine(at(px - 1, py), at(px, py), at(px + 1, py));
  let dy = py + refine(at(px, py - 1), at(px, py), at(px, py + 1));
  if (dx > n / 2) dx -= n;
  if (dy > n / 2) dy -= n;

  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const ddx = Math.min(Math.abs(x - px), n - Math.abs(x - px));
      const ddy = Math.min(Math.abs(y - py), n - Math.abs(y - py));
      if (ddx <= 5 && ddy <= 5) continue;
      const v = rr[y * n + x];
      sum += v;
      squares += v * v;
      count += 1;
    }
  }
  const mean = sum / count;
  const std = Math.sqrt(Math.max(squares / count - mean * mean, 1e-12));

  return { dx, dy, peak: rr[best], psr: (rr[best] - mean) / std };
}

async function gradientOf(input, options) {
  const image = options.exact ? await loadRgbExact(input, options.width, options.height) : await loadRgb(input, options);
  const blurred = boxBlur(gradientMagnitude(luminance(image), image.width, image.height), image.width, image.height, 1);
  return { field: blurred, width: image.width, height: image.height };
}

const SCALES = [0.94, 0.97, 1, 1.03, 1.06];

/**
 * Estimates how an AI output sits over its source: a uniform scale plus an offset, which
 * covers the usual reframings (same frame, centre crop, outpainted borders, slight zoom).
 *
 * Returns a map from original full-resolution pixels to AI full-resolution pixels,
 * `ai = a · original + b`, and a confidence (`psr`).
 */
export async function estimateAlignment(originalInput, aiInput) {
  const [originalMeta, aiMeta] = await Promise.all([open(originalInput).metadata(), open(aiInput).metadata()]);
  const swap = (meta) => (meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height]);
  const [originalWidth, originalHeight] = swap(originalMeta);
  const [aiWidth, aiHeight] = swap(aiMeta);

  async function search(longEdge, candidates) {
    const original = await gradientOf(originalInput, { maxEdge: longEdge });
    const workScale = original.width / originalWidth;
    let best = null;

    for (const { k, s } of candidates) {
      const width = Math.max(8, Math.round(aiWidth * k * s));
      const height = Math.max(8, Math.round(aiHeight * k * s));
      const ai = await gradientOf(aiInput, { exact: true, width, height });
      const n = nextPow2(Math.max(original.width, original.height, width, height) + 16);

      const result = phaseCorrelate(
        embed(original.field, original.width, original.height, n),
        embed(ai.field, ai.width, ai.height, n),
        n,
      );
      // Exact resized dimensions, so rounding does not leak into the scale.
      const kx = width / aiWidth;
      const ky = height / aiHeight;
      if (!best || result.psr > best.psr) best = { ...result, k, s, kx, ky, workScale };
    }
    return best;
  }

  const longest = Math.max(originalWidth, originalHeight);
  // AI px → working px. A crop fits inside the original's frame; an outpaint contains it.
  const cropK = (edge) => Math.min((edge * originalWidth) / longest / aiWidth, (edge * originalHeight) / longest / aiHeight);
  const outK = (edge) => Math.max((edge * originalWidth) / longest / aiWidth, (edge * originalHeight) / longest / aiHeight);

  const coarseEdge = 192;
  const hypotheses = [...new Set([cropK(coarseEdge), outK(coarseEdge)])];
  const coarse = await search(
    coarseEdge,
    hypotheses.flatMap((k) => SCALES.map((s) => ({ k, s }))),
  );

  // Same scale at twice the resolution, translation only, for a sharper offset.
  const fineEdge = coarseEdge * 2;
  const fine = await search(fineEdge, [{ k: coarse.k * 2, s: coarse.s }]);
  const pick = fine.psr >= coarse.psr * 0.5 ? fine : coarse;

  // O_work(p) ≈ AI_resized(p + d), with p = workScale · x_original and AI_resized = k · AI.
  const ax = pick.workScale / pick.kx;
  const ay = pick.workScale / pick.ky;
  return {
    ax,
    ay,
    bx: pick.dx / pick.kx,
    by: pick.dy / pick.ky,
    scale: pick.s,
    psr: pick.psr,
    peak: pick.peak,
    hypothesis: hypotheses.length === 1 ? 'same-aspect' : coarse.k === hypotheses[0] ? 'crop' : 'outpaint',
    original: { width: originalWidth, height: originalHeight },
    ai: { width: aiWidth, height: aiHeight },
  };
}

/**
 * Resamples the AI output onto the original's pixel grid at a working resolution, so
 * pixel i of the result shows the same scene point as pixel i of the original.
 * `mask[i]` is 0 where the AI image has no content for that point.
 */
export async function warpToGrid(aiInput, map, { width, height }) {
  const scale = width / map.original.width;
  // Prefilter by resizing the AI image to roughly the working density before sampling.
  const aiWidth = Math.max(8, Math.round((map.ai.width * scale) / map.ax));
  const aiHeight = Math.max(8, Math.round((map.ai.height * scale) / map.ay));
  const ai = await loadRgbExact(aiInput, aiWidth, aiHeight);
  const sx = aiWidth / map.ai.width;
  const sy = aiHeight / map.ai.height;

  const data = new Uint8Array(width * height * 3);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const oy = (y + 0.5) / scale;
    const ay = sy * (map.ay * oy + map.by) - 0.5;
    const y0 = Math.floor(ay);
    const fy = ay - y0;
    if (y0 < 0 || y0 + 1 >= aiHeight) continue;

    for (let x = 0; x < width; x += 1) {
      const ox = (x + 0.5) / scale;
      const axp = sx * (map.ax * ox + map.bx) - 0.5;
      const x0 = Math.floor(axp);
      const fx = axp - x0;
      if (x0 < 0 || x0 + 1 >= aiWidth) continue;

      const i00 = (y0 * aiWidth + x0) * 3;
      const i10 = i00 + 3;
      const i01 = i00 + aiWidth * 3;
      const i11 = i01 + 3;
      const o = (y * width + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const top = ai.data[i00 + c] * (1 - fx) + ai.data[i10 + c] * fx;
        const bottom = ai.data[i01 + c] * (1 - fx) + ai.data[i11 + c] * fx;
        data[o + c] = Math.round(top * (1 - fy) + bottom * fy);
      }
      mask[y * width + x] = 1;
    }
  }
  return { data, width, height, mask };
}
