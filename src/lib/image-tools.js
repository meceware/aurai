// The image tools as the person sees them. Each tool is its own menu entry, landing page and
// history; a session belongs to one tool (its `mode`). `dials` says whether its Local version
// takes the Color / Brightness / Exposure dials; `refine` whether a result can be refined; and
// `versions` how its two results are named.

const COLOR_VERSIONS = {
  locked: {
    label: 'Local',
    name: 'Local',
    help: "Your photo's own pixels at full resolution, with the AI's color correction applied here. Faces and details are untouched, and you can fine-tune it below.",
  },
  ai: { label: 'AI', name: 'AI redraw', help: 'The image the model drew. It can be smaller than your photo, and faces or small details may differ.' },
};

export const IMAGE_TOOLS = {
  enhance: {
    mode: 'enhance',
    path: '/enhance',
    title: 'Enhance',
    verb: 'Enhance',
    working: 'Enhancing…',
    resultLabel: 'Enhanced',
    heroTitle: "Bring back a photo's true colors",
    heroText:
      'Fix faded, yellowed or too-red colors and wrong exposure. The people and everything else in the photo stay exactly as they are — only the color changes.',
    empty: 'Photos you enhance will appear here.',
    placeholder: 'Optional: anything specific, e.g. “faces look too red”',
    dials: true,
    refine: true,
    versions: COLOR_VERSIONS,
  },
  colorize: {
    mode: 'colorize',
    path: '/colorize',
    title: 'Colorize',
    verb: 'Colorize',
    working: 'Colorizing…',
    resultLabel: 'Colorized',
    heroTitle: 'Add color to a black-and-white photo',
    heroText:
      'Natural, believable colors for black-and-white and sepia photos. Every face, shadow and detail stays exactly as photographed — only color is added.',
    empty: 'Photos you colorize will appear here.',
    placeholder: 'Optional: hints about the colors, e.g. “her dress was dark green”',
    dials: true,
    refine: true,
    versions: COLOR_VERSIONS,
  },
  repair: {
    mode: 'repair',
    path: '/repair',
    title: 'Repair',
    verb: 'Repair',
    working: 'Repairing…',
    resultLabel: 'Repaired',
    heroTitle: 'Fix scratches, dust and tears',
    heroText:
      'Remove scratches, dust, spots, creases and small tears from old photos. Only the damaged spots change; the rest of your photo stays exactly as it was.',
    empty: 'Photos you repair will appear here.',
    placeholder: 'Optional: anything specific, e.g. “the crease across her face”',
    dials: false,
    refine: true,
    versions: {
      locked: {
        label: 'Local',
        name: 'Local',
        help: "Your photo's own pixels, with the AI's repair only where it fixed damage, matched to the tones around it. Everything else is untouched.",
      },
      ai: { label: 'AI', name: 'AI redraw', help: 'The whole image as the model drew it. Faces or small details may differ from your photo.' },
    },
  },
  upscale: {
    mode: 'upscale',
    path: '/upscale',
    title: 'Upscale',
    verb: 'Upscale',
    working: 'Upscaling…',
    resultLabel: 'Upscaled',
    heroTitle: 'Make a small photo bigger and sharper',
    heroText:
      'Enlarge a small or low-resolution photo up to 4K. The shapes and colors stay your photo’s own; only finer detail is added. Or simply resize it, for free.',
    empty: 'Photos you upscale will appear here.',
    placeholder: 'Optional: anything specific, e.g. “keep the film grain”',
    dials: false,
    refine: false,
    versions: {
      locked: {
        label: 'Local',
        name: 'Local',
        help: "Your photo enlarged, with only the detail finer than it had taken from the AI. Every shape, face and color is your photo's own.",
      },
      ai: { label: 'AI', name: 'AI redraw', help: 'The whole image as the model drew it at high resolution. Faces or small details may differ from your photo.' },
    },
  },
};

// Several photos dropped at once go to one screen and are started together, up to this many.
export const MAX_BATCH_PHOTOS = 10;

export const toolFor = (mode) => IMAGE_TOOLS[mode] ?? IMAGE_TOOLS.enhance;
export const isImageMode = (mode) => Object.hasOwn(IMAGE_TOOLS, mode);
