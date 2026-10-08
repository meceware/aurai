'use server';

import { readFile } from 'node:fs/promises';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assetFor } from '@/lib/assets';
import { boot } from '@/lib/boot';
import { serverEnv } from '@/lib/config';
import { prepared } from '@/lib/db';
import { getRun } from '@/lib/image-sessions';
import { UploadError } from '@/lib/media/ingest';
import { mixToJpeg } from '@/lib/media/mix';
import { getPrefs, savePrefs } from '@/lib/preferences';
import { MOTION_PRESETS } from '@/lib/prompts/defaults';
import { EDIT_NEEDS_HTTPS, videoEditAvailable } from '@/lib/public-media';
import { hit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/session';
import { getUserSettings } from '@/lib/settings';
import { absolutePath, usedBytes } from '@/lib/storage';
import { videoEditProfiles, videoProfiles } from '@/lib/video-options';
import { DURATIONS, LOCAL_MOTION, planClip, VIDEO_TARGETS } from '@/lib/video-pricing';
import {
  ACTIVE,
  createVideoEditSession,
  createVideoJobs,
  createVideoSession,
  editJobs,
  deleteVideoJob,
  deleteVideoSession,
  frameFor,
  getVideoJob,
  getVideoSession,
  VIDEO_TOOLS,
  videoJobStatuses,
} from '@/lib/video-sessions';

const MAX_COMPARE = 4;

const startSchema = z.object({
  sessionId: z.string().uuid(),
  models: z.array(z.string().max(160)).min(1, 'Pick a model.').max(MAX_COMPARE, `Compare up to ${MAX_COMPARE} at a time.`),
  preset: z.string().refine((key) => Object.hasOwn(MOTION_PRESETS, key), 'Pick a motion.'),
  instruction: z
    .string()
    .trim()
    .max(300, 'Keep the request under 300 characters.')
    .optional()
    .transform((v) => v || null),
  resolution: z.enum(VIDEO_TARGETS),
  duration: z.number().refine((value) => DURATIONS.includes(value), 'Pick a length.'),
  audio: z.boolean().default(false),
  parentJobId: z.string().uuid().optional().nullable(),
});

/** The page a session lives on, in its own tool. */
const pageOf = (userId, sessionId) => `${VIDEO_TOOLS[getVideoSession(userId, sessionId)?.tool] ?? VIDEO_TOOLS.animate}/${sessionId}`;

function problemFor(userId, { needsKey }) {
  if (needsKey && !serverEnv().OPENROUTER_MOCK && !getUserSettings(userId).hasKey) return 'Add your OpenRouter key in Settings first, or use Ken Burns, which is free.';
  if (!hit(`video-run:${userId}`, { limit: 40, windowSeconds: 60 * 60 }).ok) return 'You have started a lot of videos in the last hour. Try again later.';
  if (usedBytes(userId) >= serverEnv().USER_QUOTA_MB * 1024 * 1024) return 'Your storage is full. Delete some videos or photos first.';
  return null;
}

/**
 * Queues one clip per chosen model, all from the same photo and settings — several at once make
 * a comparison. Each model gets the size, length and shape nearest to what was asked that it
 * supports; the first frame is the photo itself, cut to that shape.
 */
export async function startVideo(input) {
  const user = await requireUser();
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { sessionId, models, preset, instruction, resolution, duration, audio, parentJobId } = parsed.data;

  const prefs = getPrefs(user.id);
  const unique = [...new Set(models)];
  if (unique.some((id) => id !== LOCAL_MOTION && !prefs.videoModels.includes(id))) return { error: 'Pick one of your video models.' };
  const session = getVideoSession(user.id, sessionId);
  if (!session || session.tool !== 'animate') return { error: 'Photo not found.' };
  const source = assetFor(user.id, session.source_asset_id);
  if (!source) return { error: 'The photo for this video is gone.' };
  if (parentJobId && getVideoJob(user.id, parentJobId)?.session_id !== sessionId) return { error: 'That clip is gone.' };

  const problem = problemFor(user.id, { needsKey: unique.some((id) => id !== LOCAL_MOTION) });
  if (problem) return { error: problem };

  const motion = MOTION_PRESETS[preset];
  const jobs = [];
  for (const profile of videoProfiles(unique)) {
    const clip = planClip(profile, { target: resolution, duration, audio, width: source.width, height: source.height });
    // A model starts on the view the move starts on, cut from the photo, so the prompt and the
    // picture agree; with the anchored ending, and a model that takes a last frame, it ends on
    // the view the move ends on too. Ken Burns draws the whole move from the photo itself.
    const anchor = !profile.local && prefs.videoAnchor && profile.lastFrame;
    const frameAssetId = await frameFor(user.id, sessionId, clip.aspect, profile.local ? null : motion.camera.from);
    const lastFrameAssetId = anchor ? await frameFor(user.id, sessionId, clip.aspect, motion.camera.to) : null;
    jobs.push({
      model: profile.id,
      preset,
      instruction,
      frameAssetId,
      params: {
        resolution: clip.resolution,
        duration: clip.duration,
        aspect: clip.aspect,
        audio: clip.audio,
        audioOption: profile.audio,
        anchor: Boolean(anchor),
        lastFrameAssetId,
        estimate: clip.cost,
      },
    });
  }
  savePrefs(user.id, { lastVideo: { models: unique, preset, resolution, duration, audio } });

  const ids = createVideoJobs({ userId: user.id, sessionId, jobs, parentJobId: parentJobId ?? null });
  boot().videoRunner.wake();
  revalidatePath(`/animate/${sessionId}`);
  return { ids };
}

const editSchema = z.object({
  sessionId: z.string().uuid(),
  models: z.array(z.string().max(160)).min(1, 'Pick a model.').max(MAX_COMPARE, `Compare up to ${MAX_COMPARE} at a time.`),
  instruction: z.string().trim().min(1, 'Describe the change to make.').max(600, 'Keep the request under 600 characters.'),
  resolution: z.enum(VIDEO_TARGETS),
  parentJobId: z.string().uuid().optional().nullable(),
});

/** Edit Video: queues one clip per chosen model, each changing the session's video as asked (see editJobs). */
export async function startVideoEdit(input) {
  const user = await requireUser();
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { sessionId, models, instruction, resolution, parentJobId } = parsed.data;

  const session = getVideoSession(user.id, sessionId);
  if (!session || session.tool !== 'edit') return { error: 'Video not found.' };
  const source = assetFor(user.id, session.source_asset_id);
  if (!source) return { error: 'The video is gone.' };
  if (parentJobId && getVideoJob(user.id, parentJobId)?.session_id !== sessionId) return { error: 'That clip is gone.' };
  const unique = [...new Set(models)];
  if (unique.some((id) => !getPrefs(user.id).editModels.includes(id))) return { error: 'Pick one of your Edit Video models.' };
  const offered = new Map(videoEditProfiles(unique).map((profile) => [profile.id, profile]));
  const problem = problemFor(user.id, { needsKey: true });
  if (problem) return { error: problem };
  if (!videoEditAvailable()) return { error: EDIT_NEEDS_HTTPS };

  const jobs = editJobs({ source, profiles: unique.map((id) => offered.get(id)), resolution, instruction });
  savePrefs(user.id, { lastEdit: { models: unique, resolution } });

  const ids = createVideoJobs({ userId: user.id, sessionId, jobs, parentJobId: parentJobId ?? null });
  boot().videoRunner.wake();
  revalidatePath(`/edit-video/${sessionId}`);
  return { ids };
}

/** The same clip again — same model, motion, text and settings — for a different take. */
export async function retryVideo(jobId) {
  const user = await requireUser();
  const job = getVideoJob(user.id, String(jobId));
  if (!job) return { error: 'Clip not found.' };
  // Clips from options that were tried and removed (depth parallax) cannot be made again.
  if (job.model.startsWith('local/') && job.model !== LOCAL_MOTION) return { error: 'That way of making a clip is no longer offered. Try Ken Burns or an AI model.' };
  if (job.preset && !Object.hasOwn(MOTION_PRESETS, job.preset)) return { error: 'That motion is no longer offered. Pick another one in the composer.' };
  const problem = problemFor(user.id, { needsKey: job.model !== LOCAL_MOTION });
  if (problem) return { error: problem };
  createVideoJobs({
    userId: user.id,
    sessionId: job.session_id,
    parentJobId: job.id,
    jobs: [{ model: job.model, preset: job.preset, instruction: job.instruction, frameAssetId: job.frame_asset_id, params: JSON.parse(job.params_json || '{}') }],
  });
  boot().videoRunner.wake();
  revalidatePath(pageOf(user.id, job.session_id));
  return { ok: true };
}

/** Stops waiting for a clip. OpenRouter has no way to cancel, so it may still finish and be billed. */
export async function stopWaiting(jobId) {
  const user = await requireUser();
  const job = getVideoJob(user.id, String(jobId));
  if (!job) return { error: 'Clip not found.' };
  if (!ACTIVE.includes(job.status)) return { ok: true };
  prepared("UPDATE video_jobs SET status = 'abandoned', poll_after = NULL, error = 'You stopped waiting for this clip.' WHERE id = ?").run(job.id);
  boot().videoRunner.abort(job.id);
  revalidatePath(pageOf(user.id, job.session_id));
  return { ok: true };
}

export async function removeVideoJob(jobId) {
  const user = await requireUser();
  const job = getVideoJob(user.id, String(jobId));
  if (!job) return { error: 'Clip not found.' };
  boot().videoRunner.abort(job.id);
  await deleteVideoJob(user.id, job.id);
  revalidatePath(pageOf(user.id, job.session_id));
  return { ok: true };
}

export async function removeVideoSession(sessionId) {
  const user = await requireUser();
  const id = String(sessionId);
  const { videoRunner } = boot();
  const tool = getVideoSession(user.id, id)?.tool;
  for (const job of videoJobStatuses(user.id, id)) videoRunner.abort(job.id);
  await deleteVideoSession(user.id, id);
  revalidatePath('/', 'layout');
  redirect(VIDEO_TOOLS[tool] ?? VIDEO_TOOLS.animate);
}

const animateSchema = z.object({
  runId: z.string().uuid(),
  version: z.enum(['locked', 'ai']),
  dials: z.object({ color: z.number().min(0).max(1), light: z.number().min(0).max(1), ev: z.number().min(-1).max(1) }).optional(),
});

/**
 * Starts a video from an image result, exactly as it is shown: the Local version with its
 * Color / Brightness / Exposure settings, or the AI redraw.
 */
export async function animateResult(input) {
  const user = await requireUser();
  const parsed = animateSchema.safeParse(input);
  if (!parsed.success) return { error: 'That result cannot be animated.' };
  const { runId, version, dials } = parsed.data;
  const run = getRun(user.id, runId);
  const asset = assetFor(user.id, version === 'ai' ? run?.ai_asset_id : run?.locked_asset_id);
  if (!run || run.status !== 'succeeded' || !asset) return { error: 'That result is no longer available.' };
  if (usedBytes(user.id) >= serverEnv().USER_QUOTA_MB * 1024 * 1024) return { error: 'Your storage is full. Delete something first.' };

  let buffer = await readFile(absolutePath(asset.path));
  const adjusted = version === 'locked' && dials && (dials.color !== 1 || dials.light !== 1 || dials.ev !== 0);
  if (adjusted) {
    const session = prepared('SELECT source_asset_id FROM image_sessions WHERE id = ?').get(run.session_id);
    const original = assetFor(user.id, session?.source_asset_id);
    if (original) {
      buffer = await mixToJpeg(await readFile(absolutePath(original.path)), buffer, dials);
    }
  }
  const title = prepared('SELECT title FROM image_sessions WHERE id = ?').get(run.session_id)?.title ?? null;
  const id = await createVideoSession({ userId: user.id, buffer, filename: `${title ?? 'photo'}.jpg`, title, fromImageRunId: run.id });
  revalidatePath('/', 'layout');
  redirect(`/animate/${id}`);
}

/**
 * Opens a finished clip in Edit Video, as a new video there — a clip from Animate to change by a
 * prompt, or an edit to edit further. The clip itself stays where it is.
 */
export async function editClip(jobId) {
  const user = await requireUser();
  const job = getVideoJob(user.id, String(jobId));
  const video = assetFor(user.id, job?.video_asset_id);
  if (!job || job.status !== 'completed' || !video) return { error: 'That clip is no longer available.' };
  if (usedBytes(user.id) >= serverEnv().USER_QUOTA_MB * 1024 * 1024) return { error: 'Your storage is full. Delete something first.' };
  const title = getVideoSession(user.id, job.session_id)?.title ?? 'clip';
  let id;
  try {
    id = await createVideoEditSession({ userId: user.id, file: absolutePath(video.path), filename: `${title}.mp4` });
  } catch (error) {
    if (error instanceof UploadError) return { error: error.message };
    throw error;
  }
  revalidatePath('/', 'layout');
  redirect(`/edit-video/${id}`);
}
