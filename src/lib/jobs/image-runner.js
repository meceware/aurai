import { readFile } from 'node:fs/promises';
import { assetFor, storeAsset } from '../assets.js';
import { imageCatalog, learnMinimumResolution } from '../catalog.js';
import { prepared } from '../db.js';
import { analyzePhoto, describeAnalysis } from '../enhance/analysis.js';
import { buildImageRequest } from '../enhance/request.js';
import { edgeOf, largerResolution, LOCAL_RESIZE } from '../model-options.js';
import { colorizeLock } from '../media/colorize-lock.js';
import { exifFor } from '../media/exif.js';
import { colorLock, structureOf } from '../media/colorlock.js';
import { areaLock, markedPhoto } from '../media/area-lock.js';
import { repairLock } from '../media/repair-lock.js';
import { detailLock, resizeOnly } from '../media/upscale-lock.js';
import { mixToJpeg } from '../media/mix.js';
import { toDataUrl } from '../media/image-io.js';
import { PREVIEW_EDGE, renderPreview } from '../media/ingest.js';
import { describeStats } from '../media/stats.js';
import { OpenRouterError } from '../openrouter/client.js';
import { openrouterFor } from '../openrouter/index.js';
import { getPrompts } from '../preferences.js';
import { fillTemplate } from '../prompts/defaults.js';
import { absolutePath, removeFile, sessionFolder } from '../storage.js';

// Image runs are queued in SQLite and worked off here, in the server process. One process owns
// the database, so claiming a run is a single UPDATE … RETURNING with no lease races.

const GLOBAL_CONCURRENCY = 4;
const PER_USER_CONCURRENCY = 2;
const SAFETY_TICK_MS = 5000;

function claimNext() {
  return prepared(
    `UPDATE image_runs SET status = 'running', started_at = ?, lease_until = ?
      WHERE id = (
        SELECT r.id FROM image_runs r
         WHERE r.status = 'queued'
           AND (SELECT COUNT(*) FROM image_runs a WHERE a.user_id = r.user_id AND a.status = 'running') < ?
         ORDER BY r.created_at
         LIMIT 1)
      RETURNING *`,
  ).get(Date.now(), Date.now() + 15 * 60 * 1000, PER_USER_CONCURRENCY);
}

const stillExists = (runId) => Boolean(prepared('SELECT 1 FROM image_runs WHERE id = ?').get(runId));

/** OpenRouter's messages are shown to the user; anything that looks like a key is masked first. */
const friendly = (error) =>
  String(error?.message || 'Something went wrong.')
    .replace(/sk-or-[A-Za-z0-9_-]+/g, 'sk-or-…')
    .slice(0, 500);

// Prompts are the person's own versions where they have edited them in Settings.
function promptFor(run, params, prompts, stats, analysis) {
  // Edit Image's text is the edit itself, refined or not; painted, the prompt says where.
  if (params.mode === 'edit') return fillTemplate(prompts[params.maskAssetId ? 'edit-area' : 'edit'].text, { instruction: run.instruction });
  if (run.kind === 'followup') return fillTemplate((params.mode === 'repair' ? prompts['repair-refine'] : prompts.followup).text, { instruction: run.instruction });
  const instruction = run.instruction ? `Additional request from the user: ${run.instruction}` : '';
  const template = (prompts[params.mode] ?? prompts.enhance).text;
  return fillTemplate(template, { stats: stats ? describeStats(stats) : '', analysis: describeAnalysis(analysis), instruction });
}

/**
 * The result itself, from the original and the AI render, per tool: the original's pixels
 * recoloured (Enhance, Colorize), the original with only its damage repaired (Repair), or the
 * original enlarged with only finer detail added (Upscale). With the measurements for its card.
 */
