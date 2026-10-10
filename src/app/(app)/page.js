import Link from 'next/link';
import { ArrowRight, Bandage, Brush, Clapperboard, Film, ImageIcon, ImageUpscale, Loader2, Palette, Plus, TriangleAlert, Wand2 } from 'lucide-react';
import { KeyBanner } from '@/components/key-banner';
import { PageHeader } from '@/components/page-header';
import { serverEnv } from '@/lib/config';
import { videoEditAvailable } from '@/lib/public-media';
import { requireUser } from '@/lib/session';
import { getUserSettings } from '@/lib/settings';
import { activeCount, recentWork } from '@/lib/usage';

export const metadata = { title: 'Aurai' };

const TOOLS = {
  enhance: {
    href: '/enhance',
    icon: Palette,
    title: 'Enhance',
    text: 'Bring back faded, yellowed or too-red colors. Everyone in the photo stays exactly as they are.',
    unit: ['photo', 'photos'],
    made: ['result', 'results'],
  },
  colorize: {
    href: '/colorize',
    icon: Wand2,
    title: 'Colorize',
    text: 'Natural color for a black-and-white photo, with every face and shadow as it was photographed.',
    unit: ['photo', 'photos'],
    made: ['result', 'results'],
  },
  repair: {
    href: '/repair',
    icon: Bandage,
    title: 'Repair',
    text: 'Remove scratches, dust, creases and small tears. Only the damaged spots change.',
    unit: ['photo', 'photos'],
    made: ['result', 'results'],
  },
  upscale: {
    href: '/upscale',
    icon: ImageUpscale,
    title: 'Upscale',
    text: 'Make a small photo bigger and sharper, up to 4K, keeping its own shapes and colors. Or resize it for free.',
    unit: ['photo', 'photos'],
    made: ['result', 'results'],
  },
  edit: {
    href: '/edit-image',
    icon: Brush,
    title: 'Edit Image',
    text: 'Change a photo with words. Paint over a part of it to change only that part, and keep the rest as it is.',
    unit: ['photo', 'photos'],
    made: ['edit', 'edits'],
  },
  animate: {
    href: '/animate',
    icon: Clapperboard,
    title: 'Animate from Image',
    text: 'A slow camera move over a still photo, where nobody moves. Compare AI models side by side, or make a free Ken Burns zoom here.',
    unit: ['photo', 'photos'],
    made: ['clip', 'clips'],
  },
  'edit-video': {
    href: '/edit-video',
    icon: Film,
    title: 'Edit Video',
    text: 'Change a video with words: a new look, another season, something added or taken away.',
    unit: ['video', 'videos'],
    made: ['edit', 'edits'],
  },
};

const SECTIONS = [
  { title: 'Image tools', tools: ['enhance', 'colorize', 'repair', 'upscale', 'edit'] },
  { title: 'Video tools', tools: ['animate', 'edit-video'] },
];

const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;

const ago = (time) => {
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 14 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

function ToolCard({ tool, note }) {
  return (
    <Link href={tool.href} className="group flex h-full flex-col gap-2 rounded-lg border bg-card/30 p-4 transition-colors hover:border-brand/60 hover:bg-accent/40">
      <span className="flex items-center gap-2 font-medium">
        <tool.icon className="size-4 shrink-0 text-brand" />
        {tool.title}
        <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </span>
      <span className="text-sm text-pretty text-muted-foreground">{tool.text}</span>
      {note ? (
        <span className="mt-auto flex items-center gap-1.5 text-xs text-warning">
          <TriangleAlert className="size-3.5 shrink-0" />
          {note}
        </span>
      ) : null}
    </Link>
  );
}

function Tile({ item, tool }) {
  return (
    <Link href={`${tool.href}/${item.id}`} prefetch={false} className="group grid gap-1.5 rounded-lg p-1 transition-colors hover:bg-accent/40">
      {item.thumb_id ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/media/${item.thumb_id}`} alt="" className="aspect-[4/3] w-full rounded-md object-cover ring-1 ring-border group-hover:ring-brand/60" />
      ) : (
        <span className="grid aspect-[4/3] w-full place-items-center rounded-md bg-muted ring-1 ring-border">
          <ImageIcon className="size-5 text-muted-foreground" />
        </span>
      )}
      <span className="grid min-w-0 gap-0.5 px-0.5">
        <span className="truncate text-sm font-medium">{item.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {item.results ? plural(item.results, tool.made) : 'nothing yet'} · {ago(item.at)}
        </span>
      </span>
    </Link>
  );
}

/** One tool's recent photos, under a heading that says which tool they belong to. */
function ToolHistory({ tool, group }) {
  return (
    <section className="space-y-2 rounded-lg border bg-card/30 p-3">
      <div className="flex items-center gap-2 px-1">
        <tool.icon className="size-4 shrink-0 text-brand" />
        <h4 className="text-sm font-medium">{tool.title}</h4>
        <span className="text-xs text-muted-foreground">
          {plural(group.total, tool.unit)} in progress{group.done ? ` · ${group.done} done` : ''}
        </span>
        <Link href={tool.href} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
          <Plus className="size-3.5" />
          New
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {group.items.map((item) => (
          <Tile key={item.id} item={item} tool={tool} />
        ))}
      </div>
    </section>
  );
}

export default async function Home() {
  const user = await requireUser();
  const hasKey = serverEnv().OPENROUTER_MOCK || getUserSettings(user.id).hasKey;
  const recent = recentWork(user.id);
  const working = activeCount(user.id);
  // The tool used most recently first.
  // Edit Video needs this server at a public HTTPS address; without one its card says so.
  const notes = videoEditAvailable() ? {} : { 'edit-video': 'Needs HTTPS to work' };
  const histories = Object.entries(recent)
    .filter(([, group]) => group.total)
    .sort(([, a], [, b]) => b.latest - a.latest);

  return (
    <>
      <PageHeader title="Aurai" />
      <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 md:px-8">
        {hasKey ? null : <KeyBanner />}

        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight text-balance">True colors for your photos</h2>
          <p className="text-sm text-pretty text-muted-foreground">
            Pick a tool to start. Every result keeps your photo&apos;s own faces and detail, and you can always compare it with the original.
          </p>
        </div>

        <div className="grid gap-6">
          {SECTIONS.map((section) => (
            <section key={section.title} className="space-y-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{section.title}</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {section.tools.map((key) => (
                  <ToolCard key={key} tool={TOOLS[key]} note={notes[key]} />
                ))}
              </div>
            </section>
          ))}
        </div>

        {histories.length ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Pick up where you left off</h3>
              {working ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin text-brand" />
                  {working} still being made
                </span>
              ) : null}
            </div>
            {histories.map(([key, group]) => (
              <ToolHistory key={key} tool={TOOLS[key]} group={group} />
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
