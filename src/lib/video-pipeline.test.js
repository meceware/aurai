import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'aurai-video-'));
// Each run's database and files go when it ends.
after(() => rmSync(process.env.DATA_DIR, { recursive: true, force: true }));
process.env.OPENROUTER_MOCK = 'true';

const { getDb, prepared } = await import('./db.js');
const { migrate } = await import('./migrate.js');
const { signToken, verifyToken } = await import('./crypto.js');
const { startVideoRunner } = await import('./jobs/video-runner.js');
const { absolutePath } = await import('./storage.js');
const { createVideoEditSession, createVideoJobs, createVideoSession, deleteVideoSession, editJobs, frameFor, getVideoSessionView, setVideoSessionDone } = await import('./video-sessions.js');
const { assetFor } = await import('./assets.js');
const { videoEditProfiles } = await import('./video-options.js');
const { editVideoLink, linkedVideo } = await import('./public-media.js');
const { LOCAL_MOTION } = await import('./video-pricing.js');
const { sentVideoRequests } = await import('./openrouter/mock.js');
const { fillTemplate, MOTION_PRESETS, VIDEO_EDIT_PROMPT, VIDEO_NEGATIVE_PROMPT, videoPrompt } = await import('./prompts/defaults.js');

migrate(getDb(), join(import.meta.dirname, '..', '..', 'migrations'));
prepared('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)').run('u1', 'u1', 'u1@local', Date.now(), Date.now());

const portrait = () =>
  sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 180, g: 150, b: 120 } } })
    .composite([{ input: Buffer.from('<svg width="900" height="1200"><circle cx="450" cy="500" r="200" fill="#523"/></svg>'), top: 0, left: 0 }])
    .jpeg()
    .toBuffer();

const waitFor = async (check, timeout = 30_000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('timed out');
};
const done = (status) => ['completed', 'failed', 'cancelled', 'expired', 'abandoned'].includes(status);

test('a photo becomes a clip from OpenRouter and a local one, compared side by side', async () => {
  const sessionId = await createVideoSession({ userId: 'u1', buffer: await portrait(), filename: 'grandpa_1950.jpg' });
  const frame = await frameFor('u1', sessionId, '9:16');
  assert.equal(await frameFor('u1', sessionId, '9:16'), frame, 'frames are reused');
  const anchored = await frameFor('u1', sessionId, '9:16', MOTION_PRESETS['parallax-in'].camera.to);
  assert.notEqual(anchored, frame);
  assert.equal(await frameFor('u1', sessionId, '9:16', MOTION_PRESETS['parallax-in'].camera.from), frame, 'the whole photo is the plain frame');

  const common = { preset: 'parallax-in', instruction: null, frameAssetId: frame };
  createVideoJobs({
    userId: 'u1',
    sessionId,
    jobs: [
      { ...common, model: 'test/video-model', params: { resolution: '720p', duration: 4, aspect: '9:16', audio: false, audioOption: true, lastFrameAssetId: anchored, anchor: true } },
      { ...common, model: LOCAL_MOTION, params: { resolution: '720p', duration: 2, aspect: '9:16' } },
    ],
  });
  const runner = startVideoRunner();
  runner.wake();

  const view = await waitFor(() => {
    const current = getVideoSessionView('u1', sessionId);
    return current.jobs.every((job) => done(job.status)) ? current : null;
  });
  assert.equal(view.title, 'grandpa 1950');
  for (const job of view.jobs) {
    assert.equal(job.status, 'completed', job.error);
    assert.ok(job.video && existsSync(absolutePath(prepared('SELECT path FROM assets WHERE id = ?').get(job.video.id).path)));
    assert.ok(job.video.height > job.video.width, 'portrait photo, portrait video');
  }
  assert.equal(view.jobs[0].groupId, view.jobs[1].groupId);
  assert.equal(view.jobs[1].video.width, 720);
  const sent = prepared('SELECT compiled_prompt FROM video_jobs WHERE model = ?').get('test/video-model').compiled_prompt;
  assert.match(sent, /^The input is one still photograph\. Treat it as a rigid, frozen scene/, 'the rule comes first');
  assert.ok(sent.indexOf('frozen') < sent.indexOf('push-in'), 'before the camera move');
  assert.doesNotMatch(sent, /Avoid|talking/, 'no list of what not to do in the prompt itself');
  const request = sentVideoRequests().find((body) => body.model === 'test/video-model');
  assert.deepEqual(request.frame_images.map((frame) => frame.frame_type), ['first_frame', 'last_frame']);
  assert.equal(request.generate_audio, false);
  assert.equal(request.provider, undefined, 'a model without extra settings gets none');

  runner.stop();
  await deleteVideoSession('u1', sessionId);
  assert.equal(prepared('SELECT COUNT(*) AS n FROM video_jobs').get().n, 0);
  assert.equal(prepared('SELECT COUNT(*) AS n FROM assets WHERE video_session_id = ?').get(sessionId).n, 0);
  assert.deepEqual(readdirSync(absolutePath('u1')), []);
});

