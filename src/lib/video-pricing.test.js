import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aspectFor, durationFor, estimateVideo, parsePricing, planClip, videoResolutionFor } from './video-pricing.js';

// Shapes copied from OpenRouter's video catalog, under made-up names.
const perSecondByAudio = {
  resolutions: ['720p', '1080p', '4K'],
  durations: [4, 6, 8],
  aspectRatios: ['16:9', '9:16'],
  audio: true,
  pricing: parsePricing({
    duration_seconds_with_audio: '0.12',
    duration_seconds_with_audio_4k: '0.30',
    duration_seconds_without_audio: '0.10',
    duration_seconds_without_audio_4k: '0.25',
    duration_seconds_without_audio_720p: '0.08',
  }),
};
const centsWithInput = { resolutions: ['480p', '720p'], durations: [1, 2, 3, 4, 5, 6], aspectRatios: ['16:9', '9:16', '1:1'], pricing: parsePricing({ cents_per_image_input: '1', cents_per_video_output_second_720p: '14' }) };
const imageToVideoOnly = {
  resolutions: ['720p', '1080p'],
  durations: [5, 10],
  pricing: parsePricing({ text_to_video_duration_seconds_720p: '0.08', image_to_video_duration_seconds_720p: '0.10', image_to_video_duration_seconds_1080p: '0.15' }),
};
const tokens = { resolutions: ['480p', '720p'], durations: [4, 5, 6], pricing: parsePricing({ video_tokens: '0.0000042' }) };
const minimum = { resolutions: ['720p'], durations: [5], pricing: parsePricing({ cents_per_second_output: '28', minimum_cents_per_generation: '56', reference_duration_seconds: '9' }) };

test('per-second prices pick the size and sound that apply', () => {
  assert.deepEqual(estimateVideo(perSecondByAudio, { resolution: '720p', duration: 6, audio: false }), { cost: 0.48, approximate: false, basis: 'price' });
  assert.equal(estimateVideo(perSecondByAudio, { resolution: '1080p', duration: 6, audio: false }).cost.toFixed(2), '0.60');
  assert.equal(estimateVideo(perSecondByAudio, { resolution: '4K', duration: 8, audio: true }).cost.toFixed(2), '2.40');
  assert.equal(estimateVideo(centsWithInput, { resolution: '720p', duration: 5, audio: false }).cost.toFixed(2), '0.71');
  assert.equal(estimateVideo(imageToVideoOnly, { resolution: '720p', duration: 5, audio: false }).cost.toFixed(2), '0.50');
  assert.equal(estimateVideo(minimum, { resolution: '720p', duration: 1, audio: false }).cost.toFixed(2), '0.56');
});

test('per-token models are priced from earlier clips, or not at all', () => {
  assert.deepEqual(estimateVideo(tokens, { resolution: '720p', duration: 5, audio: false }), { cost: null, approximate: true, basis: 'tokens' });
  const learned = { ...tokens, learned: [['720p|-', { cost: 0.05, runs: 2 }]] };
  assert.deepEqual(estimateVideo(learned, { resolution: '720p', duration: 4, audio: false }), { cost: 0.2, approximate: false, basis: 'runs', runs: 2 });
  assert.equal(estimateVideo(learned, { resolution: '480p', duration: 4, audio: false }).approximate, true);
});

test('size, length and shape come from what the model supports', () => {
  assert.equal(videoResolutionFor(perSecondByAudio, '2K'), '1080p');
  assert.equal(videoResolutionFor(centsWithInput, '1080p'), '720p');
  assert.equal(videoResolutionFor(perSecondByAudio, '480p'), '720p');
  assert.equal(videoResolutionFor({ resolutions: ['480p', '768p', '2K'] }, '720p'), '768p');
  assert.equal(durationFor(perSecondByAudio, 5), 4);
  assert.equal(durationFor(imageToVideoOnly, 8), 10);
  // A portrait photo stays portrait; a square one is square where the model allows it.
  assert.equal(aspectFor(perSecondByAudio.aspectRatios, 1280, 1600), '9:16');
  assert.equal(aspectFor(centsWithInput.aspectRatios, 1000, 1000), '1:1');
  assert.equal(aspectFor(perSecondByAudio.aspectRatios, 1000, 1000), '16:9');
  const clip = planClip(perSecondByAudio, { target: '1080p', duration: 5, audio: true, width: 1920, height: 1080 });
  assert.deepEqual([clip.resolution, clip.duration, clip.aspect, clip.audio], ['1080p', 4, '16:9', true]);
});
