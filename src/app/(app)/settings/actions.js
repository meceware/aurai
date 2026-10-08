'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { deleteAccount, deleteAllPhotos, listDevices, revokeDevice, revokeOtherDevices } from '@/lib/account';
import { boot } from '@/lib/boot';
import { findModel, isListed, refreshCatalogs } from '@/lib/catalog';
import { MODEL_ID } from '@/lib/model-options';
import { keyDetailsFor, keyDetailsForKey } from '@/lib/openrouter/key-details';
import { getPrefs, PROMPTS, promptProblem, savePrefs, savePrompt } from '@/lib/preferences';
import { hit } from '@/lib/rate-limit';
import { requireUser } from '@/lib/session';
import { clearOpenRouterKey, saveOpenRouterKey } from '@/lib/settings';

const keySchema = z
  .string()
  .trim()
  .regex(/^sk-or-[A-Za-z0-9_-]{16,200}$/, 'That does not look like an OpenRouter key (they start with "sk-or-").');

function limited(userId) {
  return !hit(`settings-key:${userId}`, { limit: 10, windowSeconds: 60 }).ok;
}

export async function saveKey(raw) {
  const user = await requireUser();
  if (limited(user.id)) return { error: 'Too many attempts. Wait a minute and try again.' };

  const parsed = keySchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  // Only a key OpenRouter accepts is stored, so a typo surfaces here and not mid-generation.
  const { details, error } = await keyDetailsForKey(parsed.data);
  if (error) return { error };
  saveOpenRouterKey(user.id, parsed.data);
  revalidatePath('/', 'layout');
  return { ok: true, details, last4: parsed.data.slice(-4) };
}

export async function testKey() {
  const user = await requireUser();
  if (limited(user.id)) return { error: 'Too many attempts. Wait a minute and try again.' };
  const { details, error } = await keyDetailsFor(user.id);
  return error ? { error } : { ok: true, details };
}

