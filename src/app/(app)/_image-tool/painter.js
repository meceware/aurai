'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Eraser, Hand, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// The painted area is kept at most this large on its long side; the server scales it to the photo.
const MASK_EDGE = 2048;
// The same red the model is shown (media/area-lock.js), so what you paint is what it sees.
const RED = 'rgb(230, 30, 40)';
const ZOOMS = [1, 1.5, 2, 3, 4];

// Read back after every stroke (is anything painted?), which the browser does faster when told.
const draw = (canvas) => canvas.getContext('2d', { willReadFrequently: true });

/** Strokes, replayed onto the canvas: what was painted before this opening, then each stroke. */
function replay(context, base, strokes) {
  const { canvas } = context;
  context.globalCompositeOperation = 'source-over';
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (base) context.drawImage(base, 0, 0);
  for (const stroke of strokes) {
    if (stroke.clear) {
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, canvas.width, canvas.height);
      continue;
    }
    drawStroke(context, stroke, 0);
  }
}

/** Draws a stroke from point `from` on; a stroke of one point is a dot. */
function drawStroke(context, stroke, from) {
  context.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
  context.strokeStyle = RED;
  context.fillStyle = RED;
  context.lineWidth = stroke.size;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const { points } = stroke;
  if (points.length === 1) {
    context.beginPath();
    context.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  const start = points[Math.max(0, from - 1)];
  context.moveTo(start.x, start.y);
  for (let i = Math.max(1, from); i < points.length; i += 1) context.lineTo(points[i].x, points[i].y);
  context.stroke();
}

/** Whether anything is painted. */
function hasPaint(canvas) {
  const { data } = draw(canvas).getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) if (data[i] > 127) return true;
  return false;
}

/** A painted area as the server takes it (white on black), and how much of the image it covers. */
function exportMask(canvas) {
  const context = draw(canvas);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  let painted = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const on = image.data[i + 3] > 127;
    if (on) painted += 1;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = on ? 255 : 0;
    image.data[i + 3] = 255;
  }
  if (!painted) return null;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  out.getContext('2d').putImageData(image, 0, 0);
  return { dataUrl: out.toDataURL('image/png'), share: painted / (canvas.width * canvas.height) };
}

