import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NEGATIVE_PROMPT, passthroughName, providerOptions, videoRequest } from './video-request.js';

// What goes over the wire, after the trip through JSON: anything extra or misplaced fails.
const wire = (body) => JSON.parse(JSON.stringify(body));

test('extra settings go under parameters for every provider, by the model’s own names', () => {
  const veo = { allowed_passthrough_parameters: ['personGeneration', 'negativePrompt', 'conditioningScale', 'enhancePrompt'] };
  const kling = { allowed_passthrough_parameters: ['negative_prompt', 'cfg_scale'] };
  assert.equal(passthroughName(veo, NEGATIVE_PROMPT), 'negativePrompt');
  assert.equal(passthroughName(kling, NEGATIVE_PROMPT), 'negative_prompt');
  assert.equal(passthroughName({ allowed_passthrough_parameters: ['watermark'] }, NEGATIVE_PROMPT), null);

  assert.deepEqual(wire(providerOptions(['google-vertex'], { negativePrompt: 'talking' })), {
    options: { 'google-vertex': { parameters: { negativePrompt: 'talking' } } },
  });
  assert.deepEqual(wire(providerOptions(['atlas-cloud'], { negative_prompt: 'talking' })), {
    options: { 'atlas-cloud': { parameters: { negative_prompt: 'talking' } } },
  });
  assert.equal(providerOptions(['atlas-cloud'], {}), null, 'nothing to send, no provider block');
  assert.equal(providerOptions([], { negative_prompt: 'talking' }), null, 'no provider to address it to');
});

test('a clip request carries exactly what was chosen, and nothing left to the defaults', () => {
  const body = videoRequest({
    model: 'google/veo-x',
    prompt: 'Only the camera moves.',
    duration: 4,
    frames: [
      { url: 'data:image/jpeg;base64,AAA', type: 'first_frame' },
      { url: 'data:image/jpeg;base64,BBB', type: 'last_frame' },
    ],
    resolution: '1080p',
    aspect: '9:16',
    audio: false,
    callback: 'https://aurai.example/api/webhooks/openrouter/job?t=sig',
    provider: providerOptions(['google-vertex'], { negativePrompt: 'talking' }),
  });
  assert.equal(
    JSON.stringify(body),
    JSON.stringify({
      model: 'google/veo-x',
      prompt: 'Only the camera moves.',
      duration: 4,
      frame_images: [
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' }, frame_type: 'first_frame' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBB' }, frame_type: 'last_frame' },
      ],
      resolution: '1080p',
      aspect_ratio: '9:16',
      generate_audio: false,
      callback_url: 'https://aurai.example/api/webhooks/openrouter/job?t=sig',
      provider: { options: { 'google-vertex': { parameters: { negativePrompt: 'talking' } } } },
    }),
  );

  // A model without sound gets no switch for it, and nothing unset is sent.
  assert.deepEqual(wire(videoRequest({ model: 'm', prompt: 'p', duration: 5, audio: undefined })), { model: 'm', prompt: 'p', duration: 5 });
});

test('every motion prompt is sent filled in, with or without the person’s words', async () => {
  const { MOTION_PRESETS, videoPrompt } = await import('./prompts/defaults.js');
  for (const [key, preset] of Object.entries(MOTION_PRESETS)) {
    for (const instruction of [undefined, '', 'end closer to the faces']) {
      const prompt = videoPrompt({ motion: preset.prompt, instruction });
      assert.doesNotMatch(prompt, /\{\{|\}\}|\n{3,}/, `${key} with ${JSON.stringify(instruction)}`);
      assert.equal(prompt.includes('Also: end closer to the faces'), Boolean(instruction), key);
    }
  }
});
