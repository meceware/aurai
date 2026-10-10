// Default prompt templates. Users can override each one in Settings; `{{name}}` placeholders
// are filled by `fillTemplate`. Keep the preservation rules first: models weigh early
// instructions most.

export const ENHANCE_PROMPT = `Correct the colors of this photograph so it looks natural, with true-to-life color and tone. This is a color and tone correction only — the photo must stay the same photo.

Keep the shape, structure and detail of everything exactly as it is: every face, facial feature, expression, eyes, hair, body, pose, hands, clothing, every object, any text and the whole background. Keep the same composition, framing, crop, perspective and aspect ratio. Do not add, remove, move, reshape, retouch, beautify, smooth, sharpen, restyle or re-imagine anything. Do not repair damage or remove grain.

Change only color and tone:
- Remove color casts and correct the white balance; restore faded or yellowed colors.
- Correct skin tones decisively wherever they are off — too red, orange, pale, gray or green — so skin looks natural and healthy for the person and the light. Skin color is part of the correction; only its texture and shape must stay.
- Set a natural exposure: if the photo is clearly too dark or too bright, correct it to how the scene would have looked in real life. Do not brighten a photo that is already well exposed, do not flatten it, and do not leave it dull or dark. Keep deep shadows dark and highlights detailed — no washed-out blacks, no clipped whites, no glow, haze or HDR look.
- Restore natural contrast, and bring over- or under-saturated colors to a natural level.

Measured image diagnostics:
{{stats}}
{{analysis}}
{{instruction}}`;

export const COLORIZE_PROMPT = `Colorize this black-and-white (or toned monochrome) photograph with natural, historically plausible, true-to-life colors.

Keep exactly as they are: every face, facial feature, expression, eyes, skin texture, hair, body, pose, hands, clothing shapes, every object and any text, and the whole background. Keep the same composition, framing, crop, perspective and aspect ratio. Do not add, remove, move, reshape, retouch, beautify, smooth, sharpen or re-imagine anything. Keep the original brightness and shading of every area — only add color.

Use realistic skin tones, natural hair colors, believable fabric colors and natural colors for sky, foliage, wood, stone and other materials. Avoid oversaturation and avoid tinting the whole image one color.

Measured image diagnostics:
{{stats}}
{{analysis}}
{{instruction}}`;

// Repair: only damage is fixed. Aurai keeps the original's pixels everywhere the AI did not
// repair something (see media/repair-lock.js), so the rules below protect the AI redraw too.
const KEEP_EVERYTHING = `Keep everything else exactly as it is: every face, facial feature, expression, eyes, hair, body, pose, hands, clothing, every object, any text and the whole background. Keep the same composition, framing, crop, perspective and aspect ratio, the same colors and tones, and the photo's natural grain and sharpness. Do not retouch, beautify, smooth, sharpen, colorize or re-imagine anything that is not damaged.`;

export const REPAIR_PROMPT = `Repair the physical damage in this old photograph, and change nothing else.

Remove scratches, dust, spots, specks, cracks, creases, fold lines, stains, tears and water damage, and fill in small missing or torn areas so they match what is around them.

Damage is only what happened to the print itself. Wrinkles, freckles, moles, scars, stubble, patterns in fabric and marks that are part of the scene are not damage: keep them.

${KEEP_EVERYTHING}
{{instruction}}`;

export const REPAIR_FOLLOWUP_PROMPT = `This photograph has already been repaired. Repair what is described below, and nothing else.

Requested repair: {{instruction}}

${KEEP_EVERYTHING}`;

// Upscale: the AI's render supplies only detail finer than the original had (see
// media/upscale-lock.js); it is asked for the same photo, sharper.
export const UPSCALE_PROMPT = `Recreate this photograph at a higher resolution, as a sharper, more detailed version of the very same photo.

Keep everything exactly as it is: every face, facial feature, expression, eyes, hair, body, pose, hands, clothing, every object, any text and the whole background, with the same composition, framing, crop, perspective, aspect ratio, colors and lighting. Add only fine, natural detail that fits what is already there, such as skin texture, hair, fabric and crisp edges.

This is only an enlargement: keep any scratches, dust, stains or film grain as they are, and do not repair, retouch, smooth or colorize anything. Do not add, remove, move, reshape, beautify or restyle anything, and do not give it an artificial, over-sharpened or painted look.
{{instruction}}`;

