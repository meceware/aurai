import sharp from 'sharp';
import { MAX_INPUT_PIXELS, open } from './image-io.js';

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
export const PREVIEW_EDGE = 2560;
export const THUMB_EDGE = 384;
const MIN_EDGE = 64;

export class UploadError extends Error {}

const FORMATS = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
  tiff: { mime: 'image/tiff', ext: 'tif' },
};

/**
 * Decides whether an upload is a still photo this app can work with, from its bytes — never
 * from the file name or the type the browser claims. Returns the format and oriented size.
 */
export async function inspectUpload(buffer) {
  if (!buffer?.length) throw new UploadError('The file is empty.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new UploadError('Photos can be up to 30 MB.');

  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new UploadError('This file is not an image Aurai can read.');
  }

  if (meta.format === 'heif') {
    throw new UploadError(
      meta.compression === 'av1'
        ? 'AVIF photos are not supported yet. Please upload a JPEG, PNG or WebP.'
        : 'HEIC photos are not supported. On iPhone, choose "Most Compatible" in Camera › Formats, or upload from the Photos picker, which converts to JPEG.',
    );
  }
  const format = FORMATS[meta.format];
  if (!format) throw new UploadError('Please upload a JPEG, PNG, WebP or TIFF photo.');
  if ((meta.pages ?? 1) > 1) throw new UploadError('Animated or multi-page images are not supported.');
  if (meta.width * meta.height > MAX_INPUT_PIXELS) throw new UploadError('This photo is larger than 50 megapixels.');

  const [width, height] = meta.orientation >= 5 ? [meta.height, meta.width] : [meta.width, meta.height];
  if (Math.min(width, height) < MIN_EDGE) throw new UploadError('This photo is too small to work with.');

  return { ...format, format: meta.format, width, height };
}

/** Display-size JPEG in sRGB, for the browser. Never enlarged. */
export async function renderPreview(input, edge = PREVIEW_EDGE) {
  const { data, info } = await open(input)
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, mime: 'image/jpeg', ext: 'jpg' };
}

export async function renderThumb(input) {
  const { data, info } = await open(input)
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'cover', position: 'attention' })
    .webp({ quality: 78 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, mime: 'image/webp', ext: 'webp' };
}
