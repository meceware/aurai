import { fileResponse } from '@/lib/file-response';
import { ownedAsset, SANDBOX_HEADERS } from '@/lib/media-access';

// Asset bytes never change for a given id, so the browser may keep them for good — but only
// privately, since every file belongs to one signed-in user. The sandboxing headers make sure
// a file is only ever treated as the media type the server detected, never as a page.
// Downloads with a format, quality or Local adjustments go through ./download instead.
const BASE_HEADERS = {
  ...SANDBOX_HEADERS,
  'Cache-Control': 'private, max-age=31536000, immutable',
  'Accept-Ranges': 'bytes',
};

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/tiff': 'tif', 'video/mp4': 'mp4' };

export async function GET(request, { params }) {
  const { asset, response } = await ownedAsset(request, (await params).id);
  if (response) return response;

  const url = new URL(request.url);
  const headers = new Headers({ ...BASE_HEADERS, 'Content-Type': asset.mime, ETag: `"${asset.id}"` });
  if (url.searchParams.has('download')) {
    const name = (url.searchParams.get('name') || `aurai-${asset.kind}`).replace(/[^\w.-]+/g, '_').slice(0, 80);
    headers.set('Content-Disposition', `attachment; filename="${name}.${EXTENSIONS[asset.mime] ?? 'bin'}"`);
  }

  if (request.headers.get('if-none-match') === `"${asset.id}"`) return new Response(null, { status: 304, headers });
  return fileResponse(request, asset, headers);
}
