import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { refreshIfStale } from '@/lib/catalog';
import { serverEnv } from '@/lib/config';
import { getBatchView } from '@/lib/image-sessions';
import { MAX_BATCH_PHOTOS, toolFor } from '@/lib/image-tools';
import { analysisCostFor, imageOptionsFor } from '@/lib/model-options';
import { getPrefs } from '@/lib/preferences';
import { requireUser } from '@/lib/session';
import { getUserSettings } from '@/lib/settings';
import { BatchStudio } from './batch';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Several photos dropped at once: one composer for all of them, then their progress. The photos
 * are named in the address (`?ids=…`), so nothing about the group is stored — each is an ordinary
 * photo of the tool, in its history like any other.
 */
export async function ImageBatchPage({ searchParams, mode }) {
  const user = await requireUser();
  const tool = toolFor(mode);
  const ids = String((await searchParams).ids ?? '')
    .split(',')
    .filter((id) => UUID.test(id))
    .slice(0, MAX_BATCH_PHOTOS);
  const photos = getBatchView(user.id, ids, mode);
  if (!photos.length) redirect(tool.path);
  refreshIfStale();
  const prefs = getPrefs(user.id);
  const canRun = serverEnv().OPENROUTER_MOCK || getUserSettings(user.id).hasKey;
  // Each photo priced at the size it will be drawn at; the composer adds them up.
  const options = Object.fromEntries(
    photos.map((photo) => [photo.id, imageOptionsFor(prefs, { longEdge: Math.max(photo.source?.width ?? 0, photo.source?.height ?? 0), mode })]),
  );
  const analysisCost = ['enhance', 'colorize'].includes(mode) ? analysisCostFor(prefs) : 0;

  return (
    <>
      <PageHeader title={`${tool.title} · ${photos.length} photos`} />
      <BatchStudio tool={tool} photos={photos} options={options} prefs={prefs} canRun={canRun} analysisCost={analysisCost} />
    </>
  );
}
