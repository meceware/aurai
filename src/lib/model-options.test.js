import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'aurai-models-'));
// Each run's database and files go when it ends.
after(() => rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const { getDb, prepared } = await import('./db.js');
const { migrate } = await import('./migrate.js');
const { learnMinimumResolution } = await import('./catalog.js');
const { estimateCost, imageOptionsFor, largerResolution, resolutionFor, targetResolution } = await import('./model-options.js');
const { getPrefs, savePrefs } = await import('./preferences.js');

migrate(getDb(), join(import.meta.dirname, '..', '..', 'migrations'));

// A made-up catalog: the code knows no model by name, so neither does the test.
const catalog = [
  { id: 'acme/per-image', name: 'Acme: Per Image', _rank: 0, supported_parameters: { resolution: { values: ['1K', '2K', '4K'] } }, _pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.04 }] },
  { id: 'acme/per-token', name: 'Acme: Per Token', _rank: 1, supported_parameters: { resolution: { values: ['1K', '2K'] } }, _pricing: [{ billable: 'output_image', unit: 'token', cost_usd: 0.0001 }] },
  { id: 'acme/megapixel', name: 'Acme: Megapixel', _rank: 2, supported_parameters: {}, _pricing: [{ billable: 'output_image', unit: 'megapixel', cost_usd: 0.03 }] },
];
for (const model of catalog) prepared("INSERT INTO model_catalog (kind, model_id, data_json, fetched_at) VALUES ('image', ?, ?, ?)").run(model.id, JSON.stringify(model), Date.now());
prepared("INSERT INTO model_catalog (kind, model_id, data_json, fetched_at) VALUES ('vision', 'acme/eyes', ?, ?)").run(JSON.stringify({ id: 'acme/eyes', name: 'Eyes', _rank: 0 }), Date.now());
prepared("INSERT INTO model_catalog (kind, model_id, data_json, fetched_at) VALUES ('video', 'acme/motion', ?, ?)").run(JSON.stringify({ id: 'acme/motion', name: 'Motion', _rank: 0 }), Date.now());

prepared('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run('u1', 'u1', 'u1@local', Date.now(), Date.now());
prepared("INSERT INTO image_sessions (id, user_id, title, created_at, updated_at) VALUES ('s1', 'u1', 'x', ?, ?)").run(Date.now(), Date.now());
let runs = 0;
const run = (model, { status = 'succeeded', cost = null, resolution = null, error = null, ms = 20000 } = {}) =>
  prepared(
    `INSERT INTO image_runs (id, user_id, session_id, kind, model, params_json, status, error, model_cost_usd, duration_ms, created_at)
     VALUES (?, 'u1', 's1', 'enhance', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`r${(runs += 1)}`, model, JSON.stringify({ resolution }), status, error, cost, ms, Date.now());

test('a new account starts with the week’s most used models, and keeps them', () => {
  const prefs = getPrefs('u1');
  assert.deepEqual(prefs.enabledModels, ['acme/per-image', 'acme/per-token', 'acme/megapixel']);
  assert.equal(prefs.enhanceModel, 'acme/per-image');
  assert.equal(prefs.analysisModel, 'acme/eyes');
  assert.deepEqual([prefs.videoModels, prefs.videoModel], [['acme/motion'], 'acme/motion']);
  const stored = JSON.parse(prepared("SELECT prefs_json FROM user_settings WHERE user_id = 'u1'").get().prefs_json);
  assert.deepEqual(stored.enabledModels, prefs.enabledModels);
});

test('legacy or invalid model entries are dropped, and the defaults stay among the chosen', () => {
  const prefs = savePrefs('u1', { enabledModels: ['old-short-name', 'acme/per-token', 'acme/per-token'], enhanceModel: 'acme/per-image' });
  assert.deepEqual(prefs.enabledModels, ['acme/per-token']);
  assert.equal(prefs.enhanceModel, 'acme/per-token');
  savePrefs('u1', { enabledModels: catalog.map((model) => model.id) });
});

test('prices come from the published price, then from runs; per-token models wait for a run', () => {
  const [perImage, perToken, megapixel] = catalog;
  assert.deepEqual(estimateCost(perImage, { resolution: '2K' }), { cost: 0.04, approximate: false, basis: 'price' });
  assert.equal(estimateCost(megapixel, { resolution: null }).approximate, true);
  assert.deepEqual(estimateCost(perToken, { resolution: '2K' }), { cost: null, approximate: true, basis: 'tokens' });

  run('acme/per-token', { cost: 0.1, resolution: '2K' });
  run('acme/per-token', { cost: 0.12, resolution: '2K' });
  run('acme/per-token', { cost: 0.5, resolution: '2K' });
  run('acme/per-token', { cost: 0, resolution: '2K' }); // unbilled (mock) runs do not count
  const options = imageOptionsFor(getPrefs('u1'), { longEdge: 1800 });
  const token = options.find((option) => option.id === 'acme/per-token');
  assert.equal(token.resolution, '2K');
  assert.deepEqual([token.cost, token.basis, token.runs, token.approximate], [0.12, 'runs', 3, false]);
  assert.equal(token.seconds, 20);
  assert.equal(options.find((option) => option.id === 'acme/per-image').badge, 'Cheapest');
});

test('a refused resolution becomes the model’s minimum', () => {
  const [perImage] = catalog;
  assert.equal(targetResolution(900, '4K'), '1K');
  assert.equal(resolutionFor(perImage, '1K', null), '1K');
  assert.equal(largerResolution(perImage, '1K'), '2K');
  learnMinimumResolution('acme/per-image', '2K');
  assert.equal(resolutionFor(perImage, '1K'), '2K');
  assert.equal(resolutionFor(perImage, '4K'), '4K');
});

test('a model that keeps failing says so; account problems do not count against it', () => {
  run('acme/megapixel', { status: 'failed', error: 'The model refused this image.' });
  run('acme/megapixel', { status: 'failed', error: 'OpenRouter 402: insufficient credits' });
  run('acme/megapixel', { cost: 0.1 });
  const option = imageOptionsFor(getPrefs('u1'), { longEdge: 1800 }).find((candidate) => candidate.id === 'acme/megapixel');
  assert.equal(option.caveat, 'Failed 1 of its last 2 runs');
});
