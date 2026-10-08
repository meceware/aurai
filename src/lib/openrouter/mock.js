// Stand-in for OpenRouter when OPENROUTER_MOCK=1: same method shapes, canned answers and
// realistic delays, so the UI and browser tests run end to end without spending credits.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { clipSize, renderMotion } from '../media/video.js';
import { linkedVideo } from '../public-media.js';
import { absolutePath } from '../storage.js';
import { OpenRouterError } from './client.js';

// Mock video jobs live for the process: submitted → in progress → completed over a few seconds.
const videoJobs = (globalThis.__auraiMockVideos ??= new Map());

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

/** What OpenRouter would fetch by an edit's link, read here directly (there is no server in tests). */
async function fetchLinked(url) {
  const linked = linkedVideo(new URL(url).pathname.split('/').pop());
  if (!linked) throw new OpenRouterError('The video link did not open', { status: 400 });
  return readFile(absolutePath(linked.asset.path));
}

/** The "edit": the first two seconds of the video, without color. */
async function grayVideo(bytes, signal) {
  const input = join(tmpdir(), `aurai-mock-${randomUUID()}.mp4`);
  const output = join(tmpdir(), `aurai-mock-${randomUUID()}.mp4`);
  await writeFile(input, bytes);
  await new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-y', '-i', input, '-t', '2', '-vf', 'hue=s=0,format=yuv420p', '-c:v', 'libx264', '-an', output]);
    signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`mock ffmpeg failed (${code})`))));
  });
  await rm(input, { force: true });
  const stream = createReadStream(output);
  stream.on('close', () => rm(output, { force: true }));
  return new Response(Readable.toWeb(stream), { headers: { 'content-type': 'video/mp4' } });
}

/** Every video request "sent" so far, as OpenRouter would have received it. */
export const sentVideoRequests = () => [...videoJobs.values()].map((job) => job.body);

export function createMockClient() {
  return {
    mock: true,
    async keyInfo() {
      await wait(200);
      return { data: { label: 'mock-key', limit: null, usage: 1.23, limit_remaining: null, is_free_tier: false } };
    },
    async credits() {
      return { data: { total_credits: 10, total_usage: 1.23 } };
    },
    /**
     * "Restores" by neutralising the cast and lifting contrast — enough to see a difference — at
     * the size asked for, as models draw at their own resolution.
     */
    async generateImage(body, { signal } = {}) {
      await wait(2500, signal);
      const url = body.input_references?.[0]?.image_url?.url ?? '';
      const input = Buffer.from(url.split(',')[1] ?? '', 'base64');
      const edge = { '1K': 1024, '2K': 2048, '4K': 4096 }[body.resolution];
      let image = sharp(input).normalise().modulate({ saturation: 1.1 }).linear([0.92, 1, 1.12], [6, 0, -4]);
      if (edge) image = image.resize({ width: edge, height: edge, fit: 'inside' });
      const output = await image.jpeg().toBuffer();
      return { data: [{ b64_json: output.toString('base64'), media_type: 'image/jpeg' }], usage: { cost: 0 } };
    },
    async submitVideo(body) {
      await wait(300);
      // Lets tests see a provider turn down extra settings, as some do.
      if (body.provider && body.model.includes('refuses-options')) throw new OpenRouterError('Unsupported provider options', { status: 400 });
      const id = `mock-${randomUUID()}`;
      // A video to work from is fetched now, while its link is open, as OpenRouter does.
      const reference = body.input_references?.find((item) => item.type === 'video_url');
      const video = reference ? await fetchLinked(reference.video_url.url) : null;
      // Kept as it would arrive, after the trip through JSON, for tests to read back.
      videoJobs.set(id, { body: JSON.parse(JSON.stringify(body)), video, created: Date.now() });
      return { id, status: 'pending', polling_url: `https://openrouter.ai/api/v1/videos/${id}` };
    },
    async getVideo(id) {
      const job = videoJobs.get(id);
      if (!job) throw new OpenRouterError('Job not found', { status: 404 });
      const age = Date.now() - job.created;
      if (age < 1500) return { id, status: 'pending' };
      if (age < 4000) return { id, status: 'in_progress' };
      return { id, status: 'completed', unsigned_urls: [`https://openrouter.ai/api/v1/videos/${id}/content?index=0`], usage: { cost: 0 } };
    },
    /** A real, short clip: a slow zoom over the first frame that was sent, or the video sent, in gray. */
    async downloadVideo(url, { signal } = {}) {
      const id = new URL(url).pathname.split('/').at(-2);
      const job = videoJobs.get(id);
      if (!job) throw new Error('Job not found');
      if (job.video) return grayVideo(job.video, signal);
      const frame = Buffer.from(job.body.frame_images[0].image_url.url.split(',')[1], 'base64');
      const input = join(tmpdir(), `aurai-mock-${randomUUID()}.jpg`);
      const output = join(tmpdir(), `aurai-mock-${randomUUID()}.mp4`);
      await writeFile(input, frame);
      const size = clipSize(job.body.aspect_ratio, '480p');
      await renderMotion({ input, output, ...size, duration: Math.min(2, job.body.duration ?? 2), fps: 12, camera: { from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.1, x: 0.5, y: 0.5 } }, signal });
      await rm(input, { force: true });
      const stream = createReadStream(output);
      stream.on('close', () => rm(output, { force: true }));
      return new Response(Readable.toWeb(stream), { headers: { 'content-type': 'video/mp4' } });
    },
    async chat() {
      await wait(800);
      const analysis = {
        scene: 'A portrait photograph (mock analysis).',
        people: 1,
        monochrome: false,
        issues: [
          { problem: 'Warm yellow cast', where: 'whole image', severity: 'strong' },
          { problem: 'Faded contrast with lifted blacks', where: 'shadows', severity: 'moderate' },
        ],
        corrections: ['Neutralise the yellow cast so whites look white', 'Deepen the shadows to restore contrast'],
      };
      return { choices: [{ message: { content: JSON.stringify(analysis) } }], usage: { cost: 0 } };
    },
  };
}
