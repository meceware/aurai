import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { loadRgb, loadRgbExact } from './image-io.js';
import { repairLock } from './repair-lock.js';
import { detailLock, enlarged, resizeOnly } from './upscale-lock.js';

const W = 480;
const H = 360;

/** A smooth scene with a "face": the clean photo before any damage. */
function scene({ faceShift = 0, tint = [0, 0, 0] } = {}) {
  const data = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const p = (y * W + x) * 3;
      const face = (x - 240) ** 2 + (y - 170) ** 2 < 70 ** 2;
      const base = [90 + x / 6, 110 + y / 8, 130 - x / 10];
      for (let c = 0; c < 3; c += 1) data[p + c] = Math.max(0, Math.min(255, base[c] + (face ? 40 + faceShift : 0) + tint[c]));
    }
  }
  return data;
}

const png = (data, width = W, height = H) => sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer();

/** The clean scene with a scratch (a bright line) and dust (dark specks). */
function damaged() {
  const data = scene();
  for (let x = 40; x < 440; x += 1) {
    const y = 60 + Math.round(x / 8);
    for (let t = 0; t < 2; t += 1) for (let c = 0; c < 3; c += 1) data[((y + t) * W + x) * 3 + c] = 245;
  }
  for (const [x, y] of [[100, 300], [380, 80], [420, 320]]) {
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) for (let c = 0; c < 3; c += 1) data[((y + dy) * W + x + dx) * 3 + c] = 15;
  }
  return data;
}

const at = (image, x, y) => [0, 1, 2].map((c) => image.data[(y * image.width + x) * 3 + c]);
const distance = (a, b) => Math.max(...a.map((v, c) => Math.abs(v - b[c])));

test('repair takes the AI only where it fixed damage, in the photo’s own tones', async () => {
  const original = await png(damaged());
  // The AI removed the damage, but also tinted everything and redrew the face a little brighter.
  const ai = await png(scene({ faceShift: 8, tint: [18, 0, -10] }));
  const result = await repairLock(original, ai, { format: 'png' });
  const out = await loadRgb(result.buffer);
  const clean = { data: scene(), width: W, height: H };
  const before = { data: damaged(), width: W, height: H };

  assert.equal(out.width, W);
  // The scratch and the dust are gone, replaced with what the scene had there.
  for (const [x, y] of [[200, 85], [320, 100], [100, 300], [380, 80]]) {
    assert.ok(distance(at(out, x, y), at(clean, x, y)) <= 12, `repaired at ${x},${y}: ${at(out, x, y)} vs ${at(clean, x, y)}`);
  }
  // Away from the damage the photo is untouched: not the AI's tint, not its brighter face.
  for (const [x, y] of [[20, 20], [240, 170], [460, 340], [250, 200]]) {
    assert.ok(distance(at(out, x, y), at(before, x, y)) <= 2, `kept at ${x},${y}`);
  }
  assert.ok(result.fit.repaired > 0 && result.fit.repaired < 0.05, `repaired share ${result.fit.repaired}`);
});

test('upscale keeps the photo’s shapes and colors, and takes only finer detail from the AI', async () => {
  const small = await png(scene(), W, H);
  // The AI's 4× render: the scene with fine texture the photo never had, and a color drift.
  const big = await enlarged(small, W * 4, H * 4);
  for (let i = 0; i < big.data.length; i += 3) {
    const pixel = i / 3;
    const grain = ((pixel * 2654435761) >>> 0) % 21 - 10;
    big.data[i] = Math.min(255, big.data[i] + grain);
    big.data[i + 1] = Math.min(255, big.data[i + 1] + grain);
    big.data[i + 2] = Math.min(255, Math.max(0, big.data[i + 2] + grain + 25));
  }
  const ai = await png(Buffer.from(big.data), W * 4, H * 4);
  const result = await detailLock(small, ai, { format: 'png' });
  assert.equal(result.width, W * 4);
  assert.equal(result.height, H * 4);

  // Smoothed, the result is the original enlarged — the AI's blue drift is not in it.
  const blur = async (input) => loadRgbExact(await sharp(input).blur(6).png().toBuffer(), W, H);
  const outLow = await blur(result.buffer);
  const baseLow = await blur(await png(Buffer.from((await enlarged(small, W * 4, H * 4)).data), W * 4, H * 4));
  let worst = 0;
  for (let i = 0; i < outLow.data.length; i += 1) worst = Math.max(worst, Math.abs(outLow.data[i] - baseLow.data[i]));
  assert.ok(worst <= 6, `low frequencies follow the original (worst ${worst})`);

  // And the fine texture is there.
  const out = await loadRgb(result.buffer);
  let texture = 0;
  for (let x = 1000; x < 1100; x += 1) texture += Math.abs(out.data[(800 * out.width + x) * 3] - out.data[(800 * out.width + x + 1) * 3]);
  assert.ok(texture / 100 > 3, `fine detail added (${texture / 100})`);
});

test('resize only enlarges, at most four times, inventing nothing', async () => {
  const small = await png(scene(), W, H);
  const result = await resizeOnly(small, 4096);
  assert.equal(result.width, W * 4);
  const tooSmallTarget = await resizeOnly(small, 960);
  assert.equal(tooSmallTarget.width, 960);
});
