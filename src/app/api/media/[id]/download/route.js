import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ownedAsset, SANDBOX_HEADERS, sourceOf } from '@/lib/media-access';
import { encodeWithExif, exifFor } from '@/lib/media/exif';
import { isNeutral, mixImages, readDials } from '@/lib/media/mix';
import { absolutePath } from '@/lib/storage';

// Maximum is what the Local result is stored at; asking for it unchanged returns the stored file.
const QUALITIES = { max: 95, high: 90, medium: 80, small: 70 };
const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif' };

/**
 * A result as a file: JPEG at a chosen quality or PNG, with the Local dials applied, carrying the
 * original's date and camera (never its location). Originals download exactly as uploaded.
 */
export async function GET(request, { params }) {
  const { asset, response } = await ownedAsset(request, (await params).id);
  if (response) return response;

  const url = new URL(request.url);
  const name = (url.searchParams.get('name') || `aurai-${asset.kind}`).replace(/[^\w.-]+/g, '_').slice(0, 80);
  const send = (body, mime) =>
    new Response(body, {
      headers: {
        ...SANDBOX_HEADERS,
        'Content-Type': mime,
        'Content-Length': String(body.length),
        'Content-Disposition': `attachment; filename="${name}.${EXTENSIONS[mime] ?? 'bin'}"`,
        'Cache-Control': 'private, no-store',
      },
    });

  const stored = await readFile(absolutePath(asset.path));
  if (asset.kind === 'source') return send(stored, asset.mime);
  if (asset.kind !== 'locked' && asset.kind !== 'ai') return new Response('Not found', { status: 404 });

  const mime = url.searchParams.get('format') === 'png' ? 'image/png' : 'image/jpeg';
  const quality = QUALITIES[url.searchParams.get('quality')] ?? QUALITIES.max;
  const dials = asset.kind === 'locked' ? readDials(url.searchParams) : { color: 1, light: 1, ev: 0 };
  const source = sourceOf(asset);
  const originalBytes = source ? await readFile(absolutePath(source.path)) : null;
  const exif = originalBytes ? await exifFor(originalBytes) : null;

  // The stored Local file already is maximum quality with its EXIF; nothing to redo.
  if (asset.kind === 'locked' && isNeutral(dials) && mime === asset.mime && quality === QUALITIES.max) return send(stored, mime);

  let pipeline;
  if (asset.kind === 'locked' && !isNeutral(dials) && originalBytes) {
    const mixed = await mixImages(originalBytes, stored, dials);
    pipeline = sharp(Buffer.from(mixed.data.buffer, mixed.data.byteOffset, mixed.data.length), {
      raw: { width: mixed.width, height: mixed.height, channels: 3 },
    });
  } else {
    pipeline = sharp(stored).removeAlpha();
  }
  return send(await encodeWithExif(pipeline, { mime, quality, exif }), mime);
}
