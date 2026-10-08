// In-place radix-2 FFT on split real/imaginary arrays. Sizes are always powers of two here:
// the alignment code pads into square canvases it chooses itself.

function fft1d(re, im, offset, stride, n, inverse) {
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = offset + i * stride;
      const b = offset + j * stride;
      [re[a], re[b]] = [re[b], re[a]];
      [im[a], im[b]] = [im[b], im[a]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = offset + (i + k) * stride;
        const b = offset + (i + k + len / 2) * stride;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** 2D FFT over an n×n row-major grid. The inverse is scaled by 1/n². */
export function fft2d(re, im, n, inverse = false) {
  for (let row = 0; row < n; row += 1) fft1d(re, im, row * n, 1, n, inverse);
  for (let col = 0; col < n; col += 1) fft1d(re, im, col, n, n, inverse);

  if (inverse) {
    const scale = 1 / (n * n);
    for (let i = 0; i < re.length; i += 1) {
      re[i] *= scale;
      im[i] *= scale;
    }
  }
}
