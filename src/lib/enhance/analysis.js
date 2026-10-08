import { ANALYSIS_PROMPT, ANALYSIS_SCHEMA, fillTemplate } from '../prompts/defaults.js';

// A vision model (chosen in Settings; a cheap one is enough) names the problems, so the
// expensive image model gets specific instructions instead of a generic request.

const MAX_ITEMS = 8;

function sanitize(result) {
  const text = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return {
    scene: text(result.scene),
    people: Number.isInteger(result.people) ? Math.max(0, Math.min(100, result.people)) : null,
    monochrome: Boolean(result.monochrome),
    issues: (Array.isArray(result.issues) ? result.issues : []).slice(0, MAX_ITEMS).map((issue) => ({
      problem: text(issue?.problem, 120),
      where: text(issue?.where, 60),
      severity: ['mild', 'moderate', 'strong'].includes(issue?.severity) ? issue.severity : 'moderate',
    })),
    corrections: (Array.isArray(result.corrections) ? result.corrections : []).slice(0, MAX_ITEMS).map((c) => text(c, 160)).filter(Boolean),
  };
}

function request({ dataUrl, statsText, model, template }, maxTokens) {
  return {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: fillTemplate(template || ANALYSIS_PROMPT, { stats: statsText }) },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: ANALYSIS_SCHEMA },
    temperature: 0.2,
    // Reasoning models count hidden "thinking" against max_tokens; with the default effort it could use
    // most of an 800-token budget and cut the JSON off mid-string. This task needs no reasoning.
    reasoning: { effort: 'low', exclude: true },
    max_tokens: maxTokens,
  };
}

function parse(response) {
  const choice = response?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('The analysis was cut off');
  const content = choice?.message?.content;
  const raw = typeof content === 'string' ? content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '') : '';
  return sanitize(JSON.parse(raw));
}

/**
 * Returns { analysis, cost } or throws; callers treat a failure as "no analysis". A cut-off or
 * malformed reply is retried once with a larger budget.
 */
export async function analyzePhoto(client, { dataUrl, statsText, model, template, signal }) {
  let cost = 0;
  for (const maxTokens of [4000, 8000]) {
    const response = await client.chat(request({ dataUrl, statsText, model, template }, maxTokens), { signal, timeout: 60_000 });
    cost += response?.usage?.cost ?? 0;
    try {
      return { analysis: parse(response), cost };
    } catch (error) {
      if (maxTokens === 8000) throw error;
    }
  }
  throw new Error('unreachable');
}

/** The analysis as instructions inside the edit prompt. */
export function describeAnalysis(analysis) {
  if (!analysis) return '';
  const lines = [];
  if (analysis.issues.length) {
    lines.push('Color problems found in this photo:');
    for (const issue of analysis.issues) lines.push(`- ${issue.problem} (${issue.where}, ${issue.severity})`);
  }
  if (analysis.corrections.length) {
    lines.push('Corrections to make:');
    for (const correction of analysis.corrections) lines.push(`- ${correction}`);
  }
  return lines.join('\n');
}
