'use server';

import { readFile } from 'node:fs/promises';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assetFor } from '@/lib/assets';
import { boot } from '@/lib/boot';
import {
  createImageRun,
  createImageSession,
  deleteImageRun,
  deleteImageSession,
  getRun,
  ownsImageSession,
  sessionRunStatuses,
  setImageSessionMode,
} from '@/lib/image-sessions';
import { isImageMode, MAX_BATCH_PHOTOS, toolFor } from '@/lib/image-tools';
import { prepared } from '@/lib/db';
import { imageCatalog } from '@/lib/catalog';
import { edgeOf, LOCAL_RESIZE, MODEL_ID, qualitiesOf, resolutionFor, targetResolution } from '@/lib/model-options';
import { getPrefs } from '@/lib/preferences';
import { hit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/session';
import { getUserSettings } from '@/lib/settings';
import { serverEnv } from '@/lib/config';
import { UploadError } from '@/lib/media/ingest';
import { isNeutral, mixToJpeg } from '@/lib/media/mix';
import { absolutePath, usedBytes } from '@/lib/storage';

const runSchema = z.object({
  sessionId: z.string().uuid(),
  model: z.string().regex(MODEL_ID, 'Pick one of your models.').max(120),
  instruction: z
    .string()
    .trim()
    .max(500, 'Keep the request under 500 characters.')
    .optional()
    .transform((v) => v || null),
  parentRunId: z.string().uuid().optional().nullable(),
  // For a refinement: which version of the result it starts from, and the Local dials it was set to.
  from: z.enum(['locked', 'ai']).optional(),
  dials: z.object({ color: z.number().min(0).max(1), light: z.number().min(0).max(1), ev: z.number().min(-1).max(1) }).optional(),
});

/**
 * What a run is started with: the chosen model, the person's defaults, and the resolution the AI
 * redraw will be asked for (the photo's size, capped by Settings) — fixed now, so the price shown
 * before starting is the price of the run.
 */
async function runParams(prefs, mode, modelId, sessionId, refine = null) {
  const source = prepared(
    'SELECT a.width, a.height FROM assets a JOIN image_sessions s ON s.source_asset_id = a.id WHERE s.id = ?',
  ).get(sessionId);
  // Upscale asks for the most the model draws; the other tools for the photo's own size.
  const target = mode === 'upscale' ? '4K' : targetResolution(Math.max(source?.width ?? 1024, source?.height ?? 1024), prefs.maxResolution);
  const entry = (await imageCatalog()).get(modelId) ?? { id: modelId };
  const quality = prefs.qualities[modelId];
  return {
    mode,
    quality: qualitiesOf(entry).includes(quality) ? quality : null,
    resolution: resolutionFor(entry, target),
    // The analysis looks for color problems, which only Enhance and Colorize correct.
    analysis: COLOR_TOOLS.includes(mode) && prefs.analysis,
    analysisModel: prefs.analysisModel,
    lock: prefs.lock,
    // A refinement edits the version the person was looking at. The result is still locked
    // against the original photo, so its Local version keeps the original's detail either way.
    from: refine?.from === 'ai' ? 'ai' : 'locked',
    dials: refine?.from !== 'ai' && refine?.dials && (refine.dials.color !== 1 || refine.dials.light !== 1 || refine.dials.ev !== 0) ? refine.dials : null,
  };
}

const COLOR_TOOLS = ['enhance', 'colorize'];

function canRun(userId, { local = false } = {}) {
  if (!local && !serverEnv().OPENROUTER_MOCK && !getUserSettings(userId).hasKey) return 'Add your OpenRouter key in Settings first.';
  if (!hit(`image-run:${userId}`, { limit: 60, windowSeconds: 60 * 60 }).ok) return 'You have started a lot of runs in the last hour. Try again later.';
  return null;
}

/**
 * Why this model cannot be started in this tool, or null: only models the person picked in
 * Settings — and in Upscale, the free resize, or a model that draws at 2K or more.
 */
async function modelProblem(prefs, mode, model) {
  const local = mode === 'upscale' && model === LOCAL_RESIZE;
  if (!local && !prefs.enabledModels.includes(model)) return 'Pick one of your models.';
  if (mode === 'upscale' && !local) {
    const entry = (await imageCatalog()).get(model);
    if (!(edgeOf(resolutionFor(entry, '4K')) >= edgeOf('2K'))) return 'This model draws no larger than 1K, so it cannot upscale. Pick another one.';
  }
  return null;
}

export async function startRun(input) {
  const user = await requireUser();
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { sessionId, model, instruction, parentRunId, from, dials } = parsed.data;
  if (!ownsImageSession(user.id, sessionId)) return { error: 'Photo not found.' };
  // The tool decides the mode: everything in an Enhance session is enhanced, and so on.
  const mode = prepared('SELECT mode FROM image_sessions WHERE id = ?').get(sessionId).mode;
  const prefs = getPrefs(user.id);
  const local = mode === 'upscale' && model === LOCAL_RESIZE;
  const unusable = await modelProblem(prefs, mode, model);
  if (unusable) return { error: unusable };

  let parent = null;
  if (parentRunId) {
    parent = getRun(user.id, parentRunId);
    if (!parent || parent.session_id !== sessionId || parent.status !== 'succeeded' || !parent.locked_asset_id) {
      return { error: 'That result is no longer available to refine.' };
    }
    if (!instruction) return { error: 'Describe the change you want, e.g. “a little warmer”.' };
    if (!toolFor(mode).refine) return { error: `A result in ${toolFor(mode).title} cannot be refined. Start over or repeat it instead.` };
  }

  const problem = canRun(user.id, { local });
  if (problem) return { error: problem };

  const id = createImageRun({
    userId: user.id,
    sessionId,
    kind: parent ? 'followup' : mode,
    model,
    instruction,
    parentRunId: parent?.id ?? null,
    params: await runParams(prefs, mode, model, sessionId, parent ? { from, dials } : null),
  });
  boot().imageRunner.wake();
  revalidatePath(`${toolFor(mode).path}/${sessionId}`);
  return { id };
}

export async function rerun(runId) {
  const user = await requireUser();
  const previous = getRun(user.id, String(runId));
  if (!previous) return { error: 'Result not found.' };

  const problem = canRun(user.id, { local: previous.model === LOCAL_RESIZE });
  if (problem) return { error: problem };

  const params = JSON.parse(previous.params_json || '{}');
  // Repeat means "do exactly that again": a refinement is refined again from the same result it
  // started from; anything else starts again from the original.
  const refinedFrom = previous.kind === 'followup' ? getRun(user.id, previous.parent_run_id) : null;
  if (previous.kind === 'followup' && (!refinedFrom || refinedFrom.status !== 'succeeded')) {
    return { error: 'The result this refined is gone, so it cannot be repeated. Start over instead.' };
  }
  const id = createImageRun({
    userId: user.id,
    sessionId: previous.session_id,
    kind: refinedFrom ? 'followup' : 'rerun',
    model: previous.model,
    instruction: previous.instruction,
    parentRunId: refinedFrom ? refinedFrom.id : previous.id,
    params,
  });
  boot().imageRunner.wake();
  revalidatePath(`${toolFor(params.mode).path}/${previous.session_id}`);
  return { id };
}

export async function removeRun(runId) {
  const user = await requireUser();
  const run = getRun(user.id, String(runId));
  if (!run) return { error: 'Result not found.' };
  boot().imageRunner.abort(run.id);
  await deleteImageRun(user.id, run.id);
  revalidatePath(`${toolFor(JSON.parse(run.params_json || '{}').mode).path}/${run.session_id}`);
  return { ok: true };
}

export async function removeSession(sessionId) {
  const user = await requireUser();
  const id = String(sessionId);
  const mode = prepared('SELECT mode FROM image_sessions WHERE id = ? AND user_id = ?').get(id, user.id)?.mode;
  const { imageRunner } = boot();
  for (const run of sessionRunStatuses(user.id, id)) imageRunner.abort(run.id);
  await deleteImageSession(user.id, id);
  revalidatePath('/', 'layout');
  redirect(toolFor(mode).path);
}

/** Moves a photo to the other tool, keeping everything already made from it. */
export async function moveSession(sessionId, mode) {
  const user = await requireUser();
  if (!isImageMode(mode)) return { error: 'Unknown tool.' };
  if (!setImageSessionMode(user.id, String(sessionId), mode)) return { error: 'Photo not found.' };
  revalidatePath('/', 'layout');
  redirect(`${toolFor(mode).path}/${sessionId}`);
}

const continueSchema = z.object({
  runId: z.string().uuid(),
  version: z.enum(['locked', 'ai']),
  dials: z.object({ color: z.number().min(0).max(1), light: z.number().min(0).max(1), ev: z.number().min(-1).max(1) }).optional(),
  mode: z.string().refine(isImageMode, 'Unknown tool.'),
});

/**
 * Starts another image tool on a result, exactly as it is shown — a repaired photo into
 * Colorize, a colorized one into Upscale — as a new photo there. The earlier one stays.
 */
export async function continueInTool(input) {
  const user = await requireUser();
  const parsed = continueSchema.safeParse(input);
  if (!parsed.success) return { error: 'That result cannot be used there.' };
  const { runId, version, dials, mode } = parsed.data;
  const run = getRun(user.id, runId);
  const asset = assetFor(user.id, version === 'ai' ? run?.ai_asset_id : run?.locked_asset_id);
  if (!run || run.status !== 'succeeded' || !asset) return { error: 'That result is no longer available.' };
  if (usedBytes(user.id) >= serverEnv().USER_QUOTA_MB * 1024 * 1024) return { error: 'Your storage is full. Delete something first.' };

  const session = prepared('SELECT title, source_asset_id FROM image_sessions WHERE id = ?').get(run.session_id);
  let buffer = await readFile(absolutePath(asset.path));
  if (version === 'locked' && dials && !isNeutral(dials)) {
    const original = assetFor(user.id, session?.source_asset_id);
    if (original) buffer = await mixToJpeg(await readFile(absolutePath(original.path)), buffer, dials);
  }
  let id;
  try {
    id = await createImageSession({ userId: user.id, buffer, filename: `${session?.title ?? 'photo'}.jpg`, mode });
  } catch (error) {
    if (error instanceof UploadError) return { error: error.message };
    throw error;
  }
  revalidatePath('/', 'layout');
  redirect(`${toolFor(mode).path}/${id}`);
}

const batchSchema = z.object({
  sessionIds: z.array(z.string().uuid()).min(1, 'Add a photo first.').max(MAX_BATCH_PHOTOS, `Up to ${MAX_BATCH_PHOTOS} photos at a time.`),
  model: z.string().regex(MODEL_ID, 'Pick one of your models.').max(120),
  instruction: z
    .string()
    .trim()
    .max(500, 'Keep the request under 500 characters.')
    .optional()
    .transform((v) => v || null),
});

/**
 * Several photos of one tool started together, with one model and one text: a run for each, as
 * if each had been started on its own page. Photos that already have a result are left as they are.
 */
export async function startBatch(input) {
  const user = await requireUser();
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { sessionIds, model, instruction } = parsed.data;
  const sessions = [...new Set(sessionIds)]
    .map((id) => prepared('SELECT id, mode FROM image_sessions WHERE id = ? AND user_id = ?').get(id, user.id))
    .filter(Boolean);
  if (!sessions.length) return { error: 'Those photos are gone.' };
  const mode = sessions[0].mode;
  if (sessions.some((session) => session.mode !== mode)) return { error: 'These photos belong to different tools.' };

  const prefs = getPrefs(user.id);
  const unusable = await modelProblem(prefs, mode, model);
  if (unusable) return { error: unusable };
  const problem = canRun(user.id, { local: mode === 'upscale' && model === LOCAL_RESIZE });
  if (problem) return { error: problem };

  const started = [];
  for (const session of sessions) {
    if (prepared('SELECT 1 FROM image_runs WHERE session_id = ? LIMIT 1').get(session.id)) continue;
    started.push(createImageRun({ userId: user.id, sessionId: session.id, kind: mode, model, instruction, params: await runParams(prefs, mode, model, session.id) }));
  }
  boot().imageRunner.wake();
  revalidatePath('/', 'layout');
  return { ids: started };
}

/** Removes one photo from the screen that starts several, before anything is made from it. */
export async function discardPhoto(sessionId) {
  const user = await requireUser();
  const id = String(sessionId);
  if (prepared('SELECT 1 FROM image_runs WHERE session_id = ? AND user_id = ? LIMIT 1').get(id, user.id)) return { error: 'This photo has results; delete it from its own page.' };
  if (!(await deleteImageSession(user.id, id))) return { error: 'Photo not found.' };
  revalidatePath('/', 'layout');
  return { ok: true };
}
