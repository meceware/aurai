import { Clapperboard } from 'lucide-react';
import { Dropzone } from '@/components/dropzone';
import { EmptyHero } from '@/components/empty-hero';
import { PageHeader } from '@/components/page-header';
import { serverEnv } from '@/lib/config';
import { requireUser } from '@/lib/session';
import { getUserSettings } from '@/lib/settings';

export const metadata = { title: 'Animate from Image' };

export default async function AnimatePage() {
  const user = await requireUser();
  const hasKey = serverEnv().OPENROUTER_MOCK || getUserSettings(user.id).hasKey;

  return (
    <>
      <PageHeader title="Animate from Image" />
      <EmptyHero
        icon={Clapperboard}
        title="Turn a photo into a parallax video"
        description="A slow camera move with depth: the people come forward while the background recedes. Nobody in the photo moves or changes. Compare several models side by side, or make a free Ken Burns zoom right here."
        hasKey={hasKey}
      >
        {/* No key needed to start: the Ken Burns zoom is made on this server. */}
        <Dropzone mode="animate" />
      </EmptyHero>
    </>
  );
}
