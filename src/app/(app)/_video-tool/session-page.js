import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { refreshIfStale } from '@/lib/catalog';
import { serverEnv } from '@/lib/config';
import { getPrefs } from '@/lib/preferences';
import { requireUser } from '@/lib/session';
import { getUserSettings } from '@/lib/settings';
import { videoEditProfiles, videoLabels, videoProfiles } from '@/lib/video-options';
import { LOCAL_MOTION } from '@/lib/video-pricing';
import { getVideoSessionView, VIDEO_TOOLS } from '@/lib/video-sessions';
import { MOTION_PRESETS, RETIRED_MOTIONS } from '@/lib/prompts/defaults';
import { EDIT_NEEDS_HTTPS, videoEditAvailable } from '@/lib/public-media';
import { DoneButton } from '@/components/done-button';
import { doneOn } from '@/lib/format';
import { DeleteSession } from '../_image-tool/delete-session';
import { removeVideoSession } from './actions';
import { VideoStudio } from './studio';

export async function videoSessionMetadata({ params }) {
  const user = await requireUser();
  const view = getVideoSessionView(user.id, (await params).id);
  return { title: view?.title ?? 'Video' };
}

/**
 * One session: in Animate a photo, in Edit Video a video; every clip made from it, and the
 * composer for the next.
 */
export async function VideoSessionPage({ params, tool = 'animate' }) {
  const user = await requireUser();
  const { id } = await params;
  const view = getVideoSessionView(user.id, id);
  if (!view) notFound();
  // An address from the other video tool goes to the tool the session belongs to.
  if (view.tool !== tool) redirect(`${VIDEO_TOOLS[view.tool]}/${id}`);
  refreshIfStale(tool === 'edit' ? 'video-edit' : null);
  const prefs = getPrefs(user.id);
  const canRun = serverEnv().OPENROUTER_MOCK || getUserSettings(user.id).hasKey;
  const notice = tool === 'edit' && !videoEditAvailable() ? EDIT_NEEDS_HTTPS : null;
  // Animate: the person's models, then the free one made here. Edit Video: the person's models.
  const profiles = tool === 'edit' ? videoEditProfiles(prefs.editModels) : videoProfiles([...prefs.videoModels, LOCAL_MOTION]);
  const names = videoLabels(view.jobs.map((job) => job.model));
  const session = { ...view, jobs: view.jobs.map((job) => ({ ...job, option: job.model, label: names[job.model] })) };
  const presets = {
    ...Object.fromEntries(Object.entries(MOTION_PRESETS).map(([key, preset]) => [key, { label: preset.label, description: preset.description, localMotion: preset.localMotion }])),
    // Clips made with a motion no longer offered keep its name; the composer leaves it out.
    ...Object.fromEntries(Object.entries(RETIRED_MOTIONS).map(([key, motion]) => [key, { label: motion.label, retired: true }])),
  };

  return (
    <>
      <PageHeader title={view.title}>
        <DoneButton kind="video" sessionId={view.id} doneOn={doneOn(view.closedAt)} />
        <DeleteSession sessionId={view.id} action={removeVideoSession} source={tool === 'edit' ? 'video' : 'photo'} what={tool === 'edit' ? 'edit' : 'video'} />
      </PageHeader>
      <VideoStudio
        tool={tool}
        session={session}
        profiles={profiles}
        labels={videoLabels(profiles.map((profile) => profile.id))}
        presets={presets}
        prefs={prefs}
        canRun={canRun && !notice}
        notice={notice}
      />
    </>
  );
}
