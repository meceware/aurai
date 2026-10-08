import { Bandage, ImageUpscale, Palette, Wand2 } from 'lucide-react';
import { Dropzone } from '@/components/dropzone';
import { EmptyHero } from '@/components/empty-hero';
import { PageHeader } from '@/components/page-header';
import { serverEnv } from '@/lib/config';
import { toolFor } from '@/lib/image-tools';
import { requireUser } from '@/lib/session';
import { getUserSettings } from '@/lib/settings';

const ICONS = { enhance: Palette, colorize: Wand2, repair: Bandage, upscale: ImageUpscale };

/** The first screen of an image tool: what it does, and where to drop a photo. */
export async function ImageToolLanding({ mode }) {
  const user = await requireUser();
  const hasKey = serverEnv().OPENROUTER_MOCK || getUserSettings(user.id).hasKey;
  const tool = toolFor(mode);

  return (
    <>
      <PageHeader title={tool.title} />
      <EmptyHero icon={ICONS[mode]} title={tool.heroTitle} description={tool.heroText} hasKey={hasKey}>
        {/* Upscale's free resize needs no key. */}
        <Dropzone mode={mode} disabled={!hasKey && mode !== 'upscale'} />
      </EmptyHero>
    </>
  );
}
