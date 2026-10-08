'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bandage, CheckCircle2, ChevronRight, Clapperboard, Film, ImageIcon, ImageUpscale, MoreHorizontal, Palette, Plus, RotateCcw, Settings, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { setDone } from '@/app/(app)/history-actions';
import { AccountMenu } from '@/components/account-menu';
import { Logo } from '@/components/logo';
import { ModeToggle } from '@/components/mode-toggle';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

const SECTIONS = [
  {
    label: 'Image Tools',
    tools: [
      { key: 'enhance', href: '/enhance', label: 'Enhance', icon: Palette, empty: 'Photos you enhance will appear here.' },
      { key: 'colorize', href: '/colorize', label: 'Colorize', icon: Wand2, empty: 'Photos you colorize will appear here.' },
      { key: 'repair', href: '/repair', label: 'Repair', icon: Bandage, empty: 'Photos you repair will appear here.' },
      { key: 'upscale', href: '/upscale', label: 'Upscale', icon: ImageUpscale, empty: 'Photos you upscale will appear here.' },
    ],
  },
  {
    label: 'Video Tools',
    tools: [
      { key: 'animate', href: '/animate', label: 'Animate from Image', icon: Clapperboard, empty: 'Videos you make will appear here.' },
      { key: 'edit-video', href: '/edit-video', label: 'Edit Video', icon: Film, empty: 'Videos you edit will appear here.' },
    ],
  },
];

const TOOLS = SECTIONS.flatMap((section) => section.tools);

/** One photo or video in the history, with a menu to mark it done or back in progress. */
function HistoryItem({ item, pathname }) {
  const [pending, startTransition] = useTransition();
  const toggle = () =>
    startTransition(async () => {
      const result = await setDone({ kind: item.kind, sessionId: item.id, done: !item.done });
      if (result?.error) toast.error(result.error);
      else toast(item.done ? `${item.title} is back in progress` : `${item.title} is done`);
    });
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={pathname === item.href} className={cn('h-12', item.done && 'opacity-70')}>
        {/* Not prefetched: a long history would otherwise render every photo page up front. */}
        <Link href={item.href} prefetch={false}>
          {item.thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumb} alt="" loading="lazy" className="size-8 shrink-0 rounded-md object-cover" />
          ) : (
            <ImageIcon />
          )}
          <span className="truncate">{item.title}</span>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover className="top-3.5" disabled={pending} aria-label={`More for ${item.title}`}>
            <MoreHorizontal />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" className="w-44">
          <DropdownMenuItem onSelect={toggle}>
            {item.done ? <RotateCcw className="size-4" /> : <CheckCircle2 className="size-4" />}
            {item.done ? 'Back in progress' : 'Mark as done'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

/** A tool's history in two groups: what is in progress, and the done ones folded away below. */
function HistoryGroups({ items, pathname }) {
  const inProgress = items.filter((item) => !item.done);
  const done = items.filter((item) => item.done);
  // Open when the page being looked at is a done one, so it can be found in the list.
  const [showDone, setShowDone] = useState(() => done.some((item) => item.href === pathname));
  return (
    <>
      <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">In progress</p>
      {inProgress.length ? (
        <SidebarMenu>
          {inProgress.map((item) => (
            <HistoryItem key={item.id} item={item} pathname={pathname} />
          ))}
        </SidebarMenu>
      ) : (
        <p className="px-2 pb-2 text-xs text-muted-foreground">Nothing in progress.</p>
      )}
      {done.length ? (
        <>
          <button
            type="button"
            onClick={() => setShowDone(!showDone)}
            aria-expanded={showDone}
            className="mt-2 flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', showDone && 'rotate-90')} />
            Done ({done.length})
          </button>
          {showDone ? (
            <SidebarMenu>
              {done.map((item) => (
                <HistoryItem key={item.id} item={item} pathname={pathname} />
              ))}
            </SidebarMenu>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function AppSidebar({ email, history = {} }) {
  const pathname = usePathname();
  const current = TOOLS.find((tool) => pathname === tool.href || pathname.startsWith(`${tool.href}/`));
  const shown = current ?? TOOLS[0];
  const items = history[shown.key] ?? [];

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <Logo className="size-8 shrink-0" />
                <span className="text-base font-semibold tracking-tight">Aurai</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {SECTIONS.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.tools.map((tool) => (
                  <SidebarMenuItem key={tool.key}>
                    <SidebarMenuButton asChild isActive={current?.key === tool.key} tooltip={tool.label}>
                      <Link href={tool.href}>
                        <tool.icon />
                        <span>{tool.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel>{shown.label} history</SidebarGroupLabel>
          <SidebarGroupAction asChild title={`New in ${shown.label}`}>
            <Link href={shown.href}>
              <Plus />
              <span className="sr-only">New in {shown.label}</span>
            </Link>
          </SidebarGroupAction>
          <SidebarGroupContent>
            {items.length ? (
              <HistoryGroups key={shown.key} items={items} pathname={pathname} />
            ) : (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">{shown.empty}</p>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
            <SidebarMenuButton asChild isActive={pathname.startsWith('/settings')} tooltip="Settings">
              <Link href="/settings">
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
            <ModeToggle className="size-8 shrink-0" />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <AccountMenu email={email} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
