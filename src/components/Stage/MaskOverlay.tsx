import { memo, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { isBoxVisibleAt } from '../../lib/boxVisibility';
import { getPersistedBoxMask } from '../../store/boxes';
import { useStudio } from '../../store/studio';

/**
 * Renders `segment`'s mask PNGs (already tinted+semi-transparent by segment.worker.ts's
 * maskToTintedPng, positioned like BoxOverlay's own box outline) for every currently-visible
 * segmented box. Only `source:'segment'` boxes ever have a mask (manual/detect/track boxes never
 * call segment.ts's worker), so that alone is a reliable "does this box have a mask" check
 * without a separate boolean field on Box. Masks are Dexie-only (store/boxes.ts) -- there is no
 * in-memory url the way FrameEntry keeps one for the Frames tray -- so this component fetches and
 * caches its own object URLs on demand, lazily, per box id.
 */
function MaskOverlayInner(): ReactElement {
  const boxes = useStudio((s) => s.boxes);
  const currentTime = useStudio((s) => s.player.currentTime);
  const [urls, setUrls] = useState<Record<string, string>>({});

  // Only an untracked segment box has a mask worth showing: `track` (vision.ts) advances a box's
  // position via plain NCC template matching (a SHORTCUT documented there) without re-running
  // segment at every keyframe, so there is no per-keyframe mask to interpolate -- matching the
  // plan's own "masks only at keyframes" note, reduced to "no masks once tracked" until a later
  // task adds periodic re-segmentation.
  const visible = boxes.filter((b) => b.source === 'segment' && !b.trackId && isBoxVisibleAt(b, currentTime));
  const visibleIds = visible.map((b) => b.id).join(',');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const id of visibleIds ? visibleIds.split(',') : []) {
        if (urls[id]) continue;
        const blob = await getPersistedBoxMask(id);
        if (blob && !cancelled) {
          setUrls((prev) => (prev[id] ? prev : { ...prev, [id]: URL.createObjectURL(blob) }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run when the set of visible mask-bearing box ids changes, not on every urls update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleIds]);

  return (
    <>
      {visible.map((box) =>
        urls[box.id] ? (
          <img
            key={box.id}
            src={urls[box.id]}
            alt=""
            className="pointer-events-none absolute z-[9]"
            style={{ top: `${box.y * 100}%`, left: `${box.x * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, objectFit: 'fill' }}
          />
        ) : null,
      )}
    </>
  );
}

export const MaskOverlay = memo(MaskOverlayInner);