// Edit Image: the person's words are the edit. Painted, the model is shown the photo with the
// area tinted red (no image model on OpenRouter takes a mask), and Aurai keeps the photo's own
// pixels outside it (see media/area-lock.js).
export const EDIT_PROMPT = `Edit this photograph as described below.

The edit: {{instruction}}

Keep everything the edit does not mention as it is: the people and their faces, everything else in the photo, the framing and the aspect ratio.`;

export const EDIT_AREA_PROMPT = `The area tinted red in this photo is the part to change. Change it as described below, and nothing else: keep everything outside it exactly as it is, and leave no red tint anywhere.

The change: {{instruction}}`;

export const DEFAULT_PROMPTS = {
  enhance: ENHANCE_PROMPT,
  colorize: COLORIZE_PROMPT,
  repair: REPAIR_PROMPT,
  upscale: UPSCALE_PROMPT,
  edit: EDIT_PROMPT,
};

/** Replaces `{{name}}` with the value, dropping lines whose placeholder resolved to nothing. */
export function fillTemplate(template, values) {
  return template
    .split('\n')
    .map((line) => {
      const names = [...line.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      if (names.length && names.every((name) => !String(values[name] ?? '').trim())) return null;
      return line.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? '').trim());
    })
    .filter((line) => line !== null)
    .join('\n')
    .trim();
}

// Video: the photo is filmed, never acted. The rule comes first, because models weigh early words
// most: one photograph, a rigid and frozen scene, where only the virtual camera moves. Then the
// move, said as what the camera does, and the person's own words, then the rule once more. What
// must not happen is never listed here — naming "talking" or "hands" tends to bring them in — but
// goes to models that take a negative prompt of their own (VIDEO_NEGATIVE_PROMPT).
// `camera` is the move as views of the photo — zoom and the point in view (0–1 of the frame) at
// the start and the end — for the local renderer, and for the frames given to a model: it starts
// on the `from` view and, where it takes a last frame, ends on the `to` view, both cut from the
// photo itself.
const FROZEN = `The input is one still photograph. Treat it as a rigid, frozen scene: every person, face, hand, strand of hair, piece of clothing and object stays exactly as photographed in every frame, from the first to the last. Nothing in the scene moves, changes or appears. Only the virtual camera moves.`;
const ONE_SHOT = `One continuous shot with no cuts. The content of the photograph never changes; only the camera's position and framing do.`;
const motionPrompt = (camera) => `${FROZEN}\n\nCamera: ${camera}\n\n{{instruction}}\n\n${ONE_SHOT}`;

export const MOTION_PRESETS = {
  'parallax-in': {
    label: 'Push in',
    description: 'The camera moves slowly closer to the people.',
    prompt: motionPrompt(
      'a slow, smooth push-in straight toward the people, ending on a closer framing of the same photograph. Nearer things grow very slightly faster than the background, as when a real camera moves through a still scene.',
    ),
    camera: { from: { zoom: 1, x: 0.5, y: 0.5 }, to: { zoom: 1.12, x: 0.5, y: 0.45 } },
    localMotion: 'a flat zoom in, with no depth between foreground and background',
  },
  'parallax-out': {
    label: 'Pull back',
    description: 'The camera starts close on the people and slowly pulls back to the whole photo.',
    prompt: motionPrompt('starting on a close framing of the people, a slow, smooth pull-back that ends on the whole photograph.'),
    camera: { from: { zoom: 1.12, x: 0.5, y: 0.45 }, to: { zoom: 1, x: 0.5, y: 0.5 } },
    localMotion: 'a flat zoom out, with no depth between foreground and background',
  },
  pan: {
    label: 'Pan',
    description: 'A slow sideways camera move across the photo, from left to right.',
    prompt: motionPrompt(
      'a slow, smooth sideways glide from the left part of the photograph to the right part, at the same distance throughout. Nearer things pass very slightly faster than the background.',
    ),
    camera: { from: { zoom: 1.12, x: 0.44, y: 0.5 }, to: { zoom: 1.12, x: 0.56, y: 0.5 } },
    localMotion: 'a flat sideways move, with no depth between foreground and background',
  },
};

