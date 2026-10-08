import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { SHORT_SIDE } from '../video-pricing.js';

// Video helpers around ffmpeg/ffprobe (system binaries; FFMPEG_PATH / FFPROBE_PATH override)
// and sharp for the still frames a clip starts and ends on.

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const run = promisify(execFile);

/** Width, height, duration and codec of a video file. */
export async function probeVideo(path) {
  const { stdout } = await run(
    /* turbopackIgnore: true */ FFPROBE,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', path],
    { timeout: 30_000 },
  );
  const info = JSON.parse(stdout);
  const stream = info.streams?.[0];
  if (!stream?.width) throw new Error('The file is not a playable video.');
  return { width: stream.width, height: stream.height, codec: stream.codec_name, duration: Number(info.format?.duration) || null };
}

const ratioOf = (aspect) => {
  const [w, h] = String(aspect).split(':').map(Number);
  return w > 0 && h > 0 ? w / h : null;
};

/** The largest centred region of the photo with the given aspect ratio. */
function centreCrop(width, height, aspect) {
  const ratio = ratioOf(aspect) ?? width / height;
  const cropWidth = Math.min(width, Math.round(height * ratio));
  const cropHeight = Math.min(height, Math.round(width / ratio));
  return { left: Math.round((width - cropWidth) / 2), top: Math.round((height - cropHeight) / 2), width: cropWidth, height: cropHeight };
}

/**
 * The photo cut to the clip's aspect ratio: the exact first frame. Cropping here, not leaving it
 * to the model, means the video starts on precisely this picture.
 */
export async function frameFromPhoto(buffer, aspect, { maxEdge = 2048 } = {}) {
  const image = sharp(buffer, { limitInputPixels: 60_000_000 }).rotate();
  const { width, height } = await image.metadata().then((meta) => (meta.orientation >= 5 ? { width: meta.height, height: meta.width } : meta));
  const region = centreCrop(width, height, aspect);
  const { data, info } = await sharp(buffer, { limitInputPixels: 60_000_000 })
    .rotate()
    .extract(region)
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** One view of a frame (`{ zoom, x, y }`, as in a camera move), at the same size: for the frames a clip starts or ends on. */
export async function zoomedFrame(frame, { zoom, x, y }) {
  const { width, height } = await sharp(frame).metadata();
  const w = Math.round(width / zoom);
  const h = Math.round(height / zoom);
  const left = Math.min(width - w, Math.max(0, Math.round(x * width - w / 2)));
  const top = Math.min(height - h, Math.max(0, Math.round(y * height - h / 2)));
  const data = await sharp(frame).extract({ left, top, width: w, height: h }).resize(width, height, { kernel: 'lanczos3' }).jpeg({ quality: 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toBuffer();
  return { data, width, height };
}

/** Output pixel size for an aspect ratio and a named resolution ("1080p" → 1920×1080 or 1080×1920). */
export function clipSize(aspect, resolution) {
  const ratio = ratioOf(aspect) ?? 16 / 9;
  const short = SHORT_SIDE[resolution] ?? 1080;
  const even = (value) => Math.max(2, Math.round(value / 2) * 2);
  return ratio >= 1 ? { width: even(short * ratio), height: even(short) } : { width: even(short), height: even(short / ratio) };
}

/**
 * Renders a camera move over a still frame, locally: eased zoom and drift, drawn at twice the
 * output size and scaled down so the motion stays smooth. Nothing in the picture is generated.
 */
export function renderMotion({ input, output, width, height, duration, camera, fps = 30, signal }) {
  const { from, to } = camera;
  const p = `clip(t/${duration}\\,0\\,1)`;
  const ease = `(${p}*${p}*(3-2*${p}))`;
  const lerp = (a, b) => `(${a}+(${b - a})*${ease})`;
  const zoom = lerp(from.zoom, to.zoom);
  const W = width * 2;
  const H = height * 2;
  const filter = [
    `scale=w='trunc(${W}*${zoom}/2)*2':h='trunc(${H}*${zoom}/2)*2':eval=frame:flags=bicubic`,
    `crop=w=${W}:h=${H}:x='clip(${lerp(from.x, to.x)}*iw-${W / 2}\\,0\\,iw-${W})':y='clip(${lerp(from.y, to.y)}*ih-${H / 2}\\,0\\,ih-${H})'`,
    `scale=${width}:${height}:flags=lanczos`,
    'format=yuv420p',
  ].join(',');
  const args = ['-v', 'error', '-y', '-loop', '1', '-framerate', String(fps), '-t', String(duration), '-i', input, '-vf', filter];
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart', '-an', output);
  return ffmpeg(args, { signal });
}

/** Runs ffmpeg; resolves with what it wrote to stdout (for `pipe:1` outputs). */
function ffmpeg(args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let errors = '';
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      errors = (errors + chunk).slice(-2000);
    });
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(signal.reason ?? new Error('Stopped'));
      else if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg failed (${code}): ${errors.trim().split('\n').at(-1) ?? ''}`));
    });
  });
}

// An upload is read only as one of these containers, and only as a local file: ffmpeg also
// opens playlists and concat lists, which can point at other files on the server or the network.
const VIDEO_CONTAINERS = new Set(['mov,mp4,m4a,3gp,3g2,mj2', 'matroska,webm']);
const LOCAL_ONLY = ['-protocol_whitelist', 'file'];

/** What an uploaded video is: size, length, frame rate, and whether it has sound. Null for anything else. */
export async function inspectVideo(path) {
  const { stdout } = await run(
    /* turbopackIgnore: true */ FFPROBE,
    [...LOCAL_ONLY, '-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate:stream_side_data=rotation:format=duration,format_name', '-of', 'json', path],
    { timeout: 30_000 },
  );
  const info = JSON.parse(stdout);
  if (!VIDEO_CONTAINERS.has(info.format?.format_name)) return null;
  const video = info.streams?.find((stream) => stream.codec_type === 'video' && stream.width);
  if (!video) return null;
  const [num, den] = String(video.avg_frame_rate ?? '0/1').split('/').map(Number);
  // Phones record sideways and say so; the picture is shown, and re-encoded, turned upright.
  const turned = Math.abs(Number(video.side_data_list?.find((data) => data.rotation !== undefined)?.rotation ?? 0)) % 180 === 90;
  return {
    width: turned ? video.height : video.width,
    height: turned ? video.width : video.height,
    fps: den ? num / den : null,
    duration: Number(info.format?.duration) || null,
    audio: info.streams.some((stream) => stream.codec_type === 'audio'),
  };
}

/**
 * An uploaded video made ready to send: H.264 with AAC sound in an MP4, upright, at most
 * `maxShort` pixels on its short side and 30 frames a second — what every model reads, and
 * small enough to send inline.
 */
export function normalizeVideo({ input, output, info, maxShort = 1080, signal }) {
  const short = Math.min(info.width, info.height);
  const scale = short > maxShort ? (info.width < info.height ? `scale=${maxShort}:-2` : `scale=-2:${maxShort}`) : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const filters = [scale, ...(info.fps && info.fps > 30.5 ? ['fps=30'] : []), 'format=yuv420p'];
  const args = [...LOCAL_ONLY, '-v', 'error', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20'];
  args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', '-map_metadata', '-1', output);
  return ffmpeg(args, { signal });
}

/** The first frame of a video, as a JPEG: its poster, preview and thumbnail. */
export function videoStill(path) {
  return ffmpeg([...LOCAL_ONLY, '-v', 'error', '-i', path, '-frames:v', '1', '-q:v', '2', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1']);
}
