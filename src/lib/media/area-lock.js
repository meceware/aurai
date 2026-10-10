import sharp from 'sharp';
import { estimateAlignment, gradientMagnitude, phaseCorrelate, warpToGrid } from './align.js';
import { boxMean } from './filters.js';
import { encodeRgb, loadRgb, luminance, open } from './image-io.js';
import { blendIn, tolerantDifference, toneDrift } from './regions.js';

// Painted-area lock (Edit Image): the result is the photo, with the AI's edit only where the
// person painted. Edit models also redraw what they were not asked to — a face beside the hat,
// the tones of the whole photo — so everything outside the painted area stays the photo's own.
// Painting is rough, so the area is grown into the AI's clear changes that touch it (a brim drawn
// past the paint, the rest of an object the paint missed), but not into mild ones (a redrawn
// face), and not far. The AI's drift in tone is measured outside the area and taken out of its
// pixels inside, so the edit sits in the photo's own light. And as a model may also move what it
// redraws by a few pixels (a roofline), the AI is lined up with the photo around the area itself,
// so lines run on across the seam.

const WORK_EDGE = 1536;
// A change this strong (luma, 0–255) next to the painted area is part of the edit.
const GROW_ABOVE = 45;
// How far the area may grow, as a share of the photo's long edge.
const REACH = 0.06;
// How clearly the edges around the area must agree on a shift before the AI is moved by it.
const LOCAL_PSR = 8;
const TINT = [230, 30, 40];
const TINT_ALPHA = 0.55;

/** The painted area (white on black, any size) as 0/1 at `width` × `height`. */
async function paintAt(maskInput, width, height) {
  const { data } = await sharp(maskInput).resize(width, height, { fit: 'fill' }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i += 1) out[i] = data[i] > 127 ? 1 : 0;
  return out;
}

/** Grows `seed` (0/1) into neighbouring pixels whose `difference` is above `threshold`, `steps` times. */
function grow(seed, difference, width, height, threshold, steps) {
  const region = Uint8Array.from(seed);
  let frontier = [];
  for (let i = 0; i < region.length; i += 1) if (region[i]) frontier.push(i);
  for (let step = 0; step < steps && frontier.length; step += 1) {
    const next = [];
    for (const i of frontier) {
      const x = i % width;
      const neighbours = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width];
      for (const j of neighbours) {
        if (j < 0 || j >= region.length || region[j] || difference[j] <= threshold) continue;
        region[j] = 1;
        next.push(j);
      }
    }
    frontier = next;
  }
  return region;
}

/**
 * The photo with the painted area tinted, as the model is shown it: the tint says where to change.
 * Returns a JPEG at most `maxEdge` on its long side, as it is sent.
 */
export async function markedPhoto(photoInput, maskInput, { maxEdge = 2048 } = {}) {
  const photo = await loadRgb(photoInput, { maxEdge });
  const paint = await paintAt(maskInput, photo.width, photo.height);
  // Softened a little, so the tint has no hard pixel edge for the model to copy.
  const soft = boxMean(Float32Array.from(paint), photo.width, photo.height, 2);
  const data = new Uint8Array(photo.data.length);
  for (let i = 0; i < paint.length; i += 1) {
    const a = soft[i] * TINT_ALPHA;
    for (let c = 0; c < 3; c += 1) data[i * 3 + c] = Math.round(photo.data[i * 3 + c] * (1 - a) + TINT[c] * a);
  }
  return sharp(Buffer.from(data), { raw: { width: photo.width, height: photo.height, channels: 3 } }).jpeg({ quality: 92 }).toBuffer();
}

/**
 * How far the AI image is still off the photo around the painted area, in working pixels: the
 * shift that lines up their edges near it, the area itself left out. Null when nothing there says.
 */
function localShift(photo, ai, paint, width, height, reachPx) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!paint[y * width + x]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return null;
  const margin = reachPx * 3;
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(width - 1, right + margin);
  bottom = Math.min(height - 1, bottom + margin);
  // At most about 384 pixels across, which is plenty for a shift of a few.
  const step = Math.max(1, Math.ceil(Math.max(right - left + 1, bottom - top + 1) / 384));
  const w = Math.floor((right - left + 1) / step);
  const h = Math.floor((bottom - top + 1) / step);
  if (w < 32 || h < 32) return null;

  const lo = boxMean(luminance(photo), width, height, step >> 1);
  const la = boxMean(luminance(ai), width, height, step >> 1);
  const away = boxMean(Float32Array.from(paint), width, height, Math.max(2, Math.round(reachPx / 3)));
  const a = new Float32Array(w * h);
  const b = new Float32Array(w * h);
  const weight = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (top + y * step) * width + left + x * step;
      a[y * w + x] = lo[i];
      b[y * w + x] = la[i];
      weight[y * w + x] = ai.mask[i] && away[i] < 1e-4 ? 1 : 0;
    }
  }
  const ga = gradientMagnitude(a, w, h);
  const gb = gradientMagnitude(b, w, h);
  let kept = 0;
  for (let i = 0; i < weight.length; i += 1) kept += weight[i];
  if (kept < weight.length * 0.2) return null;

  const n = 2 ** Math.ceil(Math.log2(Math.max(w, h) + 16));
  const embed = (field) => {
    let mean = 0;
    for (let i = 0; i < field.length; i += 1) mean += field[i] * weight[i];
    mean /= kept;
    const out = new Float64Array(n * n);
    for (let y = 0; y < h; y += 1) {
      const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / h);
      for (let x = 0; x < w; x += 1) {
        const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / w);
        out[y * n + x] = (field[y * w + x] - mean) * weight[y * w + x] * wx * wy;
      }
    }
    return out;
  };
  const { dx, dy, psr } = phaseCorrelate(embed(ga), embed(gb), n);
  if (psr < LOCAL_PSR || Math.hypot(dx, dy) * step > reachPx) return null;
  return { dx: dx * step, dy: dy * step, psr };
}