async function lockFor(params, sourceBytes, aiBytes, { format, exif, maskBytes }) {
  const round = (value, digits) => (typeof value === 'number' ? Number(value.toFixed(digits)) : null);
  const alignment = (map) => ({ hypothesis: map.hypothesis, scale: map.scale, psr: round(map.psr, 1) });
  if (params.mode === 'edit') {
    const locked = await areaLock(sourceBytes, aiBytes, maskBytes, { format, exif });
    return { locked, fidelity: { lock: 'area', area: round(locked.fit.area, 4), alignment: alignment(locked.fit.map) } };
  }
  if (params.mode === 'repair' || params.mode === 'upscale') {
    const locked = params.mode === 'repair' ? await repairLock(sourceBytes, aiBytes, { format, exif }) : await detailLock(sourceBytes, aiBytes, { format, exif });
    const { map } = locked.fit;
    return {
      locked,
      fidelity: {
        structure: round(await structureOf(sourceBytes, aiBytes, map), 3),
        lock: params.mode,
        ...(params.mode === 'repair' ? { repaired: round(locked.fit.repaired, 4) } : { factor: round(locked.fit.factor, 2) }),
        alignment: alignment(map),
      },
    };
  }
  const colorize = params.mode === 'colorize';
  const locked = colorize ? await colorizeLock(sourceBytes, aiBytes, { format, exif }) : await colorLock(sourceBytes, aiBytes, { format, local: params.lock !== 'global', exif });
  const { map, metrics } = locked.fit;
  const structure = colorize ? await structureOf(sourceBytes, aiBytes, map) : metrics.structure;
  return {
    locked,
    fidelity: {
      structure: round(structure, 3),
      coverage: round(metrics.coverage, 3),
      fitBefore: round(metrics.before, 2),
      fitAfter: round(metrics.after, 2),
      lock: colorize ? 'colorize' : params.lock === 'global' ? 'global' : 'local',
      alignment: alignment(map),
    },
  };
}

/** Upscale's free option: the photo enlarged here, with no model and no cost. */
async function resizeHere(run, source, sourceBytes, started) {
  const format = source.mime === 'image/png' ? 'png' : 'jpeg';
  const resized = await resizeOnly(sourceBytes, edgeOf('4K'), { format, exif: await exifFor(sourceBytes) });
  if (!stillExists(run.id)) return;
  const folder = sessionFolder(run.user_id, 'image', run.session_id);
  const written = [];
  try {
    const locked = await storeAsset({
      userId: run.user_id,
      imageSessionId: run.session_id,
      folder,
      kind: 'locked',
      data: resized.buffer,
      mime: format === 'png' ? 'image/png' : 'image/jpeg',
      ext: format === 'png' ? 'png' : 'jpg',
      width: resized.width,
      height: resized.height,
    });
    written.push(locked.path);
    const preview = await storeAsset({ userId: run.user_id, imageSessionId: run.session_id, folder, kind: 'preview', parentAssetId: locked.id, ...(await renderPreview(resized.buffer)) });
    written.push(preview.path);
    const updated = prepared(
      `UPDATE image_runs SET status = 'succeeded', locked_asset_id = ?, fidelity_json = ?, cost_usd = 0, duration_ms = ?, finished_at = ?, lease_until = NULL, error = NULL
        WHERE id = ?`,
    ).run(locked.id, JSON.stringify({ lock: 'resize', factor: Number(resized.fit.factor.toFixed(2)) }), Date.now() - started, Date.now(), run.id);
    if (!updated.changes) await Promise.all(written.map((path) => removeFile(path)));
  } catch (error) {
    await Promise.all(written.map((path) => removeFile(path)));
    throw error;
  }
}

/**
 * The analysis for this run: reused from the run it repeats when there is one (same photo, same
 * findings), otherwise asked for. Failure is not fatal — the edit proceeds on measurements alone.
 */
