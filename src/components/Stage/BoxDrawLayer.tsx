import { useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import { useStudio } from '../../store/studio';

interface DragState {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

const MIN_DRAG_SIZE = 0.01;

/**
 * Drag-to-draw a manual box while paused, per the plan's Key Decisions. Only captures pointer
 * events while `boxDrawMode` is on (the Tracking panel's "Draw box" toggle) -- an always-on
 * full-stage capture layer would otherwise swallow every click Chrome/PlayOverlay need while
 * paused (scrubbing, pressing play), since this layer sits on top of them at the same z-level as
 * BoxOverlay/MaskOverlay. Selecting/deleting an existing box isn't handled here; that lives in the
 * Tracking panel's list (delete button) rather than a second hit-testing layer on the stage.
 */
export function BoxDrawLayer(): ReactElement {
  const paused = useStudio((s) => s.player.paused);
  const drawMode = useStudio((s) => s.boxDrawMode);
  const currentTime = useStudio((s) => s.player.currentTime);
  const addBox = useStudio((s) => s.addBox);
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const active = paused && drawMode;

  function toNormalized(clientX: number, clientY: number): { x: number; y: number } {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  function handleMouseDown(e: ReactMouseEvent<HTMLDivElement>): void {
    if (!active) return;
    const { x, y } = toNormalized(e.clientX, e.clientY);
    setDrag({ startX: x, startY: y, x, y });
  }

  function handleMouseMove(e: ReactMouseEvent<HTMLDivElement>): void {
    if (!drag) return;
    const { x, y } = toNormalized(e.clientX, e.clientY);
    setDrag((d) => (d ? { ...d, x, y } : d));
  }

  function commitDrag(): void {
    if (!drag) return;
    const x = Math.min(drag.startX, drag.x);
    const y = Math.min(drag.startY, drag.y);
    const w = Math.abs(drag.x - drag.startX);
    const h = Math.abs(drag.y - drag.startY);
    setDrag(null);
    if (w < MIN_DRAG_SIZE || h < MIN_DRAG_SIZE) return; // an accidental click, not a real drag
    addBox({ time: currentTime, x, y, w, h, label: 'box', source: 'manual' });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') setDrag(null);
  }

  if (!active) return <></>;

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Draw a box: drag on the video"
      tabIndex={-1}
      className="absolute inset-0 z-20 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={commitDrag}
      onMouseLeave={() => setDrag(null)}
      onKeyDown={handleKeyDown}
    >
      {drag && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-annotate bg-annotate/20"
          style={{
            left: `${Math.min(drag.startX, drag.x) * 100}%`,
            top: `${Math.min(drag.startY, drag.y) * 100}%`,
            width: `${Math.abs(drag.x - drag.startX) * 100}%`,
            height: `${Math.abs(drag.y - drag.startY) * 100}%`,
          }}
        />
      )}
    </div>
  );
}