/** The strongest change in any channel, the AI's tone drift taken out, a hair's shift allowed. */
function colorDifference(photo, ai, drift, width, height) {
  const n = width * height;
  let out = null;
  for (let c = 0; c < 3; c += 1) {
    const own = new Float32Array(n);
    const theirs = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      own[i] = photo.data[i * 3 + c];
      theirs[i] = ai.data[i * 3 + c] - drift[c][i];
    }
    const difference = tolerantDifference(boxMean(own, width, height, 1), boxMean(theirs, width, height, 1), width, height);
    if (!out) out = difference;
    else for (let i = 0; i < n; i += 1) out[i] = Math.max(out[i], difference[i]);
  }
  return out;
}

/**
 * Where the edit is taken (0–1, at a working resolution), the AI's tone drift to take out, and
 * the alignment as refined around the painted area.
 */
async function areaFields(photoInput, aiInput, maskInput, globalMap) {
  const photo = await loadRgb(photoInput, { maxEdge: WORK_EDGE });
  const { width, height } = photo;
  const n = width * height;
  const paint = await paintAt(maskInput, width, height);
  const reachPx = Math.max(4, Math.round(Math.max(width, height) * REACH));

  let map = globalMap;
  let ai = await warpToGrid(aiInput, map, { width, height });
  const shift = localShift(photo, ai, paint, width, height, reachPx);
  if (shift) {
    // Working pixels → AI pixels: AI = a · original + b, with original = working / scale.
    const scale = width / map.original.width;
    map = { ...map, bx: map.bx + (map.ax * shift.dx) / scale, by: map.by + (map.ay * shift.dy) / scale, local: shift };
    ai = await warpToGrid(aiInput, map, { width, height });
  }

  // The tone drift, from where the two should agree: away from the painted area, and similar.
  const near = boxMean(Float32Array.from(paint), width, height, reachPx);
  const lo = luminance(photo);
  const la = luminance(ai);
  const agree = new Float32Array(n);
  for (let i = 0; i < n; i += 1) agree[i] = ai.mask[i] && near[i] < 1e-4 && Math.abs(la[i] - lo[i]) < 40 ? 1 : 0;
  // Wide enough to reach across a painted area from its surroundings.
  const drift = toneDrift(photo, ai, agree, width, height, Math.max(16, Math.round(Math.max(width, height) / 6)));

  const region = grow(paint, colorDifference(photo, ai, drift, width, height), width, height, GROW_ABOVE, reachPx);
  // A little wider, then feathered, so the seam falls where the two already agree.
  const widened = boxMean(Float32Array.from(region), width, height, 3);
  const mask = boxMean(widened.map((v) => (v > 0.01 ? 1 : 0)), width, height, 3);
  let taken = 0;
  for (let i = 0; i < n; i += 1) {
    if (!ai.mask[i]) mask[i] = 0;
    if (mask[i] > 0.5) taken += 1;
  }
  return { mask, drift, width, height, map, area: taken / n };
}

/**
 * The photo with the AI's edit only in the painted area (grown and feathered as above), at the
 * photo's own size. Returns the encoded image and what was measured: the alignment, and the share
 * of the photo that was taken from the AI.
 */
export async function areaLock(photoInput, aiInput, maskInput, { format = 'jpeg', exif = null } = {}) {
  const fields = await areaFields(photoInput, aiInput, maskInput, await estimateAlignment(photoInput, aiInput));
  const photo = await loadRgb(photoInput);
  const ai = await warpToGrid(aiInput, fields.map, { width: photo.width, height: photo.height });
  const out = await blendIn(photo, ai, fields);
  return { buffer: await encodeRgb(out, format, { exif }), width: photo.width, height: photo.height, fit: { map: fields.map, area: fields.area } };
}

/** A painted area made by the browser, checked: a PNG, sized like the photo, and not empty. */
export async function checkedMask(bytes) {
  const meta = await open(bytes).metadata();
  if (meta.format !== 'png' || !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096) return null;
  const { data } = await sharp(bytes).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  let painted = 0;
  for (let i = 0; i < data.length; i += 1) if (data[i] > 127) painted += 1;
  return painted ? { width: meta.width, height: meta.height, share: painted / data.length } : null;
}

