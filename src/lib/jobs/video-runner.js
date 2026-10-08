import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { assetFor, recordAsset } from '../assets.js';
import { learnNoPassthrough, modelHints, videoModel } from '../catalog.js';
import { serverEnv, siteConfig } from '../config.js';
import { signToken } from '../crypto.js';
import { prepared } from '../db.js';
import { clipSize, frameFromPhoto, probeVideo, renderMotion } from '../media/video.js';
import { OPENROUTER_BASE, OpenRouterError } from '../openrouter/client.js';
import { openrouterFor } from '../openrouter/index.js';
import { getPrompts } from '../preferences.js';
import { fillTemplate, MOTION_PRESETS, videoPrompt } from '../prompts/defaults.js';
import { EDIT_NEEDS_HTTPS, editVideoLink, publicBase } from '../public-media.js';
import { absolutePath, newAssetPath, sessionFolder, usedBytes } from '../storage.js';
import { LOCAL_MOTION } from '../video-pricing.js';
import { NEGATIVE_PROMPT, passthroughName, providerOptions, videoRequest } from '../video-request.js';

// Video jobs are queued in SQLite and worked off here. A clip from OpenRouter is submitted, then
// polled — with a growing interval, and sooner when OpenRouter's webhook says it finished —
// then streamed to disk. Local clips are rendered with ffmpeg, one at a time.

const SUBMIT_CONCURRENCY = 4;
const POLL_CONCURRENCY = 6;
const LOCAL_CONCURRENCY = 1;
const SAFETY_TICK_MS = 3000;
const FIRST_POLL_MS = 20_000;
const GIVE_UP_MS = 3 * 60 * 60 * 1000;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

// Mock jobs finish in seconds; checking on them at real-world intervals would only slow tests.
const quick = () => serverEnv().OPENROUTER_MOCK;
const pollDelay = (count) => (quick() ? 1000 : Math.min(60_000, 15_000 + count * 5_000));
// While a poll is under way its job is leased this far ahead, so nothing else polls it too.
const POLL_LEASE_MS = 10 * 60 * 1000;

/** A failure that trying again will not fix (as opposed to a dropped connection or a busy server). */
class LastingError extends Error {}
const passing = (error) => !(error instanceof LastingError) && (!(error instanceof OpenRouterError) || error.status >= 500 || error.status === 429);

const friendly = (error) => {
  // No key at all reads differently from a key OpenRouter refused.
  if (/no openrouter api key/i.test(error?.message ?? '')) return 'Add your OpenRouter key in Settings, or use Ken Burns, which is free.';
  if (error instanceof OpenRouterError && error.status === 401) return 'OpenRouter did not accept your key. Check it in Settings.';
  if (error instanceof OpenRouterError && error.status === 402) return 'Your OpenRouter account is out of credits.';
  return String(error?.message || 'Something went wrong.')
    .replace(/sk-or-[A-Za-z0-9_-]+/g, 'sk-or-…')
    .slice(0, 500);
};

/** Where OpenRouter can tell us a job finished — only for a public HTTPS address it can reach. */
function callbackUrl(jobId) {
  const base = publicBase();
  return base ? `${base}/api/webhooks/openrouter/${jobId}?t=${signToken('video-webhook', jobId)}` : undefined;
}

const dataUrl = (bytes, mime = 'image/jpeg') => `data:${mime};base64,${bytes.toString('base64')}`;
const stillExists = (jobId) => Boolean(prepared('SELECT 1 FROM video_jobs WHERE id = ?').get(jobId));

