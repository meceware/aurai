import { boot } from '@/lib/boot';
import { fileResponse } from '@/lib/file-response';
import { SANDBOX_HEADERS } from '@/lib/media-access';
import { linkedVideo } from '@/lib/public-media';

// The one way in without signing in: the video of an edit OpenRouter is working on, by the link
// made for that edit (see lib/public-media.js). It opens nothing else, and stops opening once
// the edit is done. Not cached, not indexed; every fetch is logged.
export async function GET(request, { params }) {
  boot();
  const linked = linkedVideo((await params).token);
  if (!linked) return new Response('Not found', { status: 404 });
  console.info(`[aurai] edit video ${linked.job.id} fetched by OpenRouter (${request.method}${request.headers.get('range') ? `, ${request.headers.get('range')}` : ''})`);
  const headers = new Headers({
    ...SANDBOX_HEADERS,
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'Accept-Ranges': 'bytes',
    'Content-Type': linked.asset.mime,
  });
  return fileResponse(request, linked.asset, headers);
}

export const HEAD = GET;
