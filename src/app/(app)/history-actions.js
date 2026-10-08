'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { setImageSessionDone } from '@/lib/image-sessions';
import { requireUser } from '@/lib/session';
import { setVideoSessionDone } from '@/lib/video-sessions';

const doneSchema = z.object({ kind: z.enum(['image', 'video']), sessionId: z.string().uuid(), done: z.boolean() });

/** Marks a photo or video as done, or back in progress. Only ever the person's own. */
export async function setDone(input) {
  const user = await requireUser();
  const parsed = doneSchema.safeParse(input);
  if (!parsed.success) return { error: 'Not found.' };
  const { kind, sessionId, done } = parsed.data;
  const changed = kind === 'video' ? setVideoSessionDone(user.id, sessionId, done) : setImageSessionDone(user.id, sessionId, done);
  if (!changed) return { error: 'Not found.' };
  revalidatePath('/', 'layout');
  return { ok: true };
}
