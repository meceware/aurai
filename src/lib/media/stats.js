import sharp from 'sharp';
import { loadRgb, open } from './image-io.js';

const STATS_EDGE = 512;

const round = (value, digits = 1) => Number(value.toFixed(digits));

function percentile(histogram, total, fraction) {
  let seen = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    seen += histogram[i];
    if (seen >= total * fraction) return i;
  }
  return histogram.length - 1;
}

/**
 * Measurements that tell the model (and the user) what is wrong with the colour before
 * any AI looks at it: exposure, contrast, cast, saturation, and whether it is monochrome.
 */
export async function computeStats(input) {
  const meta = await open(input).metadata();
  const [width, height] = meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  const small = await loadRgb(input, { maxEdge: STATS_EDGE });
  const { data } = small;
  const pixels = data.length / 3;

  const sum = [0, 0, 0];
  const squares = [0, 0, 0];
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  const lumaHistogram = new Uint32Array(256);
  const histogram = [new Uint32Array(64), new Uint32Array(64), new Uint32Array(64)];
  let saturation = 0;
  let rg = 0;
  let yb = 0;
  let rgSquares = 0;
  let ybSquares = 0;
  let chromaSpread = 0;
  let strongRed = 0;

  for (let p = 0; p < data.length; p += 3) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const channels = [r, g, b];
    for (let c = 0; c < 3; c += 1) {
      const v = channels[c];
      sum[c] += v;
      squares[c] += v * v;
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
      histogram[c][v >> 2] += 1;
    }
    lumaHistogram[Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)] += 1;

    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    saturation += hi === 0 ? 0 : (hi - lo) / hi;
    chromaSpread += hi - lo;

    const a = r - g;
    const y = 0.5 * (r + g) - b;
    rg += a;
    yb += y;
    rgSquares += a * a;
    ybSquares += y * y;
    if (r > 1.35 * g && r > 1.35 * b && r > 60) strongRed += 1;
  }

  const mean = sum.map((s) => s / pixels);
  const stdev = squares.map((s, c) => Math.sqrt(Math.max(0, s / pixels - mean[c] ** 2)));
  const rgMean = rg / pixels;
  const ybMean = yb / pixels;
  const colorfulness =
    Math.sqrt(Math.max(0, rgSquares / pixels - rgMean ** 2) + Math.max(0, ybSquares / pixels - ybMean ** 2)) +
    0.3 * Math.hypot(rgMean, ybMean);

  const vips = await sharp(Buffer.from(data.buffer, data.byteOffset, data.length), {
    raw: { width: small.width, height: small.height, channels: 3 },
  }).stats();

  // Monochrome: almost no chroma anywhere. Toned monochrome (sepia, cyanotype) has a cast but
  // still no spread of hues, so it counts too — it needs colorizing, not cast removal.
  const meanSpread = chromaSpread / pixels;
  const grayscale = meanSpread < 6 || (colorfulness < 12 && meanSpread < 18);

  return {
    width,
    height,
    megapixels: round((width * height) / 1e6),
    orientation: width > height * 1.02 ? 'landscape' : height > width * 1.02 ? 'portrait' : 'square',
    mean: mean.map((v) => round(v)),
    stdev: stdev.map((v) => round(v)),
    min,
    max,
    luma: {
      p1: percentile(lumaHistogram, pixels, 0.01),
      p50: percentile(lumaHistogram, pixels, 0.5),
      p99: percentile(lumaHistogram, pixels, 0.99),
      shadowsClipped: round((100 * (lumaHistogram[0] + lumaHistogram[1] + lumaHistogram[2] + lumaHistogram[3])) / pixels),
      highlightsClipped: round((100 * (lumaHistogram[252] + lumaHistogram[253] + lumaHistogram[254] + lumaHistogram[255])) / pixels),
    },
    cast: { redVsGreen: round(mean[0] / Math.max(1, mean[1]), 3), blueVsGreen: round(mean[2] / Math.max(1, mean[1]), 3) },
    saturation: round(saturation / pixels, 3),
    colorfulness: round(colorfulness),
    strongRedPercent: round((100 * strongRed) / pixels),
    grayscale,
    entropy: round(vips.entropy, 2),
    sharpness: round(vips.sharpness, 2),
    dominant: vips.dominant,
    histogram: histogram.map((h) => Array.from(h)),
  };
}

function level(value, bands) {
  for (const [limit, label] of bands) if (value < limit) return label;
  return bands.at(-1)[1];
}

/** Compact, plain-language summary for prompts. Numbers stay in so the model can weigh them. */
export function describeStats(stats) {
  const lines = [];
  lines.push(`Size ${stats.width}×${stats.height} (${stats.orientation}, ${stats.megapixels} MP).`);

  const brightness = level(stats.luma.p50, [
    [50, 'very dark'],
    [90, 'dark'],
    [170, 'normal'],
    [210, 'bright'],
    [256, 'very bright'],
  ]);
  lines.push(
    `Exposure: median luminance ${stats.luma.p50}/255 (${brightness}); ${stats.luma.shadowsClipped}% crushed shadows, ${stats.luma.highlightsClipped}% blown highlights.`,
  );

  const range = stats.luma.p99 - stats.luma.p1;
  lines.push(
    `Contrast: luminance spans ${stats.luma.p1}–${stats.luma.p99} (${level(range, [
      [120, 'low, faded'],
      [190, 'moderate'],
      [256, 'normal'],
    ])}).`,
  );

  if (stats.grayscale) {
    lines.push('Color: monochrome (black-and-white or toned).');
  } else {
    const red = Math.round((stats.cast.redVsGreen - 1) * 100);
    const blue = Math.round((stats.cast.blueVsGreen - 1) * 100);
    const sign = (v) => (v > 0 ? `+${v}` : `${v}`);
    const warmth = red > 8 && blue < -8 ? 'warm/yellow-orange cast' : red < -8 && blue > 8 ? 'cool/blue cast' : blue < -12 ? 'yellow cast' : red > 12 ? 'red/magenta cast' : stats.cast.redVsGreen < 0.92 && stats.cast.blueVsGreen < 0.95 ? 'green cast' : 'roughly neutral';
    lines.push(`Color balance vs green: red ${sign(red)}%, blue ${sign(blue)}% (${warmth}).`);
    lines.push(
      `Saturation ${stats.saturation} (${level(stats.saturation, [
        [0.15, 'washed out'],
        [0.45, 'moderate'],
        [1.01, 'high'],
      ])}), colorfulness ${stats.colorfulness}; ${stats.strongRedPercent}% of pixels are strongly red.`,
    );
  }
  return lines.join('\n');
}
