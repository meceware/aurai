import 'server-only';
import { keyClient, keyClientFor } from './index.js';

function describe(info, credits) {
  const data = info?.data ?? {};
  const total = credits?.data;
  return {
    label: data.label ?? null,
    usage: typeof data.usage === 'number' ? data.usage : null,
    limit: typeof data.limit === 'number' ? data.limit : null,
    remaining: typeof data.limit_remaining === 'number' ? data.limit_remaining : null,
    balance: total ? Math.max(0, (total.total_credits ?? 0) - (total.total_usage ?? 0)) : null,
    freeTier: Boolean(data.is_free_tier),
  };
}

async function inspect(client) {
  const [info, credits] = await Promise.all([client.keyInfo({ timeout: 10_000 }), client.credits({ timeout: 10_000 }).catch(() => null)]);
  return describe(info, credits);
}

const problem = (error) => (error.status === 401 ? 'OpenRouter rejected this key.' : `Could not reach OpenRouter: ${error.message}`);

/** Never throws: resolves to { details } or { error }, so a page can stream it in safely. */
export async function keyDetailsFor(userId) {
  try {
    return { details: await inspect(keyClientFor(userId)) };
  } catch (error) {
    return { error: problem(error) };
  }
}

export async function keyDetailsForKey(apiKey) {
  try {
    return { details: await inspect(keyClient(apiKey)) };
  } catch (error) {
    return { error: problem(error) };
  }
}
