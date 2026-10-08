import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { estimateAlignment, phaseCorrelate } from './align.js';
import { colorLock } from './colorlock.js';
import { loadRgb } from './image-io.js';

function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A small "photo": smooth background, coloured blobs, and fine texture for alignment to lock onto. */
function scene(width, height, seed = 7) {
  const random = prng(seed);
  const blobs = Array.from({ length: 9 }, () => ({
    x: random() * width,
    y: random() * height,
    r: 20 + random() * Math.min(width, height) * 0.15,
    c: [random() * 200 + 30, random() * 200 + 30, random() * 200 + 30],
  }));
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let c = [90 + (100 * y) / height, 110, 150 - (60 * x) / width];
      for (const blob of blobs) if ((x - blob.x) ** 2 + (y - blob.y) ** 2 < blob.r ** 2) c = blob.c;
      const grain = (random() - 0.5) * 24;
      const p = (y * width + x) * 3;
      for (let k = 0; k < 3; k += 1) data[p + k] = Math.max(0, Math.min(255, c[k] + grain));
    }
  }
  return { data, width, height };
}

const png = ({ data, width, height }) => sharp(Buffer.from(data), { raw: { width, height, channels: 3 } }).png().toBuffer();

function recolor({ data, width, height }, fn) {
  const out = new Uint8Array(data.length);
  for (let p = 0; p < data.length; p += 3) {
    const [r, g, b] = fn(data[p], data[p + 1], data[p + 2]);
    out[p] = Math.max(0, Math.min(255, Math.round(r)));
    out[p + 1] = Math.max(0, Math.min(255, Math.round(g)));
    out[p + 2] = Math.max(0, Math.min(255, Math.round(b)));
  }
  return { data: out, width, height };
}

// A cast removal plus a gentle lift, the kind of change a restoration model makes.
const correction = (r, g, b) => [r * 0.82 + 10, g * 0.97 + 12, b * 1.12 + 6];

const meanAbs = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
};

test('phase correlation reports the shift that takes a onto b', () => {
  const n = 64;
  const random = prng(3);
  const a = new Float64Array(n * n).map(() => random());
  const b = new Float64Array(n * n);
  const [dx, dy] = [5, -3];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) b[y * n + x] = a[((y - dy + n) % n) * n + ((x - dx + n) % n)];
  }
  const result = phaseCorrelate(Float64Array.from(a), b, n);
  assert.ok(Math.abs(result.dx - dx) < 0.5, `dx ${result.dx}`);
  assert.ok(Math.abs(result.dy - dy) < 0.5, `dy ${result.dy}`);
  assert.ok(result.psr > 20);
});

test('alignment finds a centre crop that was resized to a square output', async () => {
  const original = scene(600, 400);
  const cropped = await sharp(await png(recolor(original, correction)))
    .extract({ left: 100, top: 0, width: 400, height: 400 })
    .resize(1024, 1024)
    .png()
    .toBuffer();

  const map = await estimateAlignment(await png(original), cropped);
  // Original x=100 is AI x=0; original x=500 is AI x=1024.
  assert.ok(Math.abs(map.ax * 100 + map.bx - 0) < 12, `left edge maps to ${map.ax * 100 + map.bx}`);
  assert.ok(Math.abs(map.ax * 500 + map.bx - 1024) < 12, `right edge maps to ${map.ax * 500 + map.bx}`);
  assert.ok(Math.abs(map.ay * 200 + map.by - 512) < 12, `centre row maps to ${map.ay * 200 + map.by}`);
});

test('colour-lock recovers the colour change and keeps every original edge', async () => {
  const original = scene(640, 480);
  const target = recolor(original, correction);
  // The "AI output" is smaller, slightly blurred (its own re-render) and shifted by a few pixels.
  const ai = await sharp(await png(target))
    .extract({ left: 6, top: 4, width: 628, height: 470 })
    .blur(1.2)
    .resize(1024, Math.round((1024 * 470) / 628))
    .png()
    .toBuffer();

  const { buffer, fit } = await colorLock(await png(original), ai, { format: 'png' });
  const locked = await loadRgb(buffer);

  assert.equal(locked.width, 640);
  assert.ok(fit.metrics.after < fit.metrics.before / 3, `fit ${JSON.stringify(fit.metrics)}`);
  // Colour matches the intended correction...
  assert.ok(meanAbs(locked.data, target.data) < 4, `colour error ${meanAbs(locked.data, target.data)}`);
  // ...and the grain is the original's, not the AI's blur: pixel-level detail survives.
  const detail = (img) => {
    let sum = 0;
    for (let p = 3; p < img.data.length; p += 3) sum += Math.abs(img.data[p + 1] - img.data[p - 2]);
    return sum / (img.data.length / 3);
  };
  assert.ok(detail(locked) > detail(target) * 0.9, `detail ${detail(locked)} vs ${detail(target)}`);
});

