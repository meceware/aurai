import { boxBlur, estimateAlignment, gradientMagnitude, warpToGrid } from './align.js';
import { encodeRgb, loadRgb, luminance } from './image-io.js';

// The colour transform is fitted on a ~512 px copy (cheap, and plenty of samples) and then
// applied to every pixel of the full-resolution original. Because the result is a pure
// function of each original pixel's own colour, nothing about the image's structure —
// faces, edges, texture, grain — can change, and nothing can halo across an edge.

export const FIT_EDGE = 512;
export const LUT_SIZE = 17;

function solve(matrix, rhs, n) {
  // Gaussian elimination with partial pivoting on an n×n system with several right-hand sides.
  const a = matrix.map((row) => [...row]);
  const b = rhs.map((row) => [...row]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let row = col + 1; row < n; row += 1) {
      const f = a[row][col] / a[col][col];
      for (let k = col; k < n; k += 1) a[row][k] -= f * a[col][k];
      for (let k = 0; k < b[row].length; k += 1) b[row][k] -= f * b[col][k];
    }
  }
  const x = Array.from({ length: n }, () => new Array(b[0].length).fill(0));
  for (let row = n - 1; row >= 0; row -= 1) {
    for (let k = 0; k < b[0].length; k += 1) {
      let sum = b[row][k];
      for (let j = row + 1; j < n; j += 1) sum -= a[row][j] * x[j][k];
      x[row][k] = sum / a[row][row];
    }
  }
  return x;
}

/**
 * Per-pixel trust for the fit. Flat areas count most: a small misalignment there changes
 * nothing, while at edges it pairs one object's colour with its neighbour's. Pixels whose
 * structure disagrees (the model drew something different) and clipped pixels are dropped.
 */
function pairWeights(original, aligned) {
  const { width, height } = original;
  const go = boxBlur(gradientMagnitude(luminance(original), width, height), width, height, 1);
  const ga = boxBlur(gradientMagnitude(luminance(aligned), width, height), width, height, 1);

  let mean = 0;
  for (let i = 0; i < go.length; i += 1) mean += go[i];
  const sigma = (2 * mean) / go.length + 1;

  const weights = new Float32Array(width * height);
  for (let i = 0, p = 0; i < weights.length; i += 1, p += 3) {
    if (!aligned.mask[i]) continue;
    const r = original.data[p];
    const g = original.data[p + 1];
    const b = original.data[p + 2];
    if (Math.max(r, g, b) >= 254 || Math.min(r, g, b) <= 1) continue;
    const flat = Math.exp(-(go[i] + ga[i]) / (2 * sigma));
    const agree = Math.exp(-Math.abs(go[i] - ga[i]) / sigma);
    weights[i] = flat * agree;
  }
  return { weights, go, ga };
}

function fitAffine(original, aligned, weights) {
  const n = weights.length;
  // Huber-weighted least squares, re-weighted a few times so outliers stop steering the fit.
  let robust = new Float32Array(n).fill(1);
  let m = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 0, 0],
  ];

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const xtx = Array.from({ length: 4 }, () => new Array(4).fill(0));
    const xty = Array.from({ length: 4 }, () => new Array(3).fill(0));
    let total = 0;

    for (let i = 0, p = 0; i < n; i += 1, p += 3) {
      const w = weights[i] * robust[i];
      if (w <= 0) continue;
      const x = [original.data[p] / 255, original.data[p + 1] / 255, original.data[p + 2] / 255, 1];
      const y = [aligned.data[p] / 255, aligned.data[p + 1] / 255, aligned.data[p + 2] / 255];
      for (let r = 0; r < 4; r += 1) {
        for (let c = 0; c < 4; c += 1) xtx[r][c] += w * x[r] * x[c];
        for (let c = 0; c < 3; c += 1) xty[r][c] += w * x[r] * y[c];
      }
      total += w;
    }
    if (total === 0) break;

    // A light ridge towards identity keeps the fit sane when the samples are all one colour.
    const ridge = 1e-3 * total;
    for (let d = 0; d < 4; d += 1) {
      xtx[d][d] += ridge;
      for (let c = 0; c < 3; c += 1) xty[d][c] += ridge * (d === c ? 1 : 0);
    }
    m = solve(xtx, xty, 4);

    const delta = 0.05;
    robust = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i += 1, p += 3) {
      if (weights[i] <= 0) continue;
      let err = 0;
      for (let c = 0; c < 3; c += 1) {
        const pred =
          (m[0][c] * original.data[p]) / 255 + (m[1][c] * original.data[p + 1]) / 255 + (m[2][c] * original.data[p + 2]) / 255 + m[3][c];
        err += (pred - aligned.data[p + c] / 255) ** 2;
      }
      err = Math.sqrt(err);
      robust[i] = err <= delta ? 1 : delta / err;
    }
  }
  return { m, robust };
}

