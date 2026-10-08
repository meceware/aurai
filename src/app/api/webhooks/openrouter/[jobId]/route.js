import { boot } from '@/lib/boot';
import { verifyToken } from '@/lib/crypto';

/**
 * OpenRouter calls this when a video job finishes. The call is only a nudge: nothing in it is
 * trusted. With a valid per-job signature the job is checked now, with the person's own key,
 * instead of at its next scheduled look.
 */
export async function POST(request, { params }) {
  const { jobId } = await params;
  const token = new URL(request.url).searchParams.get('t');
  if (!/^[0-9a-f-]{36}$/.test(jobId) || !verifyToken('video-webhook', jobId, token)) return new Response(null, { status: 404 });
  boot().videoRunner.nudge(jobId);
  return new Response(null, { status: 204 });
}
