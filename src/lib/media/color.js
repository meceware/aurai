// sRGB ↔ CIE L*a*b* (D65), on 0..255 values. Used to measure colour error the way people see
// it, and by the colorize lock, which keeps the original's lightness and takes only a*b*.

const toLinear = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
const WHITE = [0.95047, 1, 1.08883];

export function srgbToLab(r, g, b) {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / WHITE[0]);
  const y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B);
  const z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / WHITE[2]);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function labToSrgb(L, a, bb) {
  const fy = (L + 16) / 116;
  const X = WHITE[0] * fInv(fy + a / 500);
  const Y = fInv(fy);
  const Z = WHITE[2] * fInv(fy - bb / 200);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  return [
    clamp(fromLinear(3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z)),
    clamp(fromLinear(-0.969266 * X + 1.8760108 * Y + 0.041556 * Z)),
    clamp(fromLinear(0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z)),
  ];
}

/** Mean CIE76 ΔE between two packed RGB images of the same size, optionally masked. */
export function meanDeltaE(a, b, mask) {
  let sum = 0;
  let count = 0;
  for (let i = 0, p = 0; p < a.length; i += 1, p += 3) {
    if (mask && !mask[i]) continue;
    const [l1, a1, b1] = srgbToLab(a[p], a[p + 1], a[p + 2]);
    const [l2, a2, b2] = srgbToLab(b[p], b[p + 1], b[p + 2]);
    sum += Math.hypot(l1 - l2, a1 - a2, b1 - b2);
    count += 1;
  }
  return count ? sum / count : 0;
}
