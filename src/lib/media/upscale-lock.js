import sharp from 'sharp';
import { estimateAlignment, warpToGrid } from './align.js';
import { encodeRgb, MAX_INPUT_PIXELS, open } from './image-io.js';

// Upscale lock: the result is the original photo enlarged smoothly, plus only the detail finer
// than the original ever had, taken from the AI's high-resolution redraw. Everything the original
// shows at its own size — every shape, face, color and tone — comes from the original; the AI
// adds only what was never there to keep: sharper edges, skin and fabric texture, hair.

// The result is never larger than an upload may be.
const MAX_PIXELS = MAX_INPUT_PIXELS;

const rawOf = async (pipeline) => {
  const { data, info } = await pipeline.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
};
const blurred = (image, sigma) => rawOf(sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length), { raw: { width: image.width, height: image.height, channels: 3 } }).blur(sigma));

/** The original's frame at `width` × `height`, enlarged with a Lanczos filter. */
export const enlarged = (originalInput, width, height) => rawOf(open(originalInput).resize({ width, height, fit: 'fill', kernel: 'lanczos3' }));

/** Size of the original's frame at a given density, kept under the pixel cap. */
function sizeAt(width, height, factor) {
  const capped = Math.min(factor, Math.sqrt(MAX_PIXELS / (width * height)));
  return { width: Math.round(width * capped), height: Math.round(height * capped), factor: capped };
}

/**
 * The upscaled photo at the AI render's pixel density. Returns the encoded image and what was
 * measured: the alignment, and how many times larger than the original it is.
 */
export async function detailLock(originalInput, aiInput, { format = 'jpeg', exif = null } = {}) {
  const map = await estimateAlignment(originalInput, aiInput);
  // AI pixels per original pixel; below 1 the AI render is smaller, and nothing is gained.
  const density = Math.max(1, (map.ax + map.ay) / 2);
  const size = sizeAt(map.original.width, map.original.height, density);
  const base = await enlarged(originalInput, size.width, size.height);
  if (size.factor < 1.05) {
    return { buffer: await encodeRgb(base, format, { exif }), width: base.width, height: base.height, fit: { map, factor: size.factor } };
  }

  const ai = await warpToGrid(aiInput, map, { width: size.width, height: size.height });
  // Where the AI render does not reach (its last row and column, or a crop), the enlarged
  // original stands in, so the blur below does not pull black in from outside it.
  for (let i = 0; i < ai.mask.length; i += 1) {
    if (ai.mask[i]) continue;
    const p = i * 3;
    ai.data[p] = base.data[p];
    ai.data[p + 1] = base.data[p + 1];
    ai.data[p + 2] = base.data[p + 2];
  }
  // Split at the original's own resolution: below it, the original; above it, the AI.
  const sigma = Math.max(0.8, 0.6 * size.factor);
  const [baseLow, aiLow] = await Promise.all([blurred(base, sigma), blurred(ai, sigma)]);

  const out = new Uint8Array(base.data.length);
  const pixels = size.width * size.height;
  for (let i = 0; i < pixels; i += 1) {
    // A large result takes a moment here; let other requests through now and then.
    if (i % (size.width * 256) === 0) await new Promise((resolve) => setImmediate(resolve));
    const p = i * 3;
    for (let c = 0; c < 3; c += 1) {
      if (!ai.mask[i]) {
        out[p + c] = base.data[p + c];
        continue;
      }
      const value = baseLow.data[p + c] + ai.data[p + c] - aiLow.data[p + c];
      out[p + c] = value < 0 ? 0 : value > 255 ? 255 : value;
    }
  }
  return { buffer: await encodeRgb({ data: out, width: size.width, height: size.height }, format, { exif }), width: size.width, height: size.height, fit: { map, factor: size.factor } };
}

/**
 * The free option: the original enlarged to `longEdge` (at most four times), with a light
 * sharpening. Nothing is drawn or invented.
 */
export async function resizeOnly(originalInput, longEdge, { format = 'jpeg', exif = null } = {}) {
  const meta = await open(originalInput).metadata();
  const [width, height] = meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  const factor = Math.min(4, longEdge / Math.max(width, height));
  const size = sizeAt(width, height, Math.max(1, factor));
  const image = await rawOf(open(originalInput).resize({ width: size.width, height: size.height, fit: 'fill', kernel: 'lanczos3' }).sharpen({ sigma: 0.6 }));
  return { buffer: await encodeRgb(image, format, { exif }), width: image.width, height: image.height, fit: { factor: size.factor } };
}