const affineAt = (m, r, g, b, c) => m[0][c] * r + m[1][c] * g + m[2][c] * b + m[3][c];

/**
 * Smooth correction on top of the affine part: residuals are splatted onto a 17³ grid and
 * relaxed so that empty regions of colour space inherit their neighbours' correction.
 */
function fitResidualLut(original, aligned, weights, robust, m, size) {
  const nodes = size ** 3;
  const sumW = new Float64Array(nodes);
  const sumR = new Float64Array(nodes * 3);
  const step = size - 1;

  for (let i = 0, p = 0; i < weights.length; i += 1, p += 3) {
    const w = weights[i] * robust[i];
    if (w <= 0) continue;
    const r = original.data[p] / 255;
    const g = original.data[p + 1] / 255;
    const b = original.data[p + 2] / 255;
    const residual = [0, 1, 2].map((c) => aligned.data[p + c] / 255 - affineAt(m, r, g, b, c));

    const fr = r * step;
    const fg = g * step;
    const fb = b * step;
    const r0 = Math.min(step - 1, Math.floor(fr));
    const g0 = Math.min(step - 1, Math.floor(fg));
    const b0 = Math.min(step - 1, Math.floor(fb));
    const dr = fr - r0;
    const dg = fg - g0;
    const db = fb - b0;

    for (let corner = 0; corner < 8; corner += 1) {
      const cr = corner & 1;
      const cg = (corner >> 1) & 1;
      const cb = (corner >> 2) & 1;
      const t = (cr ? dr : 1 - dr) * (cg ? dg : 1 - dg) * (cb ? db : 1 - db) * w;
      if (t === 0) continue;
      const node = ((b0 + cb) * size + (g0 + cg)) * size + (r0 + cr);
      sumW[node] += t;
      for (let c = 0; c < 3; c += 1) sumR[node * 3 + c] += t * residual[c];
    }
  }

  let occupied = 0;
  let meanW = 0;
  for (let i = 0; i < nodes; i += 1) {
    if (sumW[i] > 0) {
      occupied += 1;
      meanW += sumW[i];
    }
  }
  meanW = occupied ? meanW / occupied : 1;
  const lambda = 0.25 * meanW;

  let values = new Float64Array(nodes * 3);
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const next = new Float64Array(nodes * 3);
    for (let bi = 0; bi < size; bi += 1) {
      for (let gi = 0; gi < size; gi += 1) {
        for (let ri = 0; ri < size; ri += 1) {
          const node = (bi * size + gi) * size + ri;
          const neighbours = [];
          if (ri > 0) neighbours.push(node - 1);
          if (ri < step) neighbours.push(node + 1);
          if (gi > 0) neighbours.push(node - size);
          if (gi < step) neighbours.push(node + size);
          if (bi > 0) neighbours.push(node - size * size);
          if (bi < step) neighbours.push(node + size * size);
          for (let c = 0; c < 3; c += 1) {
            let sum = 0;
            for (const other of neighbours) sum += values[other * 3 + c];
            next[node * 3 + c] = (sumR[node * 3 + c] + lambda * sum) / (sumW[node] + lambda * neighbours.length);
          }
        }
      }
    }
    values = next;
  }

  // Bake affine + residual into one table of 0..255 outputs.
  const lut = new Float32Array(nodes * 3);
  for (let bi = 0; bi < size; bi += 1) {
    for (let gi = 0; gi < size; gi += 1) {
      for (let ri = 0; ri < size; ri += 1) {
        const node = (bi * size + gi) * size + ri;
        for (let c = 0; c < 3; c += 1) {
          const v = affineAt(m, ri / step, gi / step, bi / step, c) + values[node * 3 + c];
          lut[node * 3 + c] = Math.min(255, Math.max(0, v * 255));
        }
      }
    }
  }
  return lut;
}