test('the negative prompt reaches each provider under parameters, by its own name, and is dropped if refused', async () => {
  const insert = prepared("INSERT INTO model_catalog (kind, model_id, data_json, fetched_at) VALUES ('video', ?, ?, ?)");
  const models = {
    'test/vertex-model': { allowed_passthrough_parameters: ['personGeneration', 'negativePrompt', 'enhancePrompt'], _providers: ['google-vertex'] },
    'test/atlas-model': { allowed_passthrough_parameters: ['negative_prompt', 'cfg_scale'], _providers: ['atlas-cloud'] },
    'test/refuses-options': { allowed_passthrough_parameters: ['negative_prompt'], _providers: ['some-host'] },
  };
  for (const [id, entry] of Object.entries(models)) insert.run(id, JSON.stringify({ id, name: id, ...entry }), Date.now());
  const sessionId = await createVideoSession({ userId: 'u1', buffer: await portrait(), filename: 'p.jpg' });
  const frame = await frameFor('u1', sessionId, '9:16');
  const params = { resolution: '720p', duration: 2, aspect: '9:16' };
  createVideoJobs({
    userId: 'u1',
    sessionId,
    jobs: Object.keys(models).map((model) => ({ model, preset: 'parallax-in', instruction: 'end closer to the faces', frameAssetId: frame, params })),
  });
  const runner = startVideoRunner();
  runner.wake();
  await waitFor(() => getVideoSessionView('u1', sessionId).jobs.every((job) => done(job.status)));
  runner.stop();

  const prompt = videoPrompt({ motion: MOTION_PRESETS['parallax-in'].prompt, instruction: 'end closer to the faces' });
  assert.match(prompt, /\n\nAlso: end closer to the faces\n\nOne continuous shot/, 'their words, then the rule once more');
  // Exactly what went over the wire, with the photo itself left out.
  const sent = (model) => {
    const body = sentVideoRequests().find((request) => request.model === model);
    assert.match(body.frame_images[0].image_url.url, /^data:image\/jpeg;base64,/);
    body.frame_images[0].image_url.url = '<photo>';
    return body;
  };
  const plain = (model) => ({
    model,
    prompt,
    duration: 2,
    frame_images: [{ type: 'image_url', image_url: { url: '<photo>' }, frame_type: 'first_frame' }],
    resolution: '720p',
    aspect_ratio: '9:16',
  });
  assert.deepEqual(sent('test/vertex-model'), {
    ...plain('test/vertex-model'),
    provider: { options: { 'google-vertex': { parameters: { negativePrompt: VIDEO_NEGATIVE_PROMPT } } } },
  });
  assert.deepEqual(sent('test/atlas-model'), {
    ...plain('test/atlas-model'),
    provider: { options: { 'atlas-cloud': { parameters: { negative_prompt: VIDEO_NEGATIVE_PROMPT } } } },
  });
  // Turned down: sent again without it (the list never goes into the prompt), and not offered again.
  assert.deepEqual(sent('test/refuses-options'), plain('test/refuses-options'));
  const row = (model) => prepared('SELECT status, error, compiled_prompt FROM video_jobs WHERE model = ? AND session_id = ?').get(model, sessionId);
  for (const model of Object.keys(models)) assert.equal(row(model).status, 'completed', row(model).error);
  assert.match(row('test/vertex-model').compiled_prompt, /\(Negative prompt: people moving/);
  assert.equal(row('test/refuses-options').compiled_prompt, prompt);
  assert.equal(prepared('SELECT no_passthrough FROM model_hints WHERE model_id = ?').get('test/refuses-options').no_passthrough, 1);
  await deleteVideoSession('u1', sessionId);
});

test('a video is changed by a prompt: sent as a video to work from, as long as it is', async () => {
  // A 3-second landscape clip at 60 frames a second, with sound, as a phone might record it.
  const file = join(process.env.DATA_DIR, 'beach.mov');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', file]);
  const sessionId = await createVideoEditSession({ userId: 'u1', file, filename: 'beach_2019.mov' });
  const view = getVideoSessionView('u1', sessionId);
  assert.equal(view.tool, 'edit');
  assert.equal(view.title, 'beach 2019');
  assert.ok(view.source.video && view.source.audio);
  assert.deepEqual([view.source.width, view.source.height], [1280, 720]);
  assert.notEqual(view.source.displayId, view.source.id, 'its first frame is the preview');

  const insert = prepared("INSERT INTO model_catalog (kind, model_id, data_json, fetched_at) VALUES ('video-edit', ?, ?, ?)");
  // One model that follows the video, one that makes set lengths and sizes.
  insert.run('test/editor', JSON.stringify({ id: 'test/editor', name: 'Editor', _rank: 0 }), Date.now());
  const sized = { id: 'test/sized-editor', name: 'Sized', _rank: 1, supported_durations: [4, 5, 6], supported_resolutions: ['480p', '720p'], supported_aspect_ratios: ['16:9', '9:16'], generate_audio: true };
  insert.run(sized.id, JSON.stringify(sized), Date.now());
  const profiles = videoEditProfiles();
  assert.deepEqual(profiles.map((profile) => profile.id), ['test/editor', 'test/sized-editor']);

  const source = assetFor('u1', prepared('SELECT source_asset_id FROM video_sessions WHERE id = ?').get(sessionId).source_asset_id);
  createVideoJobs({ userId: 'u1', sessionId, jobs: editJobs({ source, profiles, resolution: '1080p', instruction: 'make it winter' }) });
  const runner = startVideoRunner();
  runner.wake();
  const done_ = await waitFor(() => {
    const current = getVideoSessionView('u1', sessionId);
    return current.jobs.every((job) => done(job.status)) ? current : null;
  });
  runner.stop();
  for (const job of done_.jobs) {
    assert.equal(job.status, 'completed', job.error);
    assert.ok(job.video.width > job.video.height, 'landscape in, landscape out');
  }

  const prompt = fillTemplate(VIDEO_EDIT_PROMPT, { instruction: 'make it winter' });
  // By a link made for that one edit (OpenRouter refuses a video sent inline), closed once it is done.
  const sent = (model) => {
    const body = sentVideoRequests().find((request) => request.model === model);
    const link = new URL(body.input_references[0].video_url.url);
    const jobId = prepared('SELECT id FROM video_jobs WHERE model = ? AND session_id = ?').get(model, sessionId).id;
    assert.match(link.pathname, new RegExp(`^/api/public-media/${jobId}\\.\\d+\\.[\\w-]+$`));
    assert.equal(linkedVideo(link.pathname.split('/').pop()), null, 'the edit is done, so the link no longer opens');
    body.input_references[0].video_url.url = '<video>';
    return body;
  };
  const video = [{ type: 'video_url', video_url: { url: '<video>' } }];
  // Exactly this: no frames, no motion, no negative prompt, and nothing the model does not list.
  assert.deepEqual(sent('test/editor'), { model: 'test/editor', prompt, input_references: video });
  assert.deepEqual(sent('test/sized-editor'), { model: 'test/sized-editor', prompt, duration: 4, input_references: video, resolution: '720p', aspect_ratio: '16:9', generate_audio: false });
  await deleteVideoSession('u1', sessionId);
});

test('an edit’s video link opens that video only while OpenRouter works on the edit', async () => {
  const file = join(process.env.DATA_DIR, 'link.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
  const sessionId = await createVideoEditSession({ userId: 'u1', file, filename: 'link.mp4' });
  const source = assetFor('u1', prepared('SELECT source_asset_id FROM video_sessions WHERE id = ?').get(sessionId).source_asset_id);
  const profile = { id: 'test/editor', durations: [], resolutions: [], aspectRatios: [], audio: false, pricing: { rates: [] }, learned: [] };
  const [jobId] = createVideoJobs({ userId: 'u1', sessionId, jobs: editJobs({ source, profiles: [profile], resolution: '720p', instruction: 'x' }) });
  const token = editVideoLink(jobId).split('/').pop();
  const status = (value) => prepared('UPDATE video_jobs SET status = ? WHERE id = ?').run(value, jobId);

  assert.equal(linkedVideo(token), null, 'not before it is sent');
  for (const value of ['submitting', 'pending', 'in_progress']) {
    status(value);
    assert.equal(linkedVideo(token)?.asset.id, source.id, value);
  }
  const [id, expires, signature] = token.split('.');
  assert.equal(linkedVideo(`${id}.${Number(expires) + 3600}.${signature}`), null, 'a later expiry is not signed');
  assert.equal(linkedVideo(token, Number(expires) * 1000 + 1), null, 'expired');
  assert.equal(linkedVideo(`${token}.x`), null);
  for (const value of ['downloading', 'completed', 'failed', 'abandoned']) {
    status(value);
    assert.equal(linkedVideo(token), null, value);
  }
  status('pending');
  await deleteVideoSession('u1', sessionId);
  assert.equal(linkedVideo(token), null, 'deleted');
});

test('a video session marked done reopens when a clip is started on it', async () => {
  const sessionId = await createVideoSession({ userId: 'u1', buffer: await portrait(), filename: 'done.jpg' });
  assert.ok(setVideoSessionDone('u1', sessionId, true));
  assert.ok(getVideoSessionView('u1', sessionId).closedAt > 0);
  createVideoJobs({ userId: 'u1', sessionId, jobs: [{ model: LOCAL_MOTION, preset: 'pan', frameAssetId: null, params: { resolution: '720p', duration: 2 } }] });
  assert.equal(getVideoSessionView('u1', sessionId).closedAt, null);
  await deleteVideoSession('u1', sessionId);
});

test('webhook links are signed per job', () => {
  const token = signToken('video-webhook', 'job-1');
  assert.ok(verifyToken('video-webhook', 'job-1', token));
  assert.ok(!verifyToken('video-webhook', 'job-2', token));
  assert.ok(!verifyToken('video-webhook', 'job-1', `${token.slice(0, -1)}x`));
});
