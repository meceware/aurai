import { estimateAlignment, warpToGrid } from './align.js';
import { srgbToLab } from './color.js';
import { fillMasked, guidedFilter } from './filters.js';
import { encodeRgb, loadRgb, loadRgbExact } from './image-io.js';

// Colorize lock: the result keeps the original's lightness (L*) at every pixel — so every face,
// wrinkle and shadow stays exactly as photographed — and takes only the colour (a*b*) from the
// AI render. Colour is carried at a working resolution, snapped to the original's own edges by a
// guided filter, then upsampled: the eye resolves colour far more coarsely than lightness, which
// is the same reason every JPEG stores colour at reduced resolution.

const WORK_EDGE = 1024;
const WHITE_X = 0.95047;
const WHITE_Z = 1.08883;

const LINEAR = new Float32Array(256).map((_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

// Linear → sRGB 0..255, tabulated: the inverse gamma is the expensive part of Lab → RGB.
const GAMMA_STEPS = 4096;
const GAMMA = new Float32Array(GAMMA_STEPS + 1).map((_, i) => {
  const c = i / GAMMA_STEPS;
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
});
const encode = (linear) => {
  if (linear <= 0) return 0;
  if (linear >= 1) return 255;
  const position = linear * GAMMA_STEPS;
  const i = position | 0;
  return GAMMA[i] + (GAMMA[i + 1] - GAMMA[i]) * (position - i);
};

const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t) => (t > 6 / 29 ? t * t * t : (116 * t - 16) / (24389 / 27));

/** L* of each pixel, from relative luminance (the only part of Lab that lightness needs). */
function lightness({ data, width, height }) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 3) {
    const y = 0.2126729 * LINEAR[data[p]] + 0.7151522 * LINEAR[data[p + 1]] + 0.072175 * LINEAR[data[p + 2]];
    out[i] = 116 * f(y) - 16;
  }
  return out;
}

async function chromaField(originalInput, aiInput, map, width, height) {
  const guideImage = await loadRgbExact(originalInput, width, height);
  const guide = lightness(guideImage);
  const ai = await warpToGrid(aiInput, map, { width, height });

  const a = new Float32Array(width * height);
  const b = new Float32Array(width * height);
  for (let i = 0, p = 0; i < a.length; i += 1, p += 3) {
    if (!ai.mask[i]) continue;
    const [, A, B] = srgbToLab(ai.data[p], ai.data[p + 1], ai.data[p + 2]);
    a[i] = A;
    b[i] = B;
  }
  // Where the AI render has no content (it cropped the frame), borrow from the nearest colour.
  const filledA = fillMasked(a, ai.mask, width, height, 24);
  const filledB = fillMasked(b, ai.mask, width, height, 24);

  // Snap colour edges to the original's lightness edges. Guide is L* (0..100); ε sets how strong
  // an edge must be to stop colour from crossing it.
  const radius = Math.max(2, Math.round(Math.max(width, height) / 256));
  const epsilon = 4 ** 2;
  return {
    a: guidedFilter(guide, filledA, width, height, radius, epsilon),
    b: guidedFilter(guide, filledB, width, height, radius, epsilon),
    coverage: ai.mask.reduce((sum, v) => sum + v, 0) / ai.mask.length,
  };
}

/** Original lightness, AI colour. Returns the encoded full-resolution image and alignment info. */
export async function colorizeLock(originalInput, aiInput, { format = 'jpeg', exif = null } = {}) {
  const map = await estimateAlignment(originalInput, aiInput);
  const full = await loadRgb(originalInput);
  const scale = Math.min(1, WORK_EDGE / Math.max(full.width, full.height));
  const workWidth = Math.max(8, Math.round(full.width * scale));
  const workHeight = Math.max(8, Math.round(full.height * scale));
  const chroma = await chromaField(originalInput, aiInput, map, workWidth, workHeight);

  const out = new Uint8Array(full.data.length);
  const sx = workWidth / full.width;
  const sy = workHeight / full.height;
  const rowsPerStrip = Math.max(1, Math.floor(1_000_000 / full.width));

  for (let startRow = 0; startRow < full.height; startRow += rowsPerStrip) {
    const endRow = Math.min(full.height, startRow + rowsPerStrip);
    for (let y = startRow; y < endRow; y += 1) {
      const wy = Math.min(workHeight - 1.001, Math.max(0, (y + 0.5) * sy - 0.5));
      const y0 = wy | 0;
      const fy = wy - y0;
      for (let x = 0; x < full.width; x += 1) {
        const wx = Math.min(workWidth - 1.001, Math.max(0, (x + 0.5) * sx - 0.5));
        const x0 = wx | 0;
        const fx = wx - x0;
        const i00 = y0 * workWidth + x0;
        const i01 = i00 + workWidth;
        const A =
          (chroma.a[i00] * (1 - fx) + chroma.a[i00 + 1] * fx) * (1 - fy) + (chroma.a[i01] * (1 - fx) + chroma.a[i01 + 1] * fx) * fy;
        const B =
          (chroma.b[i00] * (1 - fx) + chroma.b[i00 + 1] * fx) * (1 - fy) + (chroma.b[i01] * (1 - fx) + chroma.b[i01 + 1] * fx) * fy;

        const p = (y * full.width + x) * 3;
        const Y = 0.2126729 * LINEAR[full.data[p]] + 0.7151522 * LINEAR[full.data[p + 1]] + 0.072175 * LINEAR[full.data[p + 2]];
        const fy0 = f(Y);
        const X = WHITE_X * fInv(fy0 + A / 500);
        const Z = WHITE_Z * fInv(fy0 - B / 200);
        // Y is reused as-is: lightness is exactly the original's.
        out[p] = encode(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z) + 0.5;
        out[p + 1] = encode(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z) + 0.5;
        out[p + 2] = encode(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z) + 0.5;
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }

  const buffer = await encodeRgb({ data: out, width: full.width, height: full.height }, format, { exif });
  return { buffer, width: full.width, height: full.height, fit: { map, metrics: { coverage: chroma.coverage } } };
}
