import { memo } from 'react';
import type { ReactElement } from 'react';
import { interpolateTrackBox, isBoxVisibleAt } from '../../lib/boxVisibility';
import { useStudio } from '../../store/studio';

/**
 * Renders agent-drawn boxes/masks that are visible at the current time. A box with `until` is
 * visible for its whole [time, until] range (tracks, Task 7); a point box is visible for a
 * short window around its exact timestamp so a single detect_objects/segment call is visible
 * without requiring the playhead to land on the exact frame. A box with a `trackId` (Task 7's
 * `track` tool set both `trackId` and `until` together) renders at its track's own interpolated
 * position instead of its own static x/y/w/h, so it visibly moves as the playhead scrubs between
 * keyframes rather than jumping between them.
 */
function BoxOverlayInner(): ReactElement {
  const boxes = useStudio((s) => s.boxes);
  const tracks = useStudio((s) => s.tracks);
  const currentTime = useStudio((s) => s.player.currentTime);

  const visible = boxes.filter((box) => isBoxVisibleAt(box, currentTime));

  return (
    <>
      {visible.map((box) => {
        const track = box.trackId ? tracks.find((t) => t.id === box.trackId) : undefined;
        const rect = (track ? interpolateTrackBox(track.keyframes, currentTime) : null) ?? box;
        return (
          <div
            key={box.id}
            className="pointer-events-none absolute z-10 flex flex-col border-2 border-annotate shadow-[0_0_10px_rgba(79,179,217,0.5)]"
            style={{
              top: `${rect.y * 100}%`,
              left: `${rect.x * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
              background: 'color-mix(in srgb, var(--color-annotate) 20%, transparent)',
            }}
          >
            <span className="-mt-6 self-start whitespace-nowrap rounded-t bg-annotate px-1.5 py-0.5 text-[12px] font-bold text-annotate-ink shadow-sm">
              {box.label}
            </span>
          </div>
        );
      })}
    </>
  );
}

export const BoxOverlay = memo(BoxOverlayInner);
