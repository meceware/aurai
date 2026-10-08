import { boot } from '@/lib/boot';
import { json } from '@/lib/http';
import { sessionRunStatuses } from '@/lib/image-sessions';
import { MAX_BATCH_PHOTOS } from '@/lib/image-tools';
import { requireApiUser, Unauthorized } from '@/lib/session';
import { videoJobStatuses } from '@/lib/video-sessions';

/**
 * Run (or video job) statuses for one session — or, for the screen that starts several photos
 * together, for each of them — polled by the page while anything is in progress.
 */
export async function GET(request) {
  let user;
  try {
    user = await requireApiUser(request);
  } catch (error) {
    if (error instanceof Unauthorized) return json({ error: 'Unauthorized' }, 401);
    throw error;
  }
  boot();

  const params = new URL(request.url).searchParams;
  const video = params.get('video');
  if (video) return json({ jobs: videoJobStatuses(user.id, video) });
  const sessions = params.get('sessions');
  if (sessions) return json({ runs: sessions.split(',').slice(0, MAX_BATCH_PHOTOS).flatMap((id) => sessionRunStatuses(user.id, id)) });
  const session = params.get('session');
  if (!session) return json({ runs: [] });
  return json({ runs: sessionRunStatuses(user.id, session) });
}