test('a change to one colour does not bleed across an edge into its neighbour', async () => {
  const width = 400;
  const height = 300;
  const data = new Uint8Array(width * height * 3);
  // Two halves of equal luminance but different hue: a reddish skin tone and a teal.
  for (let i = 0; i < width * height; i += 1) {
    const left = i % width < width / 2;
    const c = left ? [200, 120, 110] : [84, 157, 150];
    data.set(c, i * 3);
  }
  const original = { data, width, height };
  // Only the red side changes ("faces too red").
  const target = recolor(original, (r, g, b) => (r > 150 ? [178, 128, 118] : [r, g, b]));
  const { buffer } = await colorLock(await png(original), await png(target), { format: 'png' });
  const locked = await loadRgb(buffer);

  const at = (x, y) => Array.from(locked.data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3));
  for (const x of [width / 2 + 1, width / 2 + 4, width - 10]) {
    const [r, g, b] = at(x, height / 2);
    assert.ok(Math.abs(r - 84) <= 3 && Math.abs(g - 157) <= 3 && Math.abs(b - 150) <= 3, `teal at x=${x} became ${r},${g},${b}`);
  }
  const [r] = at(10, height / 2);
  assert.ok(Math.abs(r - 178) <= 4, `red side became ${r}`);
});

test('colorize lock keeps the original lightness exactly and takes the colour from the guide', async () => {
  const { colorizeLock } = await import('./colorize-lock.js');
  const { srgbToLab } = await import('./color.js');
  const colour = scene(640, 480, 11);
  // The "old photo": the same scene in black and white.
  const gray = recolor(colour, (r, g, b) => {
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    return [y, y, y];
  });
  // The "AI colorization": the true colours, re-rendered slightly soft and smaller.
  const ai = await sharp(await png(colour)).blur(1).resize(800, 600).png().toBuffer();

  const { buffer } = await colorizeLock(await png(gray), ai, { format: 'png' });
  const out = await loadRgb(buffer);
  let lightnessError = 0;
  let chromaGain = 0;
  for (let p = 0; p < out.data.length; p += 3 * 97) {
    const [lOut, aOut, bOut] = srgbToLab(out.data[p], out.data[p + 1], out.data[p + 2]);
    const [lGray] = srgbToLab(gray.data[p], gray.data[p + 1], gray.data[p + 2]);
    lightnessError = Math.max(lightnessError, Math.abs(lOut - lGray));
    chromaGain += Math.hypot(aOut, bOut);
  }
  // Out-of-gamut colours get clipped on the way back to RGB, which can nudge L slightly.
  assert.ok(lightnessError < 3, `lightness drifted by ${lightnessError}`);
  assert.ok(chromaGain / (out.data.length / (3 * 97)) > 8, 'output has colour');
});

test('the local correction recovers uneven fading that a global mapping cannot', async () => {
  const original = scene(640, 480, 5);
  // Fading that grows from left to right: the same colour needs a different fix on each side.
  const faded = { ...original, data: new Uint8Array(original.data) };
  for (let y = 0; y < 480; y += 1) {
    for (let x = 0; x < 640; x += 1) {
      const p = (y * 640 + x) * 3;
      const s = x / 640;
      faded.data[p] = Math.min(255, original.data[p] * (1 - 0.3 * s) + 60 * s);
      faded.data[p + 1] = Math.min(255, original.data[p + 1] * (1 - 0.3 * s) + 40 * s);
      faded.data[p + 2] = Math.min(255, original.data[p + 2] * (1 - 0.5 * s) + 20 * s);
    }
  }
  const guide = await png(original);
  const errorOf = async (local) => {
    const { buffer } = await colorLock(await png(faded), guide, { format: 'png', local });
    return meanAbs((await loadRgb(buffer)).data, original.data);
  };
  const global = await errorOf(false);
  const local = await errorOf(true);
  assert.ok(local < global * 0.9, `local ${local.toFixed(2)} vs global ${global.toFixed(2)}`);
});
