import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'aurai-pipeline-'));
// Each run's database and files go when it ends.
after(() => rmSync(process.env.DATA_DIR, { recursive: true, force: true }));
process.env.OPENROUTER_MOCK = 'true';

const { getDb, prepared } = await import('./db.js');
const { migrate } = await import('./migrate.js');
const { createImageRun, createImageSession, deleteImageRun, deleteImageSession, getBatchView, getImageSessionView, listImageSessions, setImageSessionDone } = await import('./image-sessions.js');
const { startImageRunner } = await import('./jobs/image-runner.js');
const { UploadError } = await import('./media/ingest.js');
const { absolutePath, removeUserMedia, sessionFolder, sweepOrphanFiles } = await import('./storage.js');
const { storeAsset } = await import('./assets.js');
const { LOCAL_RESIZE } = await import('./model-options.js');

migrate(getDb(), join(import.meta.dirname, '..', '..', 'migrations'));
// The catalog is optional; an empty one keeps the test offline.
prepared("INSERT INTO model_catalog (kind, model_id, data_json, fetched_at) VALUES ('image', 'none', '{}', ?)").run(Date.now());
prepared('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run('u1', 'u1', 'u1@example.com', Date.now(), Date.now());

async function warmPhoto() {
  const width = 900;
  const height = 600;
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const x = i % width;
    data[i * 3] = 150 + (x % 60);
    data[i * 3 + 1] = 110 + ((x * 7) % 40);
    data[i * 3 + 2] = 60;
  }
  return sharp(data, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

async function waitFor(check, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out');
}

const filesIn = (dir) => (existsSync(dir) ? readdirSync(dir) : []);

test('rejects files that are not photos, whatever they are named', async () => {
  await assert.rejects(createImageSession({ userId: 'u1', buffer: Buffer.from('<svg></svg>'), filename: 'x.jpg' }), UploadError);
  await assert.rejects(createImageSession({ userId: 'u1', buffer: Buffer.alloc(0), filename: 'x.jpg' }), UploadError);
});

test('upload → run → colour-locked result → delete leaves nothing behind', async () => {
  const sessionId = await createImageSession({ userId: 'u1', buffer: await warmPhoto(), filename: 'grandma_1962.jpg' });
  let view = getImageSessionView('u1', sessionId);
  assert.equal(view.title, 'grandma 1962');
  assert.equal(view.mode, 'enhance');
  assert.ok(view.source.stats && view.source.summary.includes('Color balance'));
  assert.notEqual(view.source.displayId, view.source.id);

  const runner = startImageRunner();
  const runId = createImageRun({ userId: 'u1', sessionId, kind: 'enhance', model: 'test/image-model', params: { mode: 'enhance' } });
  runner.wake();

  const run = await waitFor(() => {
    const row = prepared('SELECT * FROM image_runs WHERE id = ?').get(runId);
    return row.status === 'succeeded' || row.status === 'failed' ? row : null;
  });
  assert.equal(run.status, 'succeeded', run.error);

  view = getImageSessionView('u1', sessionId);
  const [result] = view.runs;
  assert.equal(result.locked.width, 900);
  assert.equal(result.locked.height, 600);
  assert.ok(result.fidelity.structure > 0.5, JSON.stringify(result.fidelity));
  assert.ok(existsSync(absolutePath(prepared('SELECT path FROM assets WHERE id = ?').get(result.locked.id).path)));

  const folder = absolutePath(join('u1', `img-${sessionId}`));
  const before = filesIn(folder).length;
  assert.ok(await deleteImageRun('u1', runId));
  assert.ok(filesIn(folder).length < before, 'run files removed');
  assert.equal(prepared('SELECT COUNT(*) AS c FROM assets WHERE image_session_id = ? AND kind IN (?, ?)').get(sessionId, 'ai', 'locked').c, 0);

  assert.ok(await deleteImageSession('u1', sessionId));
  assert.equal(existsSync(folder), false);
  assert.equal(prepared('SELECT COUNT(*) AS c FROM assets WHERE image_session_id = ?').get(sessionId).c, 0);
  runner.stop();
});

test('a refinement edits the previous result but is locked against the original', async () => {
  const sessionId = await createImageSession({ userId: 'u1', buffer: await warmPhoto(), filename: 'refine.jpg' });
  const runner = startImageRunner();
  const finished = (id) =>
    waitFor(() => {
      const row = prepared('SELECT * FROM image_runs WHERE id = ?').get(id);
      return row.status === 'succeeded' || row.status === 'failed' ? row : null;
    });

  const first = createImageRun({ userId: 'u1', sessionId, kind: 'enhance', model: 'test/image-model', params: { mode: 'enhance', analysisModel: 'test/vision-model' } });
  runner.wake();
  const firstRow = await finished(first);
  assert.equal(firstRow.status, 'succeeded', firstRow.error);
  assert.ok(JSON.parse(firstRow.analysis_json).issues.length > 0, 'analysis stored');

  const second = createImageRun({
    userId: 'u1',
    sessionId,
    kind: 'followup',
    model: 'test/image-model',
    instruction: 'a little warmer',
    parentRunId: first,
    // Refining sends the Local version as the person had it set, so the dials go with it.
    params: { mode: 'enhance', dials: { color: 1, light: 0, ev: 0 } },
  });
  runner.wake();
  const secondRow = await finished(second);
  assert.equal(secondRow.status, 'succeeded', secondRow.error);
  assert.equal(secondRow.input_asset_id, firstRow.locked_asset_id, 'the AI saw the previous result');
  assert.match(secondRow.compiled_prompt, /a little warmer/);
  const view = getImageSessionView('u1', sessionId);
  assert.equal(view.runs[1].locked.width, 900, 'locked against the full-size original');

  // Refining while the AI version is on screen sends the AI redraw instead.
  const third = createImageRun({
    userId: 'u1',
    sessionId,
    kind: 'followup',
    model: 'test/image-model',
    instruction: 'less red',
    parentRunId: first,
    params: { mode: 'enhance', from: 'ai' },
  });
  runner.wake();
  const thirdRow = await finished(third);
  assert.equal(thirdRow.status, 'succeeded', thirdRow.error);
  assert.equal(thirdRow.input_asset_id, firstRow.ai_asset_id, 'the AI saw its own earlier redraw');
  assert.equal(getImageSessionView('u1', sessionId).runs[2].locked.width, 900, 'still locked against the original');
  runner.stop();
});

test('one user cannot see or delete another user’s session', async () => {
  const sessionId = await createImageSession({ userId: 'u1', buffer: await warmPhoto(), filename: 'a.jpg' });
  assert.equal(getImageSessionView('u2', sessionId), null);
  assert.equal(await deleteImageSession('u2', sessionId), false);
  assert.ok(getImageSessionView('u1', sessionId));
});

test('deleting a user removes every row and file that belonged to them', async () => {
  prepared('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run('gone', 'gone', 'gone@example.com', Date.now(), Date.now());
  const sessionId = await createImageSession({ userId: 'gone', buffer: await warmPhoto(), filename: 'gone.jpg' });
  createImageRun({ userId: 'gone', sessionId, kind: 'enhance', model: 'test/image-model', params: { mode: 'enhance' } });
  prepared('UPDATE image_runs SET status = ? WHERE user_id = ?').run('failed', 'gone');
  assert.ok(existsSync(absolutePath('gone')));

  // What account deletion does: the user row (everything cascades), then the media folder.
  prepared('DELETE FROM "user" WHERE id = ?').run('gone');
  await removeUserMedia('gone');

  for (const table of ['image_sessions', 'image_runs', 'assets', 'user_settings']) {
    assert.equal(prepared(`SELECT COUNT(*) AS c FROM ${table} WHERE user_id = ?`).get('gone').c, 0, table);
  }
  assert.equal(existsSync(absolutePath('gone')), false);
});

test('the sweeper removes day-old files no record points at, and nothing else', async () => {
  const old = (path) => {
    mkdirSync(dirname(absolutePath(path)), { recursive: true });
    writeFileSync(absolutePath(path), 'x');
    const then = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(absolutePath(path), then, then);
  };
  old('sweep-user/img-gone/orphan.jpg');
  old('sweep-user/img-gone/new.jpg.part');
  writeFileSync(absolutePath('sweep-user/img-gone/fresh.jpg'), 'x');
  const result = await sweepOrphanFiles();
  assert.ok(result.removed >= 2);
  assert.ok(!existsSync(absolutePath('sweep-user/img-gone/orphan.jpg')));
  assert.ok(!existsSync(absolutePath('sweep-user/img-gone/new.jpg.part')));
  assert.ok(existsSync(absolutePath('sweep-user/img-gone/fresh.jpg')), 'too new to touch');
});

test('Repair keeps the photo and records what it repaired; Upscale enlarges, with AI or for free', async () => {
  const runner = startImageRunner();
  const finished = (runId) =>
    waitFor(() => {
      const row = prepared('SELECT * FROM image_runs WHERE id = ?').get(runId);
      return row.status === 'succeeded' || row.status === 'failed' ? row : null;
    }, 40000);

  const repairId = await createImageSession({ userId: 'u1', buffer: await warmPhoto(), filename: 'scratched.jpg', mode: 'repair' });
  const repairRun = createImageRun({ userId: 'u1', sessionId: repairId, kind: 'repair', model: 'test/image-model', params: { mode: 'repair', analysis: false } });
  runner.wake();
  const repaired = await finished(repairRun);
  assert.equal(repaired.status, 'succeeded', repaired.error);
  assert.match(repaired.compiled_prompt, /^Repair the physical damage/);
  const repairView = getImageSessionView('u1', repairId).runs[0];
  assert.equal(repairView.locked.width, 900, 'the photo at its own size');
  assert.equal(repairView.fidelity.lock, 'repair');
  assert.equal(typeof repairView.fidelity.repaired, 'number');

  // A model that draws at 2K, as Upscale asks for.
  prepared("INSERT OR REPLACE INTO model_catalog (kind, model_id, data_json, fetched_at) VALUES ('image', 'test/big-model', ?, ?)").run(
    JSON.stringify({ id: 'test/big-model', supported_parameters: { resolution: { values: ['1K', '2K'] }, input_references: { max: 1 } } }),
    Date.now(),
  );
  const upscaleId = await createImageSession({ userId: 'u1', buffer: await warmPhoto(), filename: 'small.jpg', mode: 'upscale' });
  const aiRun = createImageRun({ userId: 'u1', sessionId: upscaleId, kind: 'upscale', model: 'test/big-model', params: { mode: 'upscale', analysis: false, resolution: '2K' } });
  const freeRun = createImageRun({ userId: 'u1', sessionId: upscaleId, kind: 'upscale', model: LOCAL_RESIZE, params: { mode: 'upscale', analysis: false } });
  runner.wake();
  for (const id of [aiRun, freeRun]) assert.equal((await finished(id)).status, 'succeeded');
  const [withAi, free] = getImageSessionView('u1', upscaleId).runs;
  // The mock draws at 2K, so the result is the photo at that density: 2048 × 1365.
  assert.equal(withAi.locked.width, 2048);
  assert.equal(withAi.locked.height, 1365);
  assert.ok(withAi.ai, 'the AI redraw is kept too');
  assert.ok(withAi.fidelity.factor > 2);
  // The free one is four times the photo (under 4K), with no AI redraw and no cost.
  assert.equal(free.locked.width, 3600);
  assert.equal(free.ai, null);
  assert.equal(free.costUsd, 0);
  assert.equal(free.fidelity.lock, 'resize');

  for (const id of [repairId, upscaleId]) await deleteImageSession('u1', id);
});

test('Edit Image: unpainted, the AI image is the result; painted, the photo is kept outside the area', async () => {
  const runner = startImageRunner();
  const finished = (runId) =>
    waitFor(() => {
      const row = prepared('SELECT * FROM image_runs WHERE id = ?').get(runId);
      return row.status === 'succeeded' || row.status === 'failed' ? row : null;
    }, 40000);
  const sessionId = await createImageSession({ userId: 'u1', buffer: await warmPhoto(), filename: 'edit.jpg', mode: 'edit' });
  const folder = sessionFolder('u1', 'image', sessionId);

  const whole = createImageRun({ userId: 'u1', sessionId, kind: 'edit', model: 'test/image-model', instruction: 'make it winter', params: { mode: 'edit', analysis: false } });
  runner.wake();
  const plain = await finished(whole);
  assert.equal(plain.status, 'succeeded', plain.error);
  assert.match(plain.compiled_prompt, /^Edit this photograph[\s\S]*make it winter/);
  assert.equal(plain.locked_asset_id, plain.ai_asset_id, 'one version: the AI image');
  assert.equal(JSON.parse(plain.fidelity_json).lock, 'edit');

  // Painted over the right third, as the browser sends it: white on black, smaller than the photo.
  const maskData = Buffer.alloc(300 * 200);
  for (let i = 0; i < maskData.length; i += 1) if (i % 300 >= 200) maskData[i] = 255;
  const mask = await storeAsset({
    userId: 'u1',
    imageSessionId: sessionId,
    folder,
    kind: 'mask',
    data: await sharp(maskData, { raw: { width: 300, height: 200, channels: 1 } }).png().toBuffer(),
    mime: 'image/png',
    ext: 'png',
    width: 300,
    height: 200,
  });
  const area = createImageRun({ userId: 'u1', sessionId, kind: 'edit', model: 'test/image-model', instruction: 'a red cap', params: { mode: 'edit', analysis: false, maskAssetId: mask.id } });
  runner.wake();
  const painted = await finished(area);
  assert.equal(painted.status, 'succeeded', painted.error);
  assert.match(painted.compiled_prompt, /^The area tinted red[\s\S]*a red cap/);
  assert.notEqual(painted.locked_asset_id, painted.ai_asset_id);
  const view = getImageSessionView('u1', sessionId).runs[1];
  assert.equal(view.locked.width, 900, 'the photo at its own size');
  assert.equal(view.maskId, mask.id);
  assert.equal(view.fidelity.lock, 'area');
  // The mock recolors everything; outside the paint the photo is its own, inside it is not.
  const [photo, locked] = await Promise.all([
    sharp(absolutePath(prepared('SELECT a.path FROM assets a JOIN image_sessions s ON s.source_asset_id = a.id WHERE s.id = ?').get(sessionId).path)).raw().toBuffer(),
    sharp(absolutePath(prepared('SELECT path FROM assets WHERE id = ?').get(painted.locked_asset_id).path)).raw().toBuffer(),
  ]);
  const differs = (x, y) => Math.max(...[0, 1, 2].map((c) => Math.abs(photo[(y * 900 + x) * 3 + c] - locked[(y * 900 + x) * 3 + c])));
  assert.ok(differs(100, 300) <= 3, `kept outside: ${differs(100, 300)}`);
  assert.ok(differs(800, 300) > 6, `changed inside: ${differs(800, 300)}`);

  // An unpainted result is one file for both versions; deleting it leaves no file behind.
  const plainPath = prepared('SELECT path FROM assets WHERE id = ?').get(plain.ai_asset_id).path;
  await deleteImageRun('u1', whole);
  assert.equal(existsSync(absolutePath(plainPath)), false);
  await deleteImageSession('u1', sessionId);
  assert.equal(existsSync(folder), false);
});

test('a photo marked done moves to Done, comes back on request, and on a new run', async () => {
  const sessionId = await createImageSession({ userId: 'u1', buffer: await warmPhoto(), filename: 'done.jpg' });
  const closed = () => listImageSessions('u1').find((session) => session.id === sessionId).closed_at;
  assert.equal(closed(), null, 'in progress to begin with');

  assert.ok(setImageSessionDone('u1', sessionId, true));
  assert.ok(closed() > 0);
  assert.ok(getImageSessionView('u1', sessionId).closedAt > 0);
  assert.equal(setImageSessionDone('someone-else', sessionId, false), false, 'only the owner');
  assert.ok(closed() > 0);

  assert.ok(setImageSessionDone('u1', sessionId, false));
  assert.equal(closed(), null);

  setImageSessionDone('u1', sessionId, true);
  createImageRun({ userId: 'u1', sessionId, kind: 'enhance', model: 'test/never-run', params: { mode: 'enhance' } });
  assert.equal(closed(), null, 'working on it again reopens it');
  await deleteImageSession('u1', sessionId);
});

test('several photos started together are shown in their order, only the owner’s and only this tool’s', async () => {
  const [a, b] = [await createImageSession({ userId: 'u1', buffer: await warmPhoto(), filename: 'a.jpg', mode: 'enhance' }), await createImageSession({ userId: 'u1', buffer: await warmPhoto(), filename: 'b.jpg', mode: 'enhance' })];
  const other = await createImageSession({ userId: 'u1', buffer: await warmPhoto(), filename: 'c.jpg', mode: 'repair' });
  const view = getBatchView('u1', [b, other, a, 'not-mine'], 'enhance');
  assert.deepEqual(view.map((photo) => photo.id), [b, a]);
  assert.equal(view[0].run, null, 'nothing made yet');
  assert.ok(view[0].source.displayId);
  assert.deepEqual(getBatchView('someone-else', [a, b], 'enhance'), []);

  createImageRun({ userId: 'u1', sessionId: a, kind: 'enhance', model: 'test/never-run', params: { mode: 'enhance' } });
  assert.equal(getBatchView('u1', [a], 'enhance')[0].run.status, 'queued');
  for (const id of [a, b, other]) await deleteImageSession('u1', id);
});