/** Trilinear lookup, in row strips so a 24 MP image does not hold the event loop for seconds. */
export async function applyLut({ data, width, height }, lut, size = LUT_SIZE) {
  const out = new Uint8Array(data.length);
  const step = size - 1;
  const scale = step / 255;
  const rowsPerStrip = Math.max(1, Math.floor(2_000_000 / width));

  for (let startRow = 0; startRow < height; startRow += rowsPerStrip) {
    const end = Math.min(height, startRow + rowsPerStrip) * width * 3;
    for (let p = startRow * width * 3; p < end; p += 3) {
      const fr = data[p] * scale;
      const fg = data[p + 1] * scale;
      const fb = data[p + 2] * scale;
      const r0 = fr >= step ? step - 1 : fr | 0;
      const g0 = fg >= step ? step - 1 : fg | 0;
      const b0 = fb >= step ? step - 1 : fb | 0;
      const dr = fr - r0;
      const dg = fg - g0;
      const db = fb - b0;
      const n000 = ((b0 * size + g0) * size + r0) * 3;
      const n100 = n000 + 3;
      const n010 = n000 + size * 3;
      const n110 = n010 + 3;
      const n001 = n000 + size * size * 3;
      const n101 = n001 + 3;
      const n011 = n001 + size * 3;
      const n111 = n011 + 3;
      for (let c = 0; c < 3; c += 1) {
        const c00 = lut[n000 + c] + (lut[n100 + c] - lut[n000 + c]) * dr;
        const c10 = lut[n010 + c] + (lut[n110 + c] - lut[n010 + c]) * dr;
        const c01 = lut[n001 + c] + (lut[n101 + c] - lut[n001 + c]) * dr;
        const c11 = lut[n011 + c] + (lut[n111 + c] - lut[n011 + c]) * dr;
        const c0 = c00 + (c10 - c00) * dg;
        const c1 = c01 + (c11 - c01) * dg;
        out[p + c] = c0 + (c1 - c0) * db + 0.5;
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { data: out, width, height };
}

// Local correction: what the global table still gets wrong, as a smooth function of position
// and brightness — a coarse grid (about 16 cells on the long side × 8 luminance bins). Separate
// brightness bins keep a correction for a bright face from leaking into a dark coat beside it.
const GRID_LONG = 16;
const GRID_LUMA = 8;

function gridShape(width, height) {
  const gx = width >= height ? GRID_LONG : Math.max(4, Math.round((GRID_LONG * width) / height));
  const gy = height >= width ? GRID_LONG : Math.max(4, Math.round((GRID_LONG * height) / width));
  return { gx, gy, gl: GRID_LUMA };
}

const luma = (data, p) => 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];

function fitLocalGrid(original, aligned, globalPreview, weights, robust) {
  const { width, height } = original;
  const shape = gridShape(width, height);
  const { gx, gy, gl } = shape;
  const cells = gx * gy * gl;
  const sumW = new Float64Array(cells);
  const sumR = new Float64Array(cells * 3);

  for (let y = 0; y < height; y += 1) {
    const fyCell = (y / Math.max(1, height - 1)) * (gy - 1);
    const y0 = Math.min(gy - 2, Math.floor(fyCell));
    const dy = fyCell - y0;
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const w = weights[i] * robust[i];
      if (w <= 0) continue;
      const p = i * 3;
      const fxCell = (x / Math.max(1, width - 1)) * (gx - 1);
      const x0 = Math.min(gx - 2, Math.floor(fxCell));
      const dx = fxCell - x0;
      const flCell = (luma(original.data, p) / 255) * (gl - 1);
      const l0 = Math.min(gl - 2, Math.floor(flCell));
      const dl = flCell - l0;
      const residual = [0, 1, 2].map((c) => aligned.data[p + c] - globalPreview.data[p + c]);
      for (let corner = 0; corner < 8; corner += 1) {
        const cx = corner & 1;
        const cy = (corner >> 1) & 1;
        const cl = (corner >> 2) & 1;
        const t = (cx ? dx : 1 - dx) * (cy ? dy : 1 - dy) * (cl ? dl : 1 - dl) * w;
        if (t === 0) continue;
        const cell = ((l0 + cl) * gy + (y0 + cy)) * gx + (x0 + cx);
        sumW[cell] += t;
        for (let c = 0; c < 3; c += 1) sumR[cell * 3 + c] += t * residual[c];
      }
    }
  }

  let meanW = 0;
  let occupied = 0;
  for (let i = 0; i < cells; i += 1) {
    if (sumW[i] > 0) {
      meanW += sumW[i];
      occupied += 1;
    }
  }
  meanW = occupied ? meanW / occupied : 1;
  // Cells with little evidence are pulled towards no correction, and every cell towards its
  // neighbours, so the field stays smooth and conservative.
  const prior = 0.5 * meanW;
  const smooth = 0.5 * meanW;
  let values = new Float64Array(cells * 3);
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const next = new Float64Array(cells * 3);
    for (let l = 0; l < gl; l += 1) {
      for (let y = 0; y < gy; y += 1) {
        for (let x = 0; x < gx; x += 1) {
          const cell = (l * gy + y) * gx + x;
          const neighbours = [];
          if (x > 0) neighbours.push(cell - 1);
          if (x < gx - 1) neighbours.push(cell + 1);
          if (y > 0) neighbours.push(cell - gx);
          if (y < gy - 1) neighbours.push(cell + gx);
          if (l > 0) neighbours.push(cell - gx * gy);
          if (l < gl - 1) neighbours.push(cell + gx * gy);
          for (let c = 0; c < 3; c += 1) {
            let sum = 0;
            for (const other of neighbours) sum += values[other * 3 + c];
            next[cell * 3 + c] = (sumR[cell * 3 + c] + smooth * sum) / (sumW[cell] + prior + smooth * neighbours.length);
          }
        }
      }
    }
    values = next;
  }
  return { ...shape, values: Float32Array.from(values) };
}

