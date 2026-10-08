import assert from 'node:assert/strict';
import test from 'node:test';
import { isNeutral, mixRgb, readDials } from './mix.js';

const image = (pixels) => ({ data: Uint8Array.from(pixels.flat()), width: pixels.length, height: 1 });
const linear = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// CIE L*, the lightness the dials keep.
const lightness = ([r, g, b]) => 116 * Math.cbrt(0.2126729 * linear(r) + 0.7151522 * linear(g) + 0.072175 * linear(b)) - 16;
const pixel = (img, i) => Array.from(img.data.slice(i * 3, i * 3 + 3));
const close = (actual, expected, tolerance = 2) =>
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) <= tolerance, `${actual} vs ${expected}`));

// A reddish, dark original and a correction that neutralized it and brightened it.
const original = image([[150, 90, 80], [60, 40, 35]]);
const corrected = image([[190, 160, 150], [95, 85, 80]]);

test('full dials give the correction and zero dials give the original', async () => {
  const full = await mixRgb(original, corrected, { color: 1, light: 1, ev: 0 });
  close(pixel(full, 0), [190, 160, 150]);
  close(pixel(full, 1), [95, 85, 80]);
  const none = await mixRgb(original, corrected, { color: 0, light: 0, ev: 0 });
  close(pixel(none, 0), [150, 90, 80]);
});

test('color without light takes the correction’s color at the original’s brightness', async () => {
  const mixed = await mixRgb(original, corrected, { color: 1, light: 0, ev: 0 });
  for (const i of [0, 1]) {
    // Lightness stays the original's (within rounding), while the red cast is gone.
    assert.ok(Math.abs(lightness(pixel(mixed, i)) - lightness(pixel(original, i))) < 1, `L* ${lightness(pixel(mixed, i))}`);
    const [r, g] = pixel(mixed, i);
    const [or, og] = pixel(original, i);
    assert.ok(r - g < or - og);
  }
});

test('exposure brightens and darkens in stops', async () => {
  const up = await mixRgb(original, corrected, { color: 1, light: 1, ev: 1 });
  const down = await mixRgb(original, corrected, { color: 1, light: 1, ev: -1 });
  assert.ok(luma(pixel(up, 1)) > luma(pixel(corrected, 1)) + 20);
  assert.ok(luma(pixel(down, 1)) < luma(pixel(corrected, 1)) - 15);
});

test('dials from a query are clamped and default to no change', () => {
  assert.deepEqual(readDials(new URLSearchParams('')), { color: 1, light: 1, ev: 0 });
  assert.ok(isNeutral(readDials(new URLSearchParams('color=abc'))));
  assert.deepEqual(readDials(new URLSearchParams('color=2&light=-1&ev=5')), { color: 1, light: 0, ev: 1 });
});
