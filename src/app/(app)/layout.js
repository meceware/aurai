import { cookies } from 'next/headers';
import { AppSidebar } from '@/components/app-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { boot } from '@/lib/boot';
import { listImageSessions } from '@/lib/image-sessions';
import { requireUser } from '@/lib/session';
import { listVideoSessions, VIDEO_TOOLS } from '@/lib/video-sessions';

// Done ones are listed too, for the folded Done group, so the lists reach further back.
const HISTORY_LIMIT = 200;

const videoHistory = (userId, tool) =>
  listVideoSessions(userId, tool, HISTORY_LIMIT).map((session) => ({
    id: session.id,
    kind: 'video',
    title: session.title,
    href: `${VIDEO_TOOLS[tool]}/${session.id}`,
    thumb: session.thumb_id ? `/api/media/${session.thumb_id}` : null,
    done: Boolean(session.closed_at),
  }));

export default async function AppLayout({ children }) {
  const user = await requireUser();
  // Cheap once running; in development it also applies a new migration before any page reads.
  boot();
  const open = (await cookies()).get('sidebar_state')?.value !== 'false';
  const sessions = listImageSessions(user.id, HISTORY_LIMIT).map((session) => ({
    id: session.id,
    kind: 'image',
    done: Boolean(session.closed_at),
    mode: session.mode,
    title: session.title,
    href: `/${session.mode}/${session.id}`,
    thumb: session.thumb_id ? `/api/media/${session.thumb_id}` : null,
  }));
  const history = {
    enhance: sessions.filter((session) => session.mode === 'enhance'),
    colorize: sessions.filter((session) => session.mode === 'colorize'),
    repair: sessions.filter((session) => session.mode === 'repair'),
    upscale: sessions.filter((session) => session.mode === 'upscale'),
    animate: videoHistory(user.id, 'animate'),
    'edit-video': videoHistory(user.id, 'edit'),
  };

  return (
    <SidebarProvider defaultOpen={open}>
      <AppSidebar email={user.email} history={history} />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