/** Adds the local correction to an already globally corrected image (both packed RGB). */
async function applyLocalGrid(source, corrected, grid) {
  const { width, height } = source;
  const { gx, gy, gl, values } = grid;
  const rowsPerStrip = Math.max(1, Math.floor(1_000_000 / width));
  for (let startRow = 0; startRow < height; startRow += rowsPerStrip) {
    const endRow = Math.min(height, startRow + rowsPerStrip);
    for (let y = startRow; y < endRow; y += 1) {
      const fyCell = (y / Math.max(1, height - 1)) * (gy - 1);
      const y0 = Math.min(gy - 2, fyCell | 0);
      const dy = fyCell - y0;
      for (let x = 0; x < width; x += 1) {
        const fxCell = (x / Math.max(1, width - 1)) * (gx - 1);
        const x0 = Math.min(gx - 2, fxCell | 0);
        const dx = fxCell - x0;
        const p = (y * width + x) * 3;
        const flCell = (luma(source.data, p) / 255) * (gl - 1);
        const l0 = Math.min(gl - 2, flCell | 0);
        const dl = flCell - l0;
        for (let c = 0; c < 3; c += 1) {
          let v = 0;
          for (let corner = 0; corner < 8; corner += 1) {
            const cx = corner & 1;
            const cy = (corner >> 1) & 1;
            const cl = (corner >> 2) & 1;
            const t = (cx ? dx : 1 - dx) * (cy ? dy : 1 - dy) * (cl ? dl : 1 - dl);
            v += t * values[(((l0 + cl) * gy + (y0 + cy)) * gx + (x0 + cx)) * 3 + c];
          }
          const out = corrected.data[p + c] + v;
          corrected.data[p + c] = out < 0 ? 0 : out > 255 ? 255 : out + 0.5;
        }
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return corrected;
}

function weightedMeanAbs(a, b, weights) {
  let sum = 0;
  let total = 0;
  for (let i = 0, p = 0; i < weights.length; i += 1, p += 3) {
    const w = weights[i];
    if (w <= 0) continue;
    sum += w * (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2])) / 3;
    total += w;
  }
  return total ? sum / total : 0;
}

/** Pearson correlation of gradient maps over the aligned region: 1 means identical structure. */
export function structureScore(go, ga, mask) {
  let n = 0;
  let so = 0;
  let sa = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    so += go[i];
    sa += ga[i];
    n += 1;
  }
  if (n < 16) return 0;
  const mo = so / n;
  const ma = sa / n;
  let cov = 0;
  let vo = 0;
  let va = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    cov += (go[i] - mo) * (ga[i] - ma);
    vo += (go[i] - mo) ** 2;
    va += (ga[i] - ma) ** 2;
  }
  return cov / Math.sqrt(vo * va || 1);
}

