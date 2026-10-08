import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { parseRange } from './http-range.js';
import { absolutePath } from './storage.js';

/**
 * A stored file as a response, with byte ranges (which video players and downloaders ask for).
 * `headers` are sent as they are, with the length and range added; HEAD gets them without the body.
 */
export async function fileResponse(request, asset, headers) {
  let size;
  try {
    size = (await stat(absolutePath(asset.path))).size;
  } catch {
    return new Response('Not found', { status: 404 });
  }

  const range = parseRange(request.headers.get('range'), size);
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? size - 1;
  headers.set('Content-Length', String(end - start + 1));
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });

  const stream = Readable.toWeb(createReadStream(absolutePath(asset.path), { start, end }));
  return new Response(stream, { status: range ? 206 : 200, headers });
}
