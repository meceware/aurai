import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { serverEnv } from '@/lib/config';
import { refreshIfStale } from '@/lib/catalog';
import { getImageSessionView } from '@/lib/image-sessions';
import { analysisCostFor, imageOptionsFor, modelLabels } from '@/lib/model-options';
import { toolFor } from '@/lib/image-tools';
import { requireUser } from '@/lib/session';
import { getPrefs } from '@/lib/preferences';
import { getUserSettings } from '@/lib/settings';
import { DoneButton } from '@/components/done-button';
import { doneOn } from '@/lib/format';
import { DeleteSession } from './delete-session';
import { Thread } from './thread';

export async function imageSessionMetadata({ params }) {
  const user = await requireUser();
  const view = getImageSessionView(user.id, (await params).id);
  return { title: view?.title ?? 'Photo' };
}

/** One photo inside a tool. A photo opened under the other tool's address is sent to its own. */
export async function ImageSessionPage({ params, mode }) {
  const user = await requireUser();
  const { id } = await params;
  const view = getImageSessionView(user.id, id);
  if (!view) notFound();
  if (view.mode !== mode) redirect(`${toolFor(view.mode).path}/${view.id}`);
  const canRun = serverEnv().OPENROUTER_MOCK || getUserSettings(user.id).hasKey;
  const prefs = getPrefs(user.id);
  refreshIfStale();
  // Priced at the size this photo will be redrawn at, so the composer shows what a run costs.
  const options = imageOptionsFor(prefs, { longEdge: Math.max(view.source?.width ?? 0, view.source?.height ?? 0), mode });
  const labels = modelLabels(view.runs.map((run) => run.model));

  return (
    <>
      <PageHeader title={view.title}>
        <DoneButton kind="image" sessionId={view.id} doneOn={doneOn(view.closedAt)} />
        <DeleteSession sessionId={view.id} />
      </PageHeader>
      <Thread session={view} tool={toolFor(mode)} canRun={canRun} prefs={prefs} options={options} labels={labels} analysisCost={analysisCostFor(prefs)} />
    </>
  );
}
