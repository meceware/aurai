// Thin OpenRouter client. Every call takes the caller's own key: there is deliberately no
// server-wide fallback, so a missing key is an error rather than someone else's bill.

export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DOWNLOAD_HOST = 'openrouter.ai';

export class OpenRouterError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function failure(response) {
  const text = await response.text().catch(() => '');
  let message = `OpenRouter ${response.status}`;
  let code;
  try {
    const parsed = JSON.parse(text);
    message = parsed?.error?.message || parsed?.message || message;
    code = parsed?.error?.code;
  } catch {
    if (text) message = `${message}: ${text.slice(0, 300)}`;
  }
  return new OpenRouterError(message, { status: response.status, code, body: text.slice(0, 2000) });
}

export function createClient({ apiKey, siteUrl, appName = 'Aurai', fetchImpl = fetch } = {}) {
  const headers = (extra = {}) => {
    if (!apiKey) throw new OpenRouterError('No OpenRouter API key is set. Add one in Settings.', { status: 401 });
    return {
      Authorization: `Bearer ${apiKey}`,
      ...(siteUrl ? { 'HTTP-Referer': siteUrl } : {}),
      'X-Title': appName,
      ...extra,
    };
  };

  async function request(path, { method = 'GET', body, signal, timeout = 120_000, auth = true } = {}) {
    const response = await fetchImpl(`${OPENROUTER_BASE}${path}`, {
      method,
      headers: auth ? headers(body ? { 'Content-Type': 'application/json' } : {}) : body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw await failure(response);
    return response.json();
  }

  return {
    /** Synchronous image generation/editing. Images come back as base64 in `data[].b64_json`. */
    generateImage: (body, options) => request('/images', { method: 'POST', body, timeout: 300_000, ...options }),

    chat: (body, options) => request('/chat/completions', { method: 'POST', body, timeout: 120_000, ...options }),

    submitVideo: (body, options) => request('/videos', { method: 'POST', body, ...options }),
    getVideo: (id, options) => request(`/videos/${encodeURIComponent(id)}`, options),

    /**
     * Streams a finished video. Content URLs are not presigned, so the key goes along; it is
     * only ever sent to OpenRouter's own host.
     */
    async downloadVideo(url, { signal } = {}) {
      const target = new URL(url);
      if (target.protocol !== 'https:' || target.hostname !== DOWNLOAD_HOST) {
        throw new OpenRouterError(`Refusing to download from ${target.hostname}`);
      }
      const response = await fetchImpl(target, { headers: headers(), signal, redirect: 'follow' });
      if (!response.ok) throw await failure(response);
      return response;
    },

    keyInfo: (options) => request('/key', options),
    credits: (options) => request('/credits', options),

    // Catalogs are public; no key needed.
    imageModels: (options) => request('/images/models', { auth: false, ...options }),
    imageModelEndpoints: (id, options) => request(`/images/models/${id}/endpoints`, { auth: false, ...options }),
    videoModels: (options) => request('/videos/models', { auth: false, ...options }),
    models: (query = '', options) => request(`/models${query}`, { auth: false, ...options }),
    modelEndpoints: (id, options) => request(`/models/${id}/endpoints`, { auth: false, ...options }),
  };
}