export async function removeKey() {
  const user = await requireUser();
  clearOpenRouterKey(user.id);
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function savePreferences(patch) {
  const user = await requireUser();
  const input = patch && typeof patch === 'object' ? { ...patch } : {};
  // Models must be on OpenRouter; one already chosen may stay even after it is delisted.
  const current = getPrefs(user.id);
  if (Array.isArray(input.enabledModels)) {
    input.enabledModels = input.enabledModels.filter((id) => typeof id === 'string' && (current.enabledModels.includes(id) || isListed('image', id)));
    if (!input.enabledModels.length) return { error: 'Keep at least one model.' };
  }
  if (Array.isArray(input.videoModels)) {
    input.videoModels = input.videoModels.filter((id) => typeof id === 'string' && (current.videoModels.includes(id) || isListed('video', id)));
    if (!input.videoModels.length) return { error: 'Keep at least one video model.' };
  }
  if (Array.isArray(input.editModels)) {
    input.editModels = input.editModels.filter((id) => typeof id === 'string' && (current.editModels.includes(id) || isListed('video-edit', id)));
    if (!input.editModels.length) return { error: 'Keep at least one model for Edit Video.' };
  }
  if ('analysisModel' in input && input.analysisModel !== current.analysisModel && !isListed('vision', String(input.analysisModel))) {
    return { error: 'That model is not one of OpenRouter’s vision models.' };
  }
  const prefs = savePrefs(user.id, input);
  revalidatePath('/', 'layout');
  return { ok: true, prefs };
}

/**
 * Adds a model by its OpenRouter id (or its openrouter.ai address): to the person's image or
 * video models, or as their analysis model.
 */
export async function addModel(kind, raw) {
  const user = await requireUser();
  if (!['image', 'vision', 'video', 'video-edit'].includes(kind)) return { error: 'Unknown kind of model.' };
  const id = String(raw ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?openrouter\.ai\/(models\/)?/, '')
    .split(/[?#\s]/)[0];
  if (!MODEL_ID.test(id)) return { error: 'Enter an OpenRouter model ID, like "vendor/model-name".' };
  if (!hit(`model-add:${user.id}`, { limit: 30, windowSeconds: 60 * 60 }).ok) return { error: 'Too many lookups. Try again later.' };

  let model;
  try {
    model = await findModel(kind, id);
  } catch (error) {
    return { error: `Could not reach OpenRouter: ${error.message}` };
  }
  if (!model) {
    const what = {
      image: 'an OpenRouter model that can edit a photo',
      vision: 'an OpenRouter vision model with structured output',
      video: 'an OpenRouter video model that can start from a photo',
      'video-edit': 'an OpenRouter video model that takes a video in',
    };
    return { error: `${id} is not ${what[kind]}.` };
  }
  const prefs = getPrefs(user.id);
  const add = (list) => [...list.filter((existing) => existing !== id), id];
  const next =
    kind === 'image'
      ? savePrefs(user.id, { enabledModels: add(prefs.enabledModels) })
      : kind === 'video'
        ? savePrefs(user.id, { videoModels: add(prefs.videoModels) })
        : kind === 'video-edit'
          ? savePrefs(user.id, { editModels: add(prefs.editModels) })
          : savePrefs(user.id, { analysisModel: id });
  revalidatePath('/', 'layout');
  return { ok: true, prefs: next };
}

export async function savePromptText(key, text) {
  const user = await requireUser();
  if (!Object.hasOwn(PROMPTS, key)) return { error: 'Unknown prompt.' };
  const value = String(text ?? '');
  const problem = promptProblem(key, value);
  if (problem) return { error: problem };
  // Saving the default text is the same as going back to it.
  savePrompt(user.id, key, value === PROMPTS[key].default ? null : value);
  return { ok: true, custom: value !== PROMPTS[key].default };
}

export async function resetPrompt(key) {
  const user = await requireUser();
  if (!Object.hasOwn(PROMPTS, key)) return { error: 'Unknown prompt.' };
  savePrompt(user.id, key, null);
  return { ok: true, text: PROMPTS[key].default };
}

export async function resetAllPrompts() {
  const user = await requireUser();
  for (const key of Object.keys(PROMPTS)) savePrompt(user.id, key, null);
  return { ok: true };
}

export async function removeAllPhotos(confirmation) {
  const user = await requireUser();
  if (String(confirmation).trim().toLowerCase() !== 'delete') return { error: 'Type “delete” to confirm.' };
  const { imageRunner, videoRunner } = boot();
  const count = await deleteAllPhotos(user.id, { image: (id) => imageRunner.abort(id), video: (id) => videoRunner.abort(id) });
  revalidatePath('/', 'layout');
  return { ok: true, count };
}

export async function devices() {
  const user = await requireUser();
  return listDevices(user.id);
}

export async function signOutDevice(sessionId) {
  const user = await requireUser();
  return { ok: revokeDevice(user.id, String(sessionId)) };
}

export async function signOutOtherDevices() {
  await requireUser();
  await revokeOtherDevices();
  return { ok: true };
}

export async function removeAccount(confirmation) {
  const user = await requireUser();
  if (String(confirmation).trim().toLowerCase() !== user.email.toLowerCase()) return { error: 'Type your email address exactly to confirm.' };
  const { imageRunner, videoRunner } = boot();
  await deleteAccount(user.id, { image: (id) => imageRunner.abort(id), video: (id) => videoRunner.abort(id) });
  redirect('/login?deleted=1');
}

export async function refreshModelCatalog() {
  const user = await requireUser();
  if (!hit(`catalog-refresh:${user.id}`, { limit: 6, windowSeconds: 60 * 60 }).ok) return { error: 'Refreshed recently. Try again later.' };
  try {
    await refreshCatalogs();
    return { ok: true };
  } catch (error) {
    return { error: `Could not reach OpenRouter: ${error.message}` };
  }
}