async function analysisFor(run, params, prompts, client, sourceBytes, stats, signal) {
  if (params.analysis === false || !params.analysisModel || run.kind === 'followup') return { analysis: null, cost: 0 };
  if (run.parent_run_id) {
    const previous = prepared('SELECT analysis_json FROM image_runs WHERE id = ?').get(run.parent_run_id);
    if (previous?.analysis_json) return { analysis: JSON.parse(previous.analysis_json), cost: 0 };
  }
  try {
    return await analyzePhoto(client, {
      dataUrl: await toDataUrl(sourceBytes, { maxEdge: 1024 }),
      statsText: stats ? describeStats(stats) : '',
      model: params.analysisModel,
      template: prompts.analysis.text,
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    console.warn(`[aurai] analysis skipped for run ${run.id}: ${error.message}`);
    return { analysis: null, cost: 0 };
  }
}

// A 400 that names the size: some models list resolutions they then refuse.
const refusedSize = (error) => error instanceof OpenRouterError && error.status === 400 && /resolution|size|dimension|pixel/i.test(`${error.message} ${error.body ?? ''}`);

/**
 * Asks for the image. A model that refuses the resolution it was given is asked once more at the
 * next size up, and that size is remembered as its minimum, so prices and later runs use it.
 */
async function generate(client, body, { run, catalogEntry, signal }) {
  try {
    return await client.generateImage(body, { signal });
  } catch (error) {
    const larger = body.resolution && refusedSize(error) ? largerResolution(catalogEntry, body.resolution) : null;
    if (!larger) throw error;
    console.info(`[aurai] ${run.model} refused ${body.resolution}; retrying at ${larger}`);
    const result = await client.generateImage({ ...body, resolution: larger }, { signal });
    learnMinimumResolution(run.model, larger);
    prepared("UPDATE image_runs SET params_json = json_set(params_json, '$.resolution', ?) WHERE id = ?").run(larger, run.id);
    return result;
  }
}

async function execute(run, signal) {
  const started = Date.now();
  const params = JSON.parse(run.params_json || '{}');
  const session = prepared('SELECT * FROM image_sessions WHERE id = ?').get(run.session_id);
  const source = assetFor(run.user_id, session?.source_asset_id);
  if (!session || !source) throw new Error('The original photo is missing.');
  const sourceBytes = await readFile(absolutePath(source.path));
  if (run.model === LOCAL_RESIZE) return resizeHere(run, source, sourceBytes, started);
  const client = openrouterFor(run.user_id);

  // A follow-up edits the result the person was looking at: its AI redraw, or its Local version
  // with the Color / Brightness / Exposure it was set to. Everything else starts from the original.
  // Either way the new result is locked against the original photo below, not against this input.
  let input = source;
  let inputBytes = sourceBytes;
  if (run.kind === 'followup') {
    const parent = prepared('SELECT ai_asset_id, locked_asset_id FROM image_runs WHERE id = ?').get(run.parent_run_id);
    input = assetFor(run.user_id, params.from === 'ai' ? parent?.ai_asset_id : parent?.locked_asset_id);
    if (!input) throw new Error('The result this refines was deleted.');
    inputBytes = await readFile(absolutePath(input.path));
    if (params.from !== 'ai' && params.dials) inputBytes = await mixToJpeg(sourceBytes, inputBytes, params.dials);
  }

  // Edit Image, painted: the area as the person painted it over this input.
  let maskBytes = null;
  if (params.mode === 'edit' && params.maskAssetId) {
    const mask = assetFor(run.user_id, params.maskAssetId);
    if (!mask) throw new Error('The painted area is missing. Paint it again.');
    maskBytes = await readFile(absolutePath(mask.path));
  }

  const prompts = getPrompts(run.user_id);
  const { analysis, cost: analysisCost } = await analysisFor(run, params, prompts, client, sourceBytes, source.meta?.stats, signal);
  const prompt = promptFor(run, params, prompts, source.meta?.stats, analysis);
  const catalogEntry = (await imageCatalog()).get(run.model);
  const body = buildImageRequest({
    model: run.model,
    prompt,
    // Painted, the model sees the area tinted: no image model on OpenRouter takes a mask.
    dataUrl: await toDataUrl(maskBytes ? await markedPhoto(inputBytes, maskBytes) : inputBytes),
    width: source.width,
    height: source.height,
    catalogEntry,
    quality: params.quality,
    resolution: params.resolution,
  });
  prepared('UPDATE image_runs SET compiled_prompt = ?, input_asset_id = ?, analysis_json = ? WHERE id = ?').run(
    prompt,
    input.id,
    analysis ? JSON.stringify(analysis) : null,
    run.id,
  );

  const result = await generate(client, body, { run, catalogEntry, signal });
  const image = result?.data?.[0];
  if (!image?.b64_json) throw new Error('The model returned no image. Try again or pick another model.');
  if (!stillExists(run.id)) return;

  const folder = sessionFolder(run.user_id, 'image', run.session_id);
  const aiBytes = Buffer.from(image.b64_json, 'base64');
  const aiMime = image.media_type || 'image/png';
  const written = [];
  try {
    const aiPreview = await renderPreview(aiBytes);
    const ai = await storeAsset({
      userId: run.user_id,
      imageSessionId: run.session_id,
      folder,
      kind: 'ai',
      data: aiBytes,
      mime: aiMime,
      ext: aiMime.split('/')[1]?.replace('jpeg', 'jpg') || 'png',
      width: aiPreview.width,
      height: aiPreview.height,
    });
    written.push(ai.path);

    // The AI render is only a guide: the result is built from the original's own pixels (lockFor).
    // Except in Edit Image, where the AI's image is the result, and where a painted edit keeps
    // what it is edited from (the original, or the result being refined) outside the area.
    let lockedAsset = ai;
    let fidelity = { lock: 'edit' };
    if (params.mode !== 'edit' || maskBytes) {
      const lockedFormat = source.mime === 'image/png' ? 'png' : 'jpeg';
      const lockedResult = await lockFor(params, params.mode === 'edit' ? inputBytes : sourceBytes, aiBytes, { format: lockedFormat, exif: await exifFor(sourceBytes), maskBytes });
      const { locked } = lockedResult;
      fidelity = lockedResult.fidelity;
      lockedAsset = await storeAsset({
        userId: run.user_id,
        imageSessionId: run.session_id,
        folder,
        kind: 'locked',
        data: locked.buffer,
        mime: lockedFormat === 'png' ? 'image/png' : 'image/jpeg',
        ext: lockedFormat === 'png' ? 'png' : 'jpg',
        width: locked.width,
        height: locked.height,
      });
      written.push(lockedAsset.path);
      const preview = await renderPreview(locked.buffer);
      const previewAsset = await storeAsset({ userId: run.user_id, imageSessionId: run.session_id, folder, kind: 'preview', parentAssetId: lockedAsset.id, ...preview });
      written.push(previewAsset.path);
    }
    if (Math.max(aiPreview.width, aiPreview.height) >= PREVIEW_EDGE) {
      const aiPreviewAsset = await storeAsset({ userId: run.user_id, imageSessionId: run.session_id, folder, kind: 'preview', parentAssetId: ai.id, ...aiPreview });
      written.push(aiPreviewAsset.path);
    }

    const updated = prepared(
      `UPDATE image_runs SET status = 'succeeded', ai_asset_id = ?, locked_asset_id = ?, fidelity_json = ?, cost_usd = ?,
              duration_ms = ?, finished_at = ?, lease_until = NULL, error = NULL
        WHERE id = ?`,
    ).run(ai.id, lockedAsset.id, JSON.stringify(fidelity), (result.usage?.cost ?? 0) + analysisCost || null, Date.now() - started, Date.now(), run.id);
    // The model's own share, which prices the next run of this model at this size.
    prepared('UPDATE image_runs SET model_cost_usd = ? WHERE id = ?').run(result.usage?.cost || null, run.id);
    // Deleted while colour-locking: the rows went with the run; drop the files too.
    if (!updated.changes) await Promise.all(written.map((path) => removeFile(path)));
  } catch (error) {
    await Promise.all(written.map((path) => removeFile(path)));
    throw error;
  }
}

function createRunner() {
  const active = new Map();
  let timer = null;
  let scheduled = false;
  let stopped = false;

  async function work(run) {
    const controller = new AbortController();
    active.set(run.id, controller);
    try {
      await execute(run, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn(`[aurai] image run ${run.id} failed: ${error.message}`);
        prepared("UPDATE image_runs SET status = 'failed', error = ?, finished_at = ?, lease_until = NULL WHERE id = ?").run(friendly(error), Date.now(), run.id);
      }
    } finally {
      active.delete(run.id);
      wake();
    }
  }

  function tick() {
    scheduled = false;
    if (stopped) return;
    while (active.size < GLOBAL_CONCURRENCY) {
      const run = claimNext();
      if (!run) break;
      work(run);
    }
  }

  function wake() {
    if (scheduled) return;
    scheduled = true;
    setImmediate(tick);
  }

  return {
    start({ recover }) {
      // On a fresh process, a run marked running belongs to a process that no longer exists. It
      // may already have been billed, so it is failed visibly rather than silently run again.
      if (recover) {
        prepared("UPDATE image_runs SET status = 'failed', error = 'Interrupted by a server restart. Run it again.', lease_until = NULL WHERE status = 'running'").run();
      }
      timer = setInterval(tick, SAFETY_TICK_MS);
      timer.unref?.();
      wake();
    },
    /** Stops claiming new runs; runs already in flight finish and record their result. */
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    wake,
    /** Stops waiting on a run that was deleted; OpenRouter may still bill a request already in flight. */
    abort(runId) {
      active.get(runId)?.abort(new Error('Run deleted'));
    },
    activeCount: () => active.size,
    stopped: () => stopped,
  };
}

/**
 * Starts the runner once per process. In development a module reload brings a new copy of this
 * code; the old loop is stopped and replaced so edits take effect without a server restart.
 */
export function startImageRunner() {
  const current = globalThis.__auraiImageRunner;
  // Optional call: an instance built by older code (before a dev reload) may lack the method.
  const reusable = current && !current.runner.stopped?.() && (process.env.NODE_ENV === 'production' || current.createRunner === createRunner);
  if (reusable) return current.runner;
  current?.runner.stop();
  const runner = createRunner();
  globalThis.__auraiImageRunner = { runner, createRunner };
  runner.start({ recover: !current });
  return runner;
}
