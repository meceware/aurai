import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ownedAsset, previewOf, SANDBOX_HEADERS, sourceOf } from '@/lib/media-access';
import { isNeutral, mixImages, readDials } from '@/lib/media/mix';
import { absolutePath } from '@/lib/storage';

/**
 * Preview of a Local result with the Color / Brightness / Exposure dials applied, at display size.
 * The same dials always give the same image, so the browser may keep it.
 */
export async function GET(request, { params }) {
  const { asset, response } = await ownedAsset(request, (await params).id);
  if (response) return response;
  if (asset.kind !== 'locked') return new Response('Not found', { status: 404 });

  const dials = readDials(new URL(request.url).searchParams);
  const source = sourceOf(asset);
  if (!source) return new Response('Not found', { status: 404 });
  const base = previewOf(source.id) ?? source;
  const top = previewOf(asset.id) ?? asset;

  let body;
  if (isNeutral(dials)) {
    body = await readFile(absolutePath(top.path));
  } else {
    const mixed = await mixImages(await readFile(absolutePath(base.path)), await readFile(absolutePath(top.path)), { ...dials, maxEdge: 2560 });
    body = await sharp(Buffer.from(mixed.data.buffer, mixed.data.byteOffset, mixed.data.length), {
      raw: { width: mixed.width, height: mixed.height, channels: 3 },
    })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  }
  return new Response(body, {
    headers: { ...SANDBOX_HEADERS, 'Content-Type': 'image/jpeg', 'Content-Length': String(body.length), 'Cache-Control': 'private, max-age=86400' },
  });
}