// Moves that were offered once. Their clips keep their name but cannot be made again: a dolly
// zoom changes perspective, which a frozen photo cannot do without the model inventing depth.
export const RETIRED_MOTIONS = { vertigo: { label: 'Vertigo' } };

export const VIDEO_NEGATIVE_PROMPT =
  'people moving, hand gestures, moving hands or fingers, head turning, nodding, blinking, talking, lip movement, changing expression, breathing, hair or clothes moving, morphing, distorted faces, extra limbs, new people, new objects, scene cut, flicker, text, watermark';

/**
 * The prompt one clip is sent with: the motion with the person's own words in their place (or
 * after it, for a motion prompt of their own without `{{instruction}}`).
 */
export function videoPrompt({ motion, instruction }) {
  const also = instruction?.trim() ? `Also: ${instruction.trim()}` : '';
  if (motion.includes('{{instruction}}')) return fillTemplate(motion, { instruction: also }).replace(/\n{3,}/g, '\n\n');
  return [motion.trim(), also].filter(Boolean).join('\n\n');
}

// Edit Video: the person's words are the edit; everything they do not mention stays as filmed.
export const VIDEO_EDIT_PROMPT = `Edit this video as described below, and change nothing else.

The edit: {{instruction}}

Keep everything the edit does not mention exactly as it is: the people and their faces, every movement and its timing, the camera movement, the framing, and the length of the video.`;

// A follow-up edits the previous colour-locked result, which is what the person is looking at.
export const FOLLOWUP_PROMPT = `This photograph has already been color-corrected. Make one further adjustment to its colors, exactly as requested below, and nothing else.

Requested adjustment: {{instruction}}

Keep the shape, structure and detail of everything exactly as it is: every face, facial feature, expression, eyes, hair, body, pose, hands, clothing, every object, any text and the whole background. Keep the same composition, framing, crop, perspective and aspect ratio. Do not add, remove, move, reshape, retouch, beautify, smooth, sharpen or re-imagine anything. Leave all colors and the brightness of everything the request does not mention as they are.`;

DEFAULT_PROMPTS.followup = FOLLOWUP_PROMPT;

// Analysis: a vision model looks at the photo (and the measurements) before the edit, and its
// findings become specific instructions in the edit prompt.
export const ANALYSIS_PROMPT = `You are an expert photo restorer looking at an old or badly colored photograph before it is color-corrected. Only color and tone matter here — not damage, sharpness or composition. The goal is a natural-looking photo with true-to-life colors.

Identify what is wrong with the colors: color casts (and in which areas), fading, yellowing, unnatural skin tones (too red, orange, pale, gray, green), low contrast, over- or under-saturated areas, and exposure that is clearly too dark or too bright. Mention where each problem is (for example "faces", "sky", "shadows", "whole image").

Then write short, concrete correction instructions for an image editor, limited to color and tone, such as "neutralize the yellow cast in the highlights" or "reduce the red in the faces so skin looks natural".

About exposure: only ask for a brightness change when the photo is clearly too dark or too bright, and say how much ("slightly", "noticeably"). Do not ask to brighten a photo that is already reasonably exposed, and do not ask to lift shadows that are naturally dark, such as a night scene or a flash-lit background. Prefer fixing color over changing brightness.

Measured statistics, for reference:
{{stats}}`;

export const ANALYSIS_SCHEMA = {
  name: 'color_analysis',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scene', 'people', 'monochrome', 'issues', 'corrections'],
    properties: {
      scene: { type: 'string', description: 'One short sentence describing the photo.' },
      people: { type: 'integer', description: 'Number of people visible.' },
      monochrome: { type: 'boolean', description: 'True if the photo is black-and-white or a single tone such as sepia.' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['problem', 'where', 'severity'],
          properties: {
            problem: { type: 'string' },
            where: { type: 'string' },
            severity: { type: 'string', enum: ['mild', 'moderate', 'strong'] },
          },
        },
      },
      corrections: { type: 'array', items: { type: 'string' } },
    },
  },
};
