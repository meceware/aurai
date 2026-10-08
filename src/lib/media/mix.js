import sharp from 'sharp';
import { open } from './image-io.js';

// Color and brightness as separate dials. The corrected (Faithful) image sits on the original's
// pixel grid, so each pixel can take its color (a*b*) and its lightness (L*) from the correction
// in different amounts: e.g. all of a model's skin-tone fix, none of its brightening.

const LINEAR = new Float32Array(256).map((_, v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const STEPS = 4096;
const GAMMA = new Float32Array(STEPS + 1).map((_, i) => {
  const c = i / STEPS;
  return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
});
const encode = (linear) => {
  if (linear <= 0) return 0;
  if (linear >= 1) return 255;
  const position = linear * STEPS;
  const i = position | 0;
  return GAMMA[i] + (GAMMA[i + 1] - GAMMA[i]) * (position - i);
};

// Cube root, tabulated over 0..1.1 (relative XYZ never leaves that range for sRGB input).
const CBRT_MAX = 1.1;
const CBRT = new Float32Array(STEPS + 1).map((_, i) => Math.cbrt((i / STEPS) * CBRT_MAX));
const f = (t) => {
  if (t <= 216 / 24389) return (24389 / 27 * t + 16) / 116;
  const position = (Math.min(t, CBRT_MAX) / CBRT_MAX) * STEPS;
  const i = position | 0;
  return i >= STEPS ? CBRT[STEPS] : CBRT[i] + (CBRT[i + 1] - CBRT[i]) * (position - i);
};
const fInv = (t) => (t > 6 / 29 ? t * t * t : (116 * t - 16) / (24389 / 27));

const WX = 0.95047;
const WZ = 1.08883;

/** Lab of one sRGB pixel, as [fx, fy, fz] (the f(·) values Lab is built from). */
function toF(data, p) {
  const r = LINEAR[data[p]];
  const g = LINEAR[data[p + 1]];
  const b = LINEAR[data[p + 2]];
  return [
    f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / WX),
    f(0.2126729 * r + 0.7151522 * g + 0.072175 * b),
    f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / WZ),
  ];
}

/**
 * Original and corrected are packed RGB of the same size. `color` and `light` (0..1) are how much
 * of the correction's color and lightness to take. Works in Lab via its f-space, where
 * L = 116·fy − 16, a = 500·(fx − fy), b = 200·(fy − fz).
 */
export async function mixRgb(original, corrected, { color = 1, light = 1, ev = 0 }) {
  const { data: o, width, height } = original;
  // Exposure in stops, applied to linear light after mixing, as a camera would.
  const gain = 2 ** ev;
  const c = corrected.data;
  const out = new Uint8Array(o.length);
  const rowsPerStrip = Math.max(1, Math.floor(1_000_000 / width));

  for (let start = 0; start < height; start += rowsPerStrip) {
    const end = Math.min(height, start + rowsPerStrip) * width * 3;
    for (let p = start * width * 3; p < end; p += 3) {
      const [ox, oy, oz] = toF(o, p);
      const [cx, cy, cz] = toF(c, p);
      const fy = oy + (cy - oy) * light;
      // Chroma as offsets from fy, so changing lightness keeps the chosen color.
      const fx = fy + (ox - oy + (cx - cy - (ox - oy)) * color);
      const fz = fy - (oy - oz + (cy - cz - (oy - oz)) * color);
      const X = WX * fInv(fx) * gain;
      const Y = fInv(fy) * gain;
      const Z = WZ * fInv(fz) * gain;
      out[p] = encode(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z) + 0.5;
      out[p + 1] = encode(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z) + 0.5;
      out[p + 2] = encode(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z) + 0.5;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { data: out, width, height };
}

/** Decodes both images onto the same grid (the original's, optionally downsized) and mixes them. */
export async function mixImages(originalBytes, correctedBytes, { color, light, ev, maxEdge } = {}) {
  let base = open(originalBytes);
  if (maxEdge) base = base.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
  const { data, info } = await base.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { data: top } = await sharp(correctedBytes).resize(info.width, info.height, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return mixRgb(
    { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height },
    { data: new Uint8Array(top.buffer, top.byteOffset, top.length) },
    { color, light, ev },
  );
}

/** Mixed and encoded as a JPEG, for sending on or storing. */
export async function mixToJpeg(originalBytes, correctedBytes, dials) {
  const { data, width, height } = await mixImages(originalBytes, correctedBytes, dials);
  return sharp(Buffer.from(data), { raw: { width, height, channels: 3 } }).jpeg({ quality: 95, mozjpeg: true }).toBuffer();
}

/** Dials from query parameters, clamped; the defaults change nothing. */
export function readDials(params) {
  const number = (name, fallback, min, max) => {
    const value = Number(params.get(name));
    return params.has(name) && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  return { color: number('color', 1, 0, 1), light: number('light', 1, 0, 1), ev: number('ev', 0, -1, 1) };
}

export const isNeutral = (dials) => dials.color === 1 && dials.light === 1 && dials.ev === 0;
