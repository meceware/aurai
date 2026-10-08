import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boot } from '@/lib/boot';
import { serverEnv } from '@/lib/config';
import { json, sameOrigin } from '@/lib/http';
import { createImageSession } from '@/lib/image-sessions';
import { isImageMode } from '@/lib/image-tools';
import { MAX_UPLOAD_BYTES, UploadError } from '@/lib/media/ingest';
import { createVideoEditSession, createVideoSession, MAX_VIDEO_UPLOAD_BYTES } from '@/lib/video-sessions';
import { EDIT_NEEDS_HTTPS, videoEditAvailable } from '@/lib/public-media';
import { hit } from '@/lib/rate-limit';
import { requireApiUser, Unauthorized } from '@/lib/session';
import { usedBytes } from '@/lib/storage';

// Not a server action: uploads can be tens of megabytes, and route handlers have no body cap
// (while proxy.js, which would truncate past 10 MB, does not run on /api).
export async function POST(request) {
  if (!sameOrigin(request)) return json({ error: 'Bad origin' }, 403);

  let user;
  try {
    user = await requireApiUser(request);
  } catch (error) {
    if (error instanceof Unauthorized) return json({ error: 'Sign in again.' }, 401);
    throw error;
  }
  boot();

  const limited = hit(`upload:${user.id}`, { limit: 60, windowSeconds: 60 * 60 });
  if (!limited.ok) return json({ error: 'Too many uploads. Try again later.' }, 429, { 'Retry-After': String(limited.retryAfter) });

  // Edit Video takes a video, which may be much larger than a photo; the tool is in the address
  // too, so an oversized body is turned away before it is read.
  const video = new URL(request.url).searchParams.get('mode') === 'edit-video';
  const cap = video ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  const tooLarge = video ? `Videos can be up to ${MAX_VIDEO_UPLOAD_BYTES / 1024 / 1024} MB.` : 'Photos can be up to 30 MB.';
  if (video && !videoEditAvailable()) return json({ error: EDIT_NEEDS_HTTPS }, 403);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > cap + 64 * 1024) return json({ error: tooLarge }, 413);

  let file;
  let mode;
  try {
    const form = await request.formData();
    file = form.get('file');
    mode = form.get('mode');
  } catch {
    return json({ error: 'The upload was interrupted. Try again.' }, 400);
  }
  if (!file || typeof file === 'string') return json({ error: video ? 'Choose a video to upload.' : 'Choose a photo to upload.' }, 400);
  if (file.size > cap || (mode === 'edit-video') !== video) return json({ error: tooLarge }, 413);

  // Originals plus their previews and results take roughly three times the upload.
  const quota = serverEnv().USER_QUOTA_MB * 1024 * 1024;
  if (usedBytes(user.id) + file.size * 3 > quota) {
    return json({ error: 'Your storage is full. Delete some photos from your history to make room.' }, 413);
  }

  // A video is read by ffmpeg from a file, so it waits on disk while it is checked.
  const temp = video ? join(tmpdir(), `aurai-upload-${randomUUID()}`) : null;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    // Animate makes a video session from a photo, Edit Video one from a video; the image tools an image session.
    let id;
    if (video) {
      await writeFile(temp, buffer);
      id = await createVideoEditSession({ userId: user.id, file: temp, filename: file.name });
    } else if (mode === 'animate') {
      id = await createVideoSession({ userId: user.id, buffer, filename: file.name });
    } else {
      id = await createImageSession({ userId: user.id, buffer, filename: file.name, mode: isImageMode(mode) ? mode : null });
    }
    return json({ id }, 201);
  } catch (error) {
    if (error instanceof UploadError) return json({ error: error.message }, 422);
    console.error('[aurai] upload failed', error);
    return json({ error: video ? 'The video could not be saved. Try again.' : 'The photo could not be saved. Try again.' }, 500);
  } finally {
    if (temp) await rm(temp, { force: true });
  }
}