/**
 * Same low-pass on both sides of every pair. AI outputs are smoother than the originals they
 * came from (grain and noise get re-rendered away), and regressing a smooth target on a noisy
 * input shrinks the fitted slope, which would flatten the original's contrast.
 */
function blurRgb({ data, width, height, ...rest }, radius) {
  const out = new Uint8Array(data.length);
  const channel = new Float32Array(width * height);
  for (let c = 0; c < 3; c += 1) {
    for (let i = 0; i < channel.length; i += 1) channel[i] = data[i * 3 + c];
    const blurred = boxBlur(channel, width, height, radius);
    for (let i = 0; i < channel.length; i += 1) out[i * 3 + c] = blurred[i] + 0.5;
  }
  return { ...rest, data: out, width, height };
}

const PAIR_BLUR = 2;

/** Drops mask pixels within `radius` of the AI image's border, where the blur mixes in empty space. */
function erode(mask, width, height, radius) {
  const out = new Uint8Array(mask.length);
  for (let y = radius; y < height - radius; y += 1) {
    for (let x = radius; x < width - radius; x += 1) {
      let keep = 1;
      for (let dy = -radius; dy <= radius && keep; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (!mask[(y + dy) * width + x + dx]) {
            keep = 0;
            break;
          }
        }
      }
      out[y * width + x] = keep;
    }
  }
  return out;
}

/** Fits the colour transform that takes the original towards the AI output. */
export async function fitColorTransform(originalInput, aiInput, { size = LUT_SIZE, local = false } = {}) {
  const map = await estimateAlignment(originalInput, aiInput);
  const original = blurRgb(await loadRgb(originalInput, { maxEdge: FIT_EDGE }), PAIR_BLUR);
  const warped = await warpToGrid(aiInput, map, original);
  const aligned = blurRgb({ ...warped, mask: erode(warped.mask, warped.width, warped.height, PAIR_BLUR + 1) }, PAIR_BLUR);
  const { weights, go, ga } = pairWeights(original, aligned);
  const { m, robust } = fitAffine(original, aligned, weights);
  const lut = fitResidualLut(original, aligned, weights, robust, m, size);

  let preview = await applyLut(original, lut, size);
  const grid = local ? fitLocalGrid(original, aligned, preview, weights, robust) : null;
  if (grid) preview = await applyLocalGrid(original, preview, grid);
  let coverage = 0;
  for (let i = 0; i < aligned.mask.length; i += 1) coverage += aligned.mask[i];

  return {
    lut,
    size,
    grid,
    affine: m,
    map,
    metrics: {
      // Mean absolute RGB difference to the AI output on trusted pixels, before and after.
      before: weightedMeanAbs(original.data, aligned.data, weights),
      after: weightedMeanAbs(preview.data, aligned.data, weights),
      coverage: coverage / aligned.mask.length,
      structure: structureScore(go, ga, aligned.mask),
    },
  };
}

/**
 * How much of the original's structure an AI render kept (1 = identical edges), for renders
 * locked by a path that does not compute it as a by-product (the colorize lock).
 */
export async function structureOf(originalInput, aiInput, map) {
  const original = await loadRgb(originalInput, { maxEdge: FIT_EDGE });
  const warped = await warpToGrid(aiInput, map, original);
  const mask = erode(warped.mask, warped.width, warped.height, PAIR_BLUR + 1);
  const gradient = (image) => boxBlur(gradientMagnitude(luminance(image), image.width, image.height), image.width, image.height, 1);
  return structureScore(gradient(blurRgb(original, PAIR_BLUR)), gradient(blurRgb(warped, PAIR_BLUR)), mask);
}

/**
 * Original pixels, AI colours. `local` adds the smooth position-and-brightness correction on top
 * of the global table. Returns the encoded full-resolution image and the fit.
 */
export async function colorLock(originalInput, aiInput, { format = 'jpeg', local = false, exif = null } = {}) {
  const fit = await fitColorTransform(originalInput, aiInput, { local });
  const full = await loadRgb(originalInput);
  let locked = await applyLut(full, fit.lut, fit.size);
  if (fit.grid) locked = await applyLocalGrid(full, locked, fit.grid);
  return { buffer: await encodeRgb(locked, format, { exif }), width: full.width, height: full.height, fit };
}
