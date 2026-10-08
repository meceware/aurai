import exifReader from 'exif-reader';
import sharp from 'sharp';

// Results carry the original's capture details — when and with what camera — so they sort and
// date correctly in photo libraries. Location (GPS) is never copied, and orientation is left
// out because every output is already stored upright.

const pad = (n) => String(n).padStart(2, '0');
// exif-reader returns capture times as Dates holding the camera's local time in UTC fields.
const exifDate = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime())
    ? `${value.getUTCFullYear()}:${pad(value.getUTCMonth() + 1)}:${pad(value.getUTCDate())} ${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`
    : null;
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null);

/** sharp `withExif` tags for an output made from this original, or null when it has none. */
export async function exifFor(originalBytes) {
  let tags;
  try {
    const { exif } = await sharp(originalBytes).metadata();
    if (!exif) return null;
    tags = exifReader(exif);
  } catch {
    return null;
  }
  const image = tags.Image ?? {};
  const photo = tags.Photo ?? {};

  const ifd0 = Object.fromEntries(
    Object.entries({
      Make: text(image.Make),
      Model: text(image.Model),
      Artist: text(image.Artist),
      Copyright: text(image.Copyright),
      ImageDescription: text(image.ImageDescription),
      DateTime: exifDate(image.DateTime),
      Software: 'Aurai',
    }).filter(([, value]) => value),
  );
  const ifd2 = Object.fromEntries(
    Object.entries({
      DateTimeOriginal: exifDate(photo.DateTimeOriginal),
      DateTimeDigitized: exifDate(photo.DateTimeDigitized),
      LensModel: text(photo.LensModel),
    }).filter(([, value]) => value),
  );
  return { IFD0: ifd0, ...(Object.keys(ifd2).length ? { IFD2: ifd2 } : {}) };
}

/** Encodes raw or decoded pixels as JPEG/PNG, tagged sRGB, with the given EXIF. */
export function encodeWithExif(pipeline, { mime, quality = 95, exif }) {
  let image = pipeline.withIccProfile('srgb');
  if (exif) image = image.withExif(exif);
  return mime === 'image/png' ? image.png().toBuffer() : image.jpeg({ quality, chromaSubsampling: quality >= 90 ? '4:4:4' : '4:2:0', mozjpeg: true }).toBuffer();
}