/** A white-on-black mask turned back into red paint, to go on painting it. */
async function paintFrom(dataUrl, width, height) {
  const picture = new Image();
  picture.src = dataUrl;
  await picture.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(picture, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    const on = image.data[i] > 127;
    image.data[i] = 230;
    image.data[i + 1] = 30;
    image.data[i + 2] = 40;
    image.data[i + 3] = on ? 255 : 0;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function Tool({ label, children, ...props }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="size-9" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Paints the part of a photo to change, in a dialog that is open while this is mounted. The paint
 * is translucent red over the photo; `onDone` gets it as a white-on-black PNG data URL at up to
 * 2048 px, with the share of the photo it covers, or null when nothing is painted. It starts from
 * `initial`, what was painted before, and `onClose` closes it without a change.
 */
export function Painter({ image, initial, onDone, onClose }) {
  const scale = Math.min(1, MASK_EDGE / Math.max(image.width, image.height));
  const maskWidth = Math.max(1, Math.round(image.width * scale));
  const maskHeight = Math.max(1, Math.round(image.height * scale));
  const longEdge = Math.max(maskWidth, maskHeight);

  const canvas = useRef(null);
  const stage = useRef(null);
  const base = useRef(null);
  const current = useRef(null);
  const drag = useRef(null);
  const [strokes, setStrokes] = useState([]);
  const [tool, setTool] = useState('brush');
  // Brush size as a share of the photo's long edge, so it feels the same on any photo.
  const [size, setSize] = useState(4);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState({ width: 0, height: 0 });
  const [ring, setRing] = useState(null);
  const [empty, setEmpty] = useState(!initial);

  // What fits the stage at 1× (it is measured once laid out, and on every resize); zooming
  // multiplies it, and the stage scrolls.
  const stageRef = useCallback(
    (element) => {
      stage.current = element;
      if (!element) return undefined;
      const observer = new ResizeObserver(() => {
        const k = Math.min(element.clientWidth / image.width, element.clientHeight / image.height);
        setFit({ width: Math.floor(image.width * k), height: Math.floor(image.height * k) });
      });
      observer.observe(element);
      return () => observer.disconnect();
    },
    [image.width, image.height],
  );

  // What was painted before goes back on the canvas, to go on from.
  useEffect(() => {
    if (!initial) return undefined;
    let cancelled = false;
    paintFrom(initial, maskWidth, maskHeight).then((painted) => {
      if (cancelled || !canvas.current) return;
      base.current = painted;
      replay(draw(canvas.current), painted, []);
    });
    return () => {
      cancelled = true;
    };
  }, [initial, maskWidth, maskHeight]);

  const redraw = (next) => {
    replay(draw(canvas.current), base.current, next);
    setEmpty(!hasPaint(canvas.current));
  };
  const undo = useCallback(() => {
    const next = strokes.slice(0, -1);
    setStrokes(next);
    replay(draw(canvas.current), base.current, next);
    setEmpty(!hasPaint(canvas.current));
  }, [strokes]);
  const clear = () => {
    const next = [...strokes, { clear: true }];
    setStrokes(next);
    redraw(next);
  };

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undo();
      } else if (event.key === '[') setSize((value) => Math.max(1, value - 1));
      else if (event.key === ']') setSize((value) => Math.min(20, value + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const pointAt = (event) => {
    const box = canvas.current.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * maskWidth, y: ((event.clientY - box.top) / box.height) * maskHeight };
  };
  const showRing = (event) => {
    if (event.pointerType === 'touch' || tool === 'move') return setRing(null);
    const box = canvas.current.getBoundingClientRect();
    setRing({ x: event.clientX - box.left, y: event.clientY - box.top, d: ((size / 100) * longEdge * box.width) / maskWidth });
  };

  const onPointerDown = (event) => {
    if (tool === 'move' || event.button > 0) return;
    event.preventDefault();
    canvas.current.setPointerCapture(event.pointerId);
    current.current = { erase: tool === 'eraser', size: (size / 100) * longEdge, points: [pointAt(event)] };
    drawStroke(draw(canvas.current), current.current, 0);
  };
  const onPointerMove = (event) => {
    showRing(event);
    const stroke = current.current;
    if (!stroke) return;
    stroke.points.push(pointAt(event));
    drawStroke(draw(canvas.current), stroke, stroke.points.length - 1);
  };
  const onPointerUp = () => {
    const stroke = current.current;
    if (!stroke) return;
    current.current = null;
    setStrokes((previous) => [...previous, stroke]);
    setEmpty(!hasPaint(canvas.current));
  };

  // With the hand, a mouse drags the zoomed photo around; touch scrolls it natively.
  const onStageDown = (event) => {
    if (tool !== 'move' || event.pointerType === 'touch') return;
    drag.current = { x: event.clientX, y: event.clientY, left: stage.current.scrollLeft, top: stage.current.scrollTop };
    stage.current.setPointerCapture(event.pointerId);
  };
  const onStageMove = (event) => {
    if (!drag.current) return;
    stage.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    stage.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };

  const step = (direction) => setZoom((value) => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(value) + direction))]);
  const done = () => onDone(exportMask(canvas.current));

  const width = fit.width * zoom;
  const height = fit.height * zoom;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[100dvh] max-w-none flex-col gap-3 rounded-none p-3 sm:h-[92vh] sm:max-w-5xl sm:rounded-lg sm:p-5">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>Paint the part to change</DialogTitle>
          <DialogDescription>
            Paint over it roughly; a little past its edges is fine. Then say in your text what to do there. Everything you do not paint stays as it is.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={stageRef}
          className={cn('relative flex min-h-0 flex-1 overflow-auto rounded-md bg-stage', tool === 'move' && 'cursor-grab active:cursor-grabbing')}
          onPointerDown={onStageDown}
          onPointerMove={onStageMove}
          onPointerUp={() => (drag.current = null)}
        >
          {/* Centred while it fits; scrolled from its corner once zoomed past the stage. */}
          <div className="relative m-auto shrink-0" style={{ width, height }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.src} alt="" draggable={false} className="absolute inset-0 size-full select-none" />
            <canvas
              ref={canvas}
              width={maskWidth}
              height={maskHeight}
              className={cn('absolute inset-0 size-full opacity-55', tool === 'move' ? 'pointer-events-none' : 'cursor-none touch-none')}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => setRing(null)}
            />
            {ring ? (
              <span
                className="pointer-events-none absolute rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                style={{ left: ring.x - ring.d / 2, top: ring.y - ring.d / 2, width: ring.d, height: ring.d }}
              />
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ToggleGroup type="single" variant="outline" size="sm" value={tool} onValueChange={(value) => value && setTool(value)} aria-label="Tool">
            <ToggleGroupItem value="brush" className="px-3" aria-label="Brush">
              <Brush className="size-4" />
              <span className="max-sm:sr-only">Paint</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="eraser" className="px-3" aria-label="Eraser">
              <Eraser className="size-4" />
              <span className="max-sm:sr-only">Erase</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="move" className="px-3" aria-label="Move" disabled={zoom === 1}>
              <Hand className="size-4" />
              <span className="max-sm:sr-only">Move</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex min-w-40 flex-1 items-center gap-2">
            <span className="text-xs text-muted-foreground">Size</span>
            <Slider value={[size]} min={1} max={20} step={1} onValueChange={([value]) => setSize(value)} aria-label="Brush size" className="max-w-48 flex-1" />
          </div>
          <div className="flex items-center">
            <Tool label="Zoom out" onClick={() => step(-1)} disabled={zoom === ZOOMS[0]}>
              <ZoomOut className="size-4" />
            </Tool>
            <span className="w-9 text-center text-xs tabular-nums text-muted-foreground">{zoom}×</span>
            <Tool label="Zoom in" onClick={() => step(1)} disabled={zoom === ZOOMS.at(-1)}>
              <ZoomIn className="size-4" />
            </Tool>
            <Tool label="Undo" onClick={undo} disabled={!strokes.length}>
              <Undo2 className="size-4" />
            </Tool>
            <Tool label="Clear" onClick={clear} disabled={empty}>
              <Trash2 className="size-4" />
            </Tool>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={done}>
            {empty ? 'Edit the whole photo' : 'Use this area'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
