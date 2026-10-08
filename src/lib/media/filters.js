// Fast float filters for the colour locks. Box means use running sums, so their cost does not
// grow with the radius; the guided filter is He et al.'s edge-preserving smoother.

/** Mean over a (2r+1)² window, clamped at the borders. O(width × height). */
export function boxMean(field, width, height, radius) {
  const tmp = new Float32Array(field.length);
  const out = new Float32Array(field.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -radius; x <= radius; x += 1) sum += field[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / (2 * radius + 1);
      sum += field[row + Math.min(width - 1, x + radius + 1)] - field[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -radius; y <= radius; y += 1) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / (2 * radius + 1);
      sum += tmp[Math.min(height - 1, y + radius + 1) * width + x] - tmp[Math.max(0, y - radius) * width + x];
    }
  }
  return out;
}

/**
 * Guided filter: smooths `input` while snapping its edges to the edges of `guide`. Used to make
 * an AI render's colour follow the original photo's own outlines exactly.
 */
export function guidedFilter(guide, input, width, height, radius, epsilon) {
  const n = guide.length;
  const meanI = boxMean(guide, width, height, radius);
  const meanP = boxMean(input, width, height, radius);
  const ip = new Float32Array(n);
  const ii = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    ip[i] = guide[i] * input[i];
    ii[i] = guide[i] * guide[i];
  }
  const meanIP = boxMean(ip, width, height, radius);
  const meanII = boxMean(ii, width, height, radius);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const variance = meanII[i] - meanI[i] * meanI[i];
    a[i] = (meanIP[i] - meanI[i] * meanP[i]) / (variance + epsilon);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxMean(a, width, height, radius);
  const meanB = boxMean(b, width, height, radius);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = meanA[i] * guide[i] + meanB[i];
  return out;
}

/** Fills masked-out samples from their neighbourhood (normalised convolution). */
export function fillMasked(field, mask, width, height, radius) {
  const weighted = new Float32Array(field.length);
  const weights = new Float32Array(field.length);
  for (let i = 0; i < field.length; i += 1) {
    weights[i] = mask[i];
    weighted[i] = mask[i] ? field[i] : 0;
  }
  const num = boxMean(weighted, width, height, radius);
  const den = boxMean(weights, width, height, radius);
  const out = new Float32Array(field.length);
  for (let i = 0; i < field.length; i += 1) out[i] = mask[i] ? field[i] : den[i] > 1e-4 ? num[i] / den[i] : 0;
  return out;
}
