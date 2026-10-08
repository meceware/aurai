import sharp from 'sharp';

// Bounds decompression bombs. 50 MP covers any real camera or flatbed scan this app expects.
export const MAX_INPUT_PIXELS = 50_000_000;

/** Every decode goes through here so orientation and colour space are always normalised. */
export function open(input) {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' }).rotate().toColourspace('srgb');
}

/**
 * Decodes to packed 8-bit RGB. With `maxEdge`, the image is shrunk to fit inside that box
 * first, never enlarged.
 */
export async function loadRgb(input, { maxEdge } = {}) {
  let pipeline = open(input);
  if (maxEdge) pipeline = pipeline.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });

  const { data, info } = await pipeline.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

/** Exact-size decode, used to bring an AI output onto the original's pixel grid. */
export async function loadRgbExact(input, width, height) {
  const { data, info } = await open(input)
    .resize({ width, height, fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

export function encodeRgb({ data, width, height }, format = 'jpeg', { exif, ...options } = {}) {
  let pipeline = sharp(Buffer.from(data.buffer, data.byteOffset, data.length), {
    raw: { width, height, channels: 3 },
  }).withIccProfile('srgb');
  if (exif) pipeline = pipeline.withExif(exif);
  if (format === 'png') return pipeline.png(options).toBuffer();
  if (format === 'webp') return pipeline.webp({ quality: 90, ...options }).toBuffer();
  return pipeline.jpeg({ quality: 95, chromaSubsampling: '4:4:4', ...options }).toBuffer();
}

/**
 * What gets sent to OpenRouter as an input reference: capped at 2048 px and JPEG q90.
 * Larger uploads only add request size; edit models re-render at their own resolution.
 */
export async function toDataUrl(input, { maxEdge = 2048, quality = 90 } = {}) {
  const buffer = await open(input)
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

/** Rec. 709 luma on 0..255 values, as a Float32Array. */
export function luminance({ data, width, height }) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += 3) {
    out[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  return out;
}