function update(jobId, fields) {
  const keys = Object.keys(fields);
  prepared(`UPDATE video_jobs SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((key) => fields[key]), jobId);
}

/**
 * The model's own settings for this clip, from the extra settings its catalog entry allows: the
 * things to avoid as its negative prompt, where it has one. Null when there are none to send, or
 * its provider turned them down before.
 */
function extraSettings(modelId, { avoid }) {
  const entry = videoModel(modelId);
  if (!entry?._providers?.length || modelHints().get(modelId)?.no_passthrough) return null;
  const settings = {};
  const negative = passthroughName(entry, NEGATIVE_PROMPT);
  if (negative && avoid?.trim()) settings[negative] = avoid.trim();
  return providerOptions(entry._providers, settings);
}

function promptFor(job) {
  const prompts = getPrompts(job.user_id);
  if (JSON.parse(job.params_json || '{}').tool === 'edit') return { prompt: fillTemplate(prompts['video-edit'].text, { instruction: job.instruction ?? '' }), avoid: null };
  const motion = prompts[`motion-${job.preset}`]?.text ?? MOTION_PRESETS[job.preset]?.prompt ?? MOTION_PRESETS['parallax-in'].prompt;
  return { prompt: videoPrompt({ motion, instruction: job.instruction }), avoid: prompts.avoid?.text };
}

// A 400 about the extra settings: the provider does not take them as they were sent.
const refusedSettings = (error) => error instanceof OpenRouterError && error.status === 400 && /provider|option|parameter|passthrough|negative/i.test(`${error.message} ${error.body ?? ''}`);

const inline = async (userId, assetId) => {
  const asset = assetFor(userId, assetId);
  return asset ? dataUrl(await readFile(absolutePath(asset.path)), asset.mime) : null;
};

/** What a clip starts from: the photo's frames for Animate, the video itself for Edit Video. */
async function inputsFor(job, params) {
  if (params.tool === 'edit') {
    // OpenRouter refuses a video sent inline; it fetches it by a link made for this edit alone.
    // (Mock jobs never leave this machine, so any address of it will do.)
    if (!assetFor(job.user_id, params.inputAssetId)) throw new LastingError('The video for this clip is gone.');
    const base = publicBase() ?? (quick() ? siteConfig.url : null);
    if (!base) throw new LastingError(EDIT_NEEDS_HTTPS);
    return { frames: [], videos: [`${base}${editVideoLink(job.id)}`] };
  }
  const first = await inline(job.user_id, job.frame_asset_id);
  if (!first) throw new LastingError('The photo for this clip is gone.');
  const last = params.lastFrameAssetId ? await inline(job.user_id, params.lastFrameAssetId) : null;
  return { frames: [{ url: first, type: 'first_frame' }, ...(last ? [{ url: last, type: 'last_frame' }] : [])], videos: [] };
}

async function submit(job, signal) {
  const params = JSON.parse(job.params_json || '{}');
  const { frames, videos } = await inputsFor(job, params);

  const { prompt, avoid } = promptFor(job);
  const provider = extraSettings(job.model, { avoid });
  const body = videoRequest({
    model: job.model,
    prompt,
    duration: params.duration,
    frames,
    videos,
    resolution: params.resolution,
    aspect: params.aspect,
    audio: params.audioOption ? params.audio : undefined,
    callback: callbackUrl(job.id),
    provider,
  });

  update(job.id, { compiled_prompt: provider && avoid?.trim() ? `${prompt}\n\n(Negative prompt: ${avoid.trim()})` : prompt });
  const client = openrouterFor(job.user_id);
  let result;
  try {
    result = await client.submitVideo(body, { signal });
  } catch (error) {
    // Refused before anything started, so nothing was billed: send it again without the extra
    // settings, and stop offering them to this model.
    if (!provider || !refusedSettings(error)) throw error;
    console.info(`[aurai] ${job.model} turned down its extra settings; sending the clip without them`);
    learnNoPassthrough(job.model);
    update(job.id, { compiled_prompt: prompt });
    const plain = { ...body };
    delete plain.provider;
    result = await client.submitVideo(plain, { signal });
  }
  if (!result?.id) throw new Error('OpenRouter did not accept the job. Try again.');
  if (!stillExists(job.id)) return;
  const now = Date.now();
  update(job.id, { status: result.status === 'in_progress' ? 'in_progress' : 'pending', openrouter_id: result.id, submitted_at: now, poll_after: now + (quick() ? 1000 : FIRST_POLL_MS), error: null });
}

/** Streams the finished file into the session folder, within the person's storage quota. */
async function download(job, status, signal) {
  update(job.id, { status: 'downloading' });
  const client = openrouterFor(job.user_id);
  const url = status.unsigned_urls?.[0] ?? `${OPENROUTER_BASE}/videos/${encodeURIComponent(job.openrouter_id)}/content?index=0`;
  const response = await client.downloadVideo(url, { signal });
  const room = serverEnv().USER_QUOTA_MB * 1024 * 1024 - usedBytes(job.user_id);
  const limit = Math.min(MAX_VIDEO_BYTES, room);
  const path = newAssetPath(sessionFolder(job.user_id, 'video', job.session_id), 'mp4');
  const temp = `${absolutePath(path)}.${randomUUID()}.part`;
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      done(bytes > limit ? new LastingError(room < MAX_VIDEO_BYTES ? 'Your storage is full, so the video could not be saved. Delete something and try again.' : 'The video is too large to keep.') : null, chunk);
    },
  });
  try {
    await mkdir(dirname(absolutePath(path)), { recursive: true });
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(temp), { signal });
    const info = await probeVideo(temp);
    await rename(temp, absolutePath(path));
    return { path, bytes: (await stat(absolutePath(path))).size, info, mime: 'video/mp4' };
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

function finish(job, file, cost) {
  if (!stillExists(job.id)) return rm(absolutePath(file.path), { force: true });
  const asset = recordAsset({
    userId: job.user_id,
    videoSessionId: job.session_id,
    path: file.path,
    kind: 'video',
    mime: file.mime,
    bytes: file.bytes,
    width: file.info.width,
    height: file.info.height,
    durationS: file.info.duration,
  });
  update(job.id, { status: 'completed', video_asset_id: asset.id, cost_usd: cost, completed_at: Date.now(), poll_after: null, error: null });
  return null;
}

async function poll(job, signal) {
  if (Date.now() - job.submitted_at > GIVE_UP_MS) {
    update(job.id, { status: 'failed', error: 'Gave up waiting after 3 hours. OpenRouter may still finish it; check your activity there.', poll_after: null });
    return;
  }
  let status;
  try {
    status = await openrouterFor(job.user_id).getVideo(job.openrouter_id, { signal });
    if (!stillExists(job.id)) return;
    if (status.status === 'completed') {
      const file = await download(job, status, signal);
      await finish(job, file, status.usage?.cost ?? null);
      return;
    }
  } catch (error) {
    if (signal.aborted || !passing(error)) throw error;
    // A dropped connection or a busy server: look again a little later.
    console.warn(`[aurai] video job ${job.id}: ${error.message}; trying again shortly`);
    update(job.id, { status: 'in_progress', poll_count: job.poll_count + 1, poll_after: Date.now() + 60_000 });
    return;
  }
  if (['failed', 'cancelled', 'expired'].includes(status.status)) {
    const reason = typeof status.error === 'string' ? status.error : status.error?.message;
    update(job.id, { status: status.status, error: friendly({ message: reason || `OpenRouter reported the job ${status.status}.` }), poll_after: null, cost_usd: status.usage?.cost ?? null });
    return;
  }
  update(job.id, { status: status.status === 'in_progress' ? 'in_progress' : 'pending', poll_count: job.poll_count + 1, poll_after: Date.now() + pollDelay(job.poll_count + 1) });
}

/** A local clip: the photo at full quality, cut to shape, with the camera move drawn over it. */
async function renderLocal(job, signal) {
  if (job.model !== LOCAL_MOTION) throw new Error('This way of making a clip is no longer offered. Try Ken Burns or an AI model.');
  const params = JSON.parse(job.params_json || '{}');
  const session = prepared('SELECT source_asset_id FROM video_sessions WHERE id = ?').get(job.session_id);
  const source = assetFor(job.user_id, session?.source_asset_id);
  if (!source) throw new Error('The photo for this clip is gone.');
  const preset = MOTION_PRESETS[job.preset] ?? MOTION_PRESETS['parallax-in'];
  const size = clipSize(params.aspect, params.resolution);
  const frame = await frameFromPhoto(await readFile(absolutePath(source.path)), params.aspect, { maxEdge: Math.max(size.width, size.height) * 2 });
  const input = join(tmpdir(), `aurai-frame-${randomUUID()}.jpg`);
  const path = newAssetPath(sessionFolder(job.user_id, 'video', job.session_id), 'mp4');
  const output = `${absolutePath(path)}.${randomUUID()}.part.mp4`;
  try {
    await writeFile(input, frame.data);
    await mkdir(dirname(absolutePath(path)), { recursive: true });
    await renderMotion({ input, output, ...size, duration: params.duration, camera: preset.camera, signal });
    const info = await probeVideo(output);
    await rename(output, absolutePath(path));
    await finish(job, { path, bytes: (await stat(absolutePath(path))).size, info, mime: 'video/mp4' }, 0);
  } finally {
    await rm(input, { force: true });
    await rm(output, { force: true });
  }
}

function createRunner() {
  const active = new Map();
  const counts = { submit: 0, poll: 0, local: 0 };
  let scheduled = false;
  let timer = null;
  let stopped = false;

  async function work(kind, job, task) {
    const controller = new AbortController();
    active.set(job.id, controller);
    counts[kind] += 1;
    try {
      await task(job, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted && stillExists(job.id)) {
        console.warn(`[aurai] video job ${job.id} failed: ${error.message}`);
        update(job.id, { status: 'failed', error: friendly(error), poll_after: null });
      }
    } finally {
      active.delete(job.id);
      counts[kind] -= 1;
      wake();
    }
  }

  const claim = (local) =>
    prepared(
      `UPDATE video_jobs SET status = ?, submitted_at = CASE WHEN ? THEN ? ELSE submitted_at END
        WHERE id = (SELECT id FROM video_jobs WHERE status = 'queued' AND (model LIKE 'local/%') = ? ORDER BY created_at LIMIT 1)
        RETURNING *`,
    ).get(local ? 'in_progress' : 'submitting', local ? 1 : 0, Date.now(), local ? 1 : 0);

  function tick() {
    scheduled = false;
    if (stopped) return;
    while (counts.submit < SUBMIT_CONCURRENCY) {
      const job = claim(false);
      if (!job) break;
      work('submit', job, submit);
    }
    while (counts.local < LOCAL_CONCURRENCY) {
      const job = claim(true);
      if (!job) break;
      work('local', job, renderLocal);
    }
    if (counts.poll < POLL_CONCURRENCY) {
      const due = prepared(
        `SELECT * FROM video_jobs WHERE status IN ('pending', 'in_progress') AND openrouter_id IS NOT NULL AND poll_after <= ?
          ORDER BY poll_after LIMIT ?`,
      ).all(Date.now(), POLL_CONCURRENCY * 2);
      const lease = prepared('UPDATE video_jobs SET poll_after = ? WHERE id = ? AND poll_after = ?');
      for (const job of due) {
        if (counts.poll >= POLL_CONCURRENCY) break;
        if (active.has(job.id) || !lease.run(Date.now() + POLL_LEASE_MS, job.id, job.poll_after).changes) continue;
        work('poll', job, poll);
      }
    }
  }

  function wake() {
    if (scheduled) return;
    scheduled = true;
    setImmediate(tick);
  }

  return {
    start({ recover }) {
      if (recover) {
        // A job caught mid-submit may or may not have reached OpenRouter (and may be billed), so
        // it is failed visibly rather than sent twice. Everything already submitted resumes.
        prepared(
          `UPDATE video_jobs SET status = 'failed', error = 'Interrupted by a server restart while being sent. It may have started on OpenRouter anyway; check your activity there before trying again.'
            WHERE status = 'submitting'`,
        ).run();
        prepared("UPDATE video_jobs SET status = 'in_progress', poll_after = ? WHERE status = 'downloading'").run(Date.now());
        prepared(`UPDATE video_jobs SET status = 'queued' WHERE status = 'in_progress' AND model LIKE 'local/%'`).run();
      }
      timer = setInterval(tick, SAFETY_TICK_MS);
      timer.unref?.();
      wake();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    wake,
    /** Checks a job now (OpenRouter's webhook says it changed). */
    nudge(jobId) {
      prepared("UPDATE video_jobs SET poll_after = ? WHERE id = ? AND status IN ('pending', 'in_progress')").run(Date.now(), jobId);
      wake();
    },
    /** Stops working on a job (deleted, or no longer waited for). OpenRouter may still finish and bill it. */
    abort(jobId) {
      active.get(jobId)?.abort(new Error('Stopped'));
    },
    stopped: () => stopped,
  };
}

/** One runner per process; a development reload replaces it with the new code. */
export function startVideoRunner() {
  const current = globalThis.__auraiVideoRunner;
  const reusable = current && !current.runner.stopped?.() && (process.env.NODE_ENV === 'production' || current.createRunner === createRunner);
  if (reusable) return current.runner;
  current?.runner.stop();
  const runner = createRunner();
  globalThis.__auraiVideoRunner = { runner, createRunner };
  runner.start({ recover: !current });
  return runner;
}

