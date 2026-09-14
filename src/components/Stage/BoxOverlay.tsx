import { memo } from 'react';
import type { ReactElement } from 'react';
import { isBoxVisibleAt } from '../../lib/boxVisibility';
import { useStudio } from '../../store/studio';

/**
 * Renders agent-drawn boxes/masks that are visible at the current time. A box with `until` is
 * visible for its whole [time, until] range (tracks, Task 7); a point box is visible for a
 * short window around its exact timestamp so a single detect_objects/segment call is visible
 * without requiring the playhead to land on the exact frame.
 */
function BoxOverlayInner(): ReactElement {
  const boxes = useStudio((s) => s.boxes);
  const currentTime = useStudio((s) => s.player.currentTime);

  const visible = boxes.filter((box) => isBoxVisibleAt(box, currentTime));

  return (
    <>
      {visible.map((box) => (
        <div
          key={box.id}
          className="pointer-events-none absolute z-10 flex flex-col border-2 border-annotate shadow-[0_0_10px_rgba(79,179,217,0.5)]"
          style={{
            top: `${box.y * 100}%`,
            left: `${box.x * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
            background: 'color-mix(in srgb, var(--color-annotate) 20%, transparent)',
          }}
        >
          <span className="-mt-6 self-start whitespace-nowrap rounded-t bg-annotate px-1.5 py-0.5 text-[12px] font-bold text-annotate-ink shadow-sm">
            {box.label}
          </span>
        </div>
      ))}
    </>
  );
}

export const BoxOverlay = memo(BoxOverlayInner);
