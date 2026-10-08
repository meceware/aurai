'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Film, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ResultCard } from '@/components/result-card';
import { ClipCard, CompareCard, isActive } from './clips';
import { initialComposerState, VideoComposer } from './composer';

const media = (id) => `/api/media/${id}`;

/** While a clip is in progress, asks for statuses every few seconds and re-renders on a change. */
function useJobPolling(sessionId, jobs) {
  const router = useRouter();
  const active = jobs.some(isActive);
  const signature = jobs.map((job) => `${job.id}:${job.status}`).join(',');

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/activity?video=${sessionId}`, { cache: 'no-store' });
        if (!response.ok) return;
        const { jobs: latest } = await response.json();
        if (latest.map((job) => `${job.id}:${job.status}`).join(',') !== signature) router.refresh();
      } catch {
        // Offline for a moment; the next tick tries again.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [active, signature, sessionId, router]);

  const previous = useRef(new Map(jobs.map((job) => [job.id, job.status])));
  useEffect(() => {
    for (const job of jobs) {
      const before = previous.current.get(job.id);
      if (before && before !== job.status && isActive({ status: before })) {
        if (job.status === 'completed') toast.success('A clip is ready');
        else if (job.status !== 'abandoned') toast.error('A clip failed', { description: job.error });
      }
    }
    previous.current = new Map(jobs.map((job) => [job.id, job.status]));
  }, [jobs]);
}

/** Clips in order; the clips of one comparison stay together under one number. */
function numbered(jobs) {
  const groups = [];
  const byGroup = new Map();
  for (const job of jobs) {
    if (job.groupId && byGroup.has(job.groupId)) {
      byGroup.get(job.groupId).jobs.push(job);
      continue;
    }
    const group = { key: job.groupId ?? job.id, jobs: [job], number: groups.length + 1 };
    groups.push(group);
    if (job.groupId) byGroup.set(job.groupId, group);
  }
  return groups;
}

function SourceCard({ source }) {
  const [open, setOpen] = useState(true);
  if (!source) return null;
  const shape = source.height > source.width ? 'portrait, so videos are portrait' : source.width > source.height ? 'landscape, so videos are landscape' : 'square';
  if (source.video) {
    const facts = [`${source.width}×${source.height}`, source.duration ? `${Math.round(source.duration)} s` : null, source.audio ? 'sound' : 'no sound'];
    return (
      <ResultCard open={open} onToggle={() => setOpen(!open)} thumb={media(source.displayId)} icon={Film} label="Video" facts={facts.filter(Boolean).join(' · ')}>
        <video
          src={media(source.id)}
          poster={media(source.displayId)}
          controls
          playsInline
          preload="metadata"
          className="mx-auto max-h-[40vh] w-auto rounded-md bg-stage object-contain"
          style={{ aspectRatio: `${source.width} / ${source.height}` }}
        />
      </ResultCard>
    );
  }
  return (
    <ResultCard
      open={open}
      onToggle={() => setOpen(!open)}
      thumb={media(source.displayId)}
      icon={ImageIcon}
      label="Photo"
      facts={`${source.width}×${source.height} · ${shape}`}
    >
      <div className="overflow-hidden rounded-md bg-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media(source.displayId)}
          alt="The photo to animate"
          className="mx-auto max-h-[40vh] w-auto object-contain"
          style={{ aspectRatio: `${source.width} / ${source.height}` }}
        />
      </div>
    </ResultCard>
  );
}

export function VideoStudio({ tool = 'animate', session, profiles, labels, presets, prefs, canRun, notice = null }) {
  useJobPolling(session.id, session.jobs);
  const [composer, setComposer] = useState(() => initialComposerState(prefs, profiles, numbered(session.jobs).at(-1)?.jobs, tool));
  const [focusSignal, setFocusSignal] = useState(0);
  const [composerOpen, setComposerOpen] = useState(true);
  const groups = numbered(session.jobs);
  const numberOf = new Map(groups.flatMap((group) => group.jobs.map((job) => [job.id, group.number])));
  const end = useRef(null);
  const count = groups.length;
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [count]);

  // "Change and try again": the clip's settings, ready to edit, linked to it.
  const change = (job) => {
    setComposer((current) => ({
      ...current,
      preset: presets[job.preset] && !presets[job.preset].retired ? job.preset : current.preset,
      instruction: job.instruction ?? '',
      models: [job.option ?? job.model],
      duration: job.params.duration ?? current.duration,
      audio: job.params.audio,
      parent: { id: job.id, number: numberOf.get(job.id) },
    }));
    setComposerOpen(true);
    setFocusSignal((n) => n + 1);
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6 md:px-8">
        <SourceCard source={session.source} />
        {groups.map((group) => {
          const parent = group.jobs[0].parentJobId;
          const origin = parent && numberOf.has(parent) ? `from #${numberOf.get(parent)}` : null;
          // The clip the composer is changing is the selected one, as in the image tools.
          const selected = group.jobs.some((job) => job.id === composer.parent?.id);
          const props = { number: group.number, origin, labels, presets, title: session.title, onChange: change, selected };
          return group.jobs.length > 1 ? <CompareCard key={group.key} jobs={group.jobs} {...props} /> : <ClipCard key={group.key} job={group.jobs[0]} {...props} />;
        })}
        {session.jobs.length ? null : (
          <p className="text-center text-sm text-muted-foreground">
            {tool === 'edit'
              ? 'Describe the change below and press Edit. Pick several models to see them side by side.'
              : 'Pick a motion below and press Animate. Pick several models to see them side by side.'}
          </p>
        )}
        <div ref={end} />
      </div>
      <VideoComposer
        tool={tool}
        sessionId={session.id}
        source={session.source ?? { width: 16, height: 9 }}
        profiles={profiles}
        labels={labels}
        presets={presets}
        prefs={prefs}
        canRun={canRun}
        notice={notice}
        state={composer}
        onState={setComposer}
        focusSignal={focusSignal}
        open={composerOpen}
        onOpenChange={setComposerOpen}
      />
    </div>
  );
}
