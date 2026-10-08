import { serverEnv, siteConfig } from '../config.js';
import { openRouterKeyFor } from '../settings.js';
import { createClient } from './client.js';
import { createMockClient } from './mock.js';

/** The client that generates, on the user's own key (or the mock in development). */
export function openrouterFor(userId) {
  if (serverEnv().OPENROUTER_MOCK) return createMockClient();
  return createClient({ apiKey: openRouterKeyFor(userId), siteUrl: siteConfig.url || undefined });
}

/**
 * For checking a key and its balance. These calls are free, so they always reach the real
 * OpenRouter — even in mock mode, where showing invented balances would only mislead.
 */
export function keyClient(apiKey) {
  return createClient({ apiKey, siteUrl: siteConfig.url || undefined });
}

export function keyClientFor(userId) {
  return keyClient(openRouterKeyFor(userId));
}
