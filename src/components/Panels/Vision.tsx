import type { ReactElement } from 'react';
import { secsToTimecode } from '../../lib/time';
import { useStudio } from '../../store/studio';

/**
 * Vision panel (Task 8, TS-006 step 8): renders the most recent `search_frames` hit list with
 * click-to-seek, per the plan's own Key Decisions ("Search results render in the Vision panel
 * with click-to-seek"). `visionSearch` is `null` until an agent (or a human via
 * navigator.modelContextTesting) has actually run a search this session -- there is no manual
 * search input here, matching this panel's role as a *results* surface rather than a duplicate
 * entry point for a tool that already needs a confirmDownload gate and a real model call.
 */
export function Vision(): ReactElement {
  const visionSearch = useStudio((s) => s.visionSearch);
  const seek = useStudio((s) => s.seek);

  if (!visionSearch) {
    return (
      <p className="text-[13px] text-ink-3">
        No search yet -- ask the agent to run `search_frames` (e.g. "find the moment it turns red") to see ranked matches here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <h3 className="text-[13px] font-semibold">Search results</h3>
        <p className="font-mono text-[11px] text-ink-3">"{visionSearch.query}"</p>
      </div>

      {visionSearch.ranges.length === 0 ? (
        <p className="text-[13px] text-ink-3">No matching ranges.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visionSearch.ranges.map((r, i) => (
            <button
              key={`${r.start}-${i}`}
              type="button"
              onClick={() => void seek(r.start)}
              className="flex items-center justify-between gap-2 rounded-token bg-surface-2 p-2 text-left text-[12.5px]"
            >
              <span className="font-mono text-[11px] text-ink-3">
                {secsToTimecode(r.start)} → {secsToTimecode(r.end)}
              </span>
              <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] text-ink-2">{Math.round(r.score * 100)}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
