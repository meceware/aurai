import { Film, TriangleAlert } from 'lucide-react';
import { Dropzone } from '@/components/dropzone';
import { EmptyHero } from '@/components/empty-hero';
import { PageHeader } from '@/components/page-header';
import { refreshIfStale } from '@/lib/catalog';
import { EDIT_NEEDS_HTTPS, videoEditAvailable } from '@/lib/public-media';
import { serverEnv } from '@/lib/config';
import { requireUser } from '@/lib/session';
import { getUserSettings } from '@/lib/settings';
import { MAX_VIDEO_SECONDS } from '@/lib/video-sessions';

export const metadata = { title: 'Edit Video' };

export default async function EditVideoPage() {
  const user = await requireUser();
  // So the models that can edit a video are known by the time the upload lands.
  refreshIfStale('video-edit');
  const hasKey = serverEnv().OPENROUTER_MOCK || getUserSettings(user.id).hasKey;
  const available = videoEditAvailable();

  return (
    <>
      <PageHeader title="Edit Video" />
      <EmptyHero
        icon={Film}
        title="Change a video with words"
        description={`Upload a clip of up to ${MAX_VIDEO_SECONDS} seconds and describe the change: a new look, a different season, something added or taken away. Compare several models side by side.`}
        hasKey={hasKey}
      >
        {available ? (
          <Dropzone mode="edit-video" disabled={!hasKey} />
        ) : (
          <p className="mx-auto flex max-w-lg items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-pretty">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            {EDIT_NEEDS_HTTPS}
          </p>
        )}
      </EmptyHero>
    </>
  );
}
