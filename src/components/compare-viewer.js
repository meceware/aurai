'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Columns2, Eye, Maximize2, Minus, Plus, SplitSquareHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const ZOOMS = [1, 2, 4];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function Label({ children, side }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute top-3 z-10 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      {children}
    </span>
  );
}

/**
 * Before/after for one result. Both images share one transform, so zooming in to check a face
 * shows the same spot in each — in the slider, side by side, or while holding to see the original.
 */
/** `center` is placed in the middle of the toolbar row (the result card puts "Compare with" there). */
export function CompareViewer({ before, after, width, height, beforeLabel = 'Original', afterLabel = 'Restored', center = null, className }) {
  const frame = useRef(null);
  const drag = useRef(null);
  const [mode, setMode] = useState('slider');
  const [position, setPosition] = useState(50);
  const [holding, setHolding] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const ratio = width && height ? width / height : 4 / 3;

  const clampView = useCallback((next) => {
    const box = frame.current?.getBoundingClientRect();
    if (!box) return next;
    return {
      scale: next.scale,
      x: clamp(next.x, box.width * (1 - next.scale), 0),
      y: clamp(next.y, box.height * (1 - next.scale), 0),
    };
  }, []);

  /** Zooms around a point in frame coordinates (the centre when none is given). */
  const zoomTo = useCallback(
    (scale, point) => {
      const box = frame.current?.getBoundingClientRect();
      if (!box) return;
      const px = point?.x ?? box.width / 2;
      const py = point?.y ?? box.height / 2;
      setView((current) => {
        const contentX = (px - current.x) / current.scale;
        const contentY = (py - current.y) / current.scale;
        return clampView({ scale, x: px - contentX * scale, y: py - contentY * scale });
      });
    },
    [clampView],
  );

  const step = (direction) => {
    const index = ZOOMS.indexOf(view.scale);
    zoomTo(ZOOMS[clamp((index === -1 ? 0 : index) + direction, 0, ZOOMS.length - 1)]);
  };

  // Ctrl/⌘ + wheel (and trackpad pinch, which browsers report the same way) zooms; plain
  // scrolling is left to the page. Needs a non-passive listener to stop the browser's own zoom.
  useEffect(() => {
    const element = frame.current;
    if (!element) return undefined;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      setView((current) => {
        const scale = clamp(current.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), 1, 6);
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;
        const contentX = (px - current.x) / current.scale;
        const contentY = (py - current.y) / current.scale;
        return clampView({ scale, x: px - contentX * scale, y: py - contentY * scale });
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [clampView, mode]);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const box = frame.current.getBoundingClientRect();
    const onHandle = Math.abs(event.clientX - (box.left + (box.width * position) / 100)) < 24;
    // At 1× any drag moves the divider; zoomed in, dragging pans unless it starts on the divider.
    const kind = mode === 'slider' && (view.scale === 1 || onHandle) ? 'slide' : view.scale > 1 ? 'pan' : null;
    if (!kind) return;
    frame.current.setPointerCapture(event.pointerId);
    drag.current = { kind, startX: event.clientX, startY: event.clientY, view };
    if (kind === 'slide') setPosition(clamp(((event.clientX - box.left) / box.width) * 100, 0, 100));
  };

  const onPointerMove = (event) => {
    const current = drag.current;
    if (!current) return;
    const box = frame.current.getBoundingClientRect();
    if (current.kind === 'slide') setPosition(clamp(((event.clientX - box.left) / box.width) * 100, 0, 100));
    else setView(clampView({ ...current.view, x: current.view.x + event.clientX - current.startX, y: current.view.y + event.clientY - current.startY }));
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onDoubleClick = (event) => {
    const box = frame.current.getBoundingClientRect();
    zoomTo(view.scale === 1 ? 2 : 1, { x: event.clientX - box.left, y: event.clientY - box.top });
  };

  const transform = { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' };
  const image = 'absolute inset-0 size-full select-none object-contain';
  const frameStyle = { aspectRatio: `${ratio}`, width: `min(100%, calc(70vh * ${ratio}))` };
  const frameClass = cn(
    'relative mx-auto overflow-hidden rounded-md bg-stage touch-none',
    view.scale > 1 ? 'cursor-grab active:cursor-grabbing' : mode === 'slider' ? 'cursor-ew-resize' : '',
  );

  // eslint-disable-next-line @next/next/no-img-element
  const afterLayers = <img src={after} alt={afterLabel} className={image} draggable={false} />;

  const pane = (side) => (
    <div className={frameClass} style={frameStyle} ref={side === 'left' ? frame : undefined} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDoubleClick={onDoubleClick}>
      <div className="absolute inset-0" style={transform}>
        {side === 'left' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={before} alt={beforeLabel} className={image} draggable={false} />
        ) : (
          afterLayers
        )}
      </div>
      <Label side={side}>{side === 'left' ? beforeLabel : afterLabel}</Label>
    </div>
  );

  return (
    <div data-compare-root className={cn('space-y-3 bg-background [&:fullscreen]:grid [&:fullscreen]:content-center [&:fullscreen]:p-6', className)}>
      {mode === 'side' ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {pane('left')}
          {pane('right')}
        </div>
      ) : (
        <div
          ref={frame}
          className={frameClass}
          style={frameStyle}
          tabIndex={0}
          role="slider"
          aria-label={`Compare ${beforeLabel} with ${afterLabel}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') setPosition((p) => clamp(p - 2, 0, 100));
            if (event.key === 'ArrowRight') setPosition((p) => clamp(p + 2, 0, 100));
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <div className="absolute inset-0" style={transform}>
            {afterLayers}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={before}
              alt={beforeLabel}
              className={image}
              draggable={false}
              style={{ clipPath: holding ? 'none' : `inset(0 ${100 - position}% 0 0)` }}
            />
          </div>
          {holding ? null : (
            <div className="pointer-events-none absolute inset-y-0 z-10" style={{ left: `${position}%` }}>
              <div className="absolute inset-y-0 -left-px w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.5)]" />
              <div className="absolute top-1/2 left-0 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-black/45 text-white shadow-lg backdrop-blur-sm">
                <SplitSquareHorizontal className="size-4" />
              </div>
            </div>
          )}
          <Label side="left">{beforeLabel}</Label>
          {holding ? null : <Label side="right">{afterLabel}</Label>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex items-center gap-1">
          <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(value) => value && setMode(value)} aria-label="View">
            <ToggleGroupItem value="slider" aria-label="Slider">
              <SplitSquareHorizontal className="size-4" />
            </ToggleGroupItem>
            <ToggleGroupItem value="side" aria-label="Side by side">
              <Columns2 className="size-4" />
            </ToggleGroupItem>
          </ToggleGroup>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={holding ? 'secondary' : 'ghost'}
                size="icon"
                className="size-8 select-none"
                disabled={mode !== 'slider'}
                aria-label="Hold to see the original"
                onPointerDown={() => setHolding(true)}
                onPointerUp={() => setHolding(false)}
                onPointerLeave={() => setHolding(false)}
                onKeyDown={(event) => event.key === ' ' && setHolding(true)}
                onKeyUp={() => setHolding(false)}
              >
                <Eye className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Hold to see the original</TooltipContent>
          </Tooltip>
        </div>

        {center ? <div className="flex min-w-0 flex-1 justify-center">{center}</div> : null}

        <div className={cn('flex items-center gap-0.5 sm:gap-1', center ? '' : 'ml-auto')}>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* On a phone, "zoom out" and the percentage (which resets) only show while zoomed in. */}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn('size-8', view.scale <= 1 && 'max-sm:hidden')}
                onClick={() => step(-1)}
                disabled={view.scale <= 1}
                aria-label="Zoom out"
              >
                <Minus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom out</TooltipContent>
          </Tooltip>
          <button
            type="button"
            className={cn('min-w-10 rounded-md px-1 text-center text-xs tabular-nums text-muted-foreground hover:text-foreground sm:min-w-12', view.scale <= 1 && 'max-sm:hidden')}
            onClick={() => setView({ scale: 1, x: 0, y: 0 })}
            title="Fit"
          >
            {Math.round(view.scale * 100)}%
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-8" onClick={() => step(1)} disabled={view.scale >= ZOOMS.at(-1)} aria-label="Zoom in">
                <Plus className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Zoom in · or double-click, or ⌘/Ctrl + scroll</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Full screen"
                onClick={() => frame.current?.closest('[data-compare-root]')?.requestFullscreen?.()}
              >
                <Maximize2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Full screen</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
