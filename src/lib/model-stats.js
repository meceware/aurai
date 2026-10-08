import { prepared } from './db.js';

// What models actually cost and how long they took, from finished runs. OpenRouter bills many
// image models per output token without saying how many tokens an image is, so a model's real
// price is only known once it has run; after that, every account benefits. Only aggregates leave
// this module, never anything about a particular run or person.

const WINDOW = 90 * 24 * 60 * 60 * 1000;
// Failures that say nothing about the model: the account, the key, a restart.
const NOT_THE_MODEL = /interrupted|api key|your key|credits|insufficient|unauthori[sz]ed|401|402|rate limit|deleted|storage is full/i;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const costKey = (resolution, quality) => `${resolution ?? '-'}|${quality ?? '-'}`;

/**
 * Per model id: `{ runs, failures, seconds, costs }`, where `costs` maps `costKey(resolution,
 * quality)` to `{ cost, runs }`. Only billed runs count, which leaves out mock-mode runs.
 */
export function runStats() {
  const rows = prepared(
    `SELECT model, status, model_cost_usd AS cost, duration_ms AS ms, error,
            json_extract(params_json, '$.resolution') AS resolution, json_extract(params_json, '$.quality') AS quality
     FROM image_runs WHERE created_at > ? AND status IN ('succeeded', 'failed')`,
  ).all(Date.now() - WINDOW);

  const models = new Map();
  for (const row of rows) {
    if (row.status === 'failed' && NOT_THE_MODEL.test(row.error ?? '')) continue;
    if (row.status === 'succeeded' && !(row.cost > 0)) continue;
    const entry = models.get(row.model) ?? { succeeded: 0, failures: 0, ms: [], costs: new Map() };
    models.set(row.model, entry);
    if (row.status === 'failed') {
      entry.failures += 1;
      continue;
    }
    entry.succeeded += 1;
    if (row.ms > 0) entry.ms.push(row.ms);
    const key = costKey(row.resolution, row.quality);
    entry.costs.set(key, [...(entry.costs.get(key) ?? []), row.cost]);
  }

  return new Map(
    [...models].map(([model, entry]) => [
      model,
      {
        runs: entry.succeeded + entry.failures,
        failures: entry.failures,
        seconds: entry.ms.length ? Math.round(median(entry.ms) / 1000) : null,
        costs: new Map([...entry.costs].map(([key, costs]) => [key, { cost: median(costs), runs: costs.length }])),
      },
    ]),
  );
}

/**
 * Per video model id: `{ runs, failures, seconds, perSecond }`, where `perSecond` maps
 * `costKey(resolution, audio ? 'audio' : null)` to `{ cost, runs }` — dollars per second of video,
 * so a run of one length prices another. `seconds` is how long a job took, end to end.
 */
export function videoStats() {
  const rows = prepared(
    `SELECT model, status, cost_usd AS cost, error, submitted_at, completed_at,
            json_extract(params_json, '$.resolution') AS resolution, json_extract(params_json, '$.duration') AS duration,
            json_extract(params_json, '$.audio') AS audio
     FROM video_jobs WHERE created_at > ? AND status IN ('completed', 'failed') AND model NOT LIKE 'local/%'`,
  ).all(Date.now() - WINDOW);

  const models = new Map();
  for (const row of rows) {
    if (row.status === 'failed' && NOT_THE_MODEL.test(row.error ?? '')) continue;
    if (row.status === 'completed' && !(row.cost > 0 && row.duration > 0)) continue;
    const entry = models.get(row.model) ?? { succeeded: 0, failures: 0, ms: [], rates: new Map() };
    models.set(row.model, entry);
    if (row.status === 'failed') {
      entry.failures += 1;
      continue;
    }
    entry.succeeded += 1;
    if (row.completed_at > row.submitted_at) entry.ms.push(row.completed_at - row.submitted_at);
    const key = costKey(row.resolution, row.audio ? 'audio' : null);
    entry.rates.set(key, [...(entry.rates.get(key) ?? []), row.cost / row.duration]);
  }

  return new Map(
    [...models].map(([model, entry]) => [
      model,
      {
        runs: entry.succeeded + entry.failures,
        failures: entry.failures,
        seconds: entry.ms.length ? Math.round(median(entry.ms) / 1000) : null,
        perSecond: new Map([...entry.rates].map(([key, rates]) => [key, { cost: median(rates), runs: rates.length }])),
      },
    ]),
  );
}
