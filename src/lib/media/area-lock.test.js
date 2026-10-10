import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { areaLock, checkedMask, markedPhoto } from './area-lock.js';
import { loadRgb } from './image-io.js';

const W = 480;
const H = 360;

/** A smooth scene with a "face" on the left; `cap` adds a bright red cap, `face` brightens the face. */
function scene({ tint = [0, 0, 0], face = 0, cap = false, shift = 0 } = {}) {
  const data = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const p = (y * W + x) * 3;
      const sx = x - shift;
      const inFace = (sx - 140) ** 2 + (y - 200) ** 2 < 60 ** 2;
      // The cap: a box from 300 to 400 across, 100 to 160 down; the paint covers it only to 380.
      const inCap = cap && sx >= 300 && sx < 400 && y >= 100 && y < 160;
      const base = inCap ? [200, 40, 50] : [90 + sx / 6, 110 + y / 8, 130 - sx / 10].map((v) => v + (inFace ? 40 + face : 0));
      for (let c = 0; c < 3; c += 1) data[p + c] = Math.max(0, Math.min(255, base[c] + tint[c]));
    }
  }
  return data;
}

const png = (data, width = W, height = H) => sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();

/** White where painted: a box over most of the cap, as a person paints it, a little short. */
function paint({ width = W, height = H } = {}) {
  const data = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ox = (x / width) * W;
      const oy = (y / height) * H;
      if (ox >= 296 && ox < 380 && oy >= 96 && oy < 164) data[y * width + x] = 255;
    }
  }
  return sharp(data, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

const at = (image, x, y) => [0, 1, 2].map((c) => image.data[(y * image.width + x) * 3 + c]);
const distance = (a, b) => Math.max(...a.map((v, c) => Math.abs(v - b[c])));

test('a painted edit takes the AI only in the painted area and what it drew next to it, in the photo’s light', async () => {
  const photo = await png(scene());
  // The model drew the cap, a bit past the paint, but also tinted the whole photo and redrew the
  // face brighter, and shifted everything by two pixels.
  const tint = [18, 0, -12];
  const ai = await png(scene({ tint, face: 10, cap: true, shift: 2 }));
  // Painted at another size than the photo, as the browser sends it.
  const result = await areaLock(photo, ai, await paint({ width: 240, height: 180 }), { format: 'png' });
  const out = await loadRgb(result.buffer);
  const before = { data: scene(), width: W, height: H };

  assert.equal(out.width, W);
  // The cap is there, inside the paint and in the part past it, without the AI's tint.
  for (const [x, y] of [[320, 130], [360, 110], [392, 130], [396, 150]]) {
    assert.ok(distance(at(out, x, y), [200, 40, 50]) <= 12, `cap at ${x},${y}: ${at(out, x, y)}`);
  }
  // Everywhere else the photo is untouched: not the tint, not the brighter face.
  for (const [x, y] of [[20, 20], [140, 200], [460, 340], [420, 60], [300, 250]]) {
    assert.ok(distance(at(out, x, y), at(before, x, y)) <= 2, `kept at ${x},${y}: ${at(out, x, y)} vs ${at(before, x, y)}`);
  }
  assert.ok(result.fit.area > 0.03 && result.fit.area < 0.08, `area ${result.fit.area}`);
});

test('the model is shown the photo with the painted area tinted red', async () => {
  const marked = await loadRgb(await markedPhoto(await png(scene()), await paint()));
  const [r, g] = at(marked, 340, 130);
  assert.ok(r > 150 && g < 80, `tinted: ${at(marked, 340, 130)}`);
  assert.ok(distance(at(marked, 100, 300), at({ data: scene(), width: W, height: H }, 100, 300)) <= 6, 'untinted outside');
});

test('a painted area must be a PNG with something painted on it', async () => {
  assert.ok(await checkedMask(await paint()));
  assert.equal(await checkedMask(await sharp(Buffer.alloc(64 * 64), { raw: { width: 64, height: 64, channels: 1 } }).png().toBuffer()), null);
  assert.equal(await checkedMask(await sharp(await paint()).jpeg().toBuffer()), null);
});
