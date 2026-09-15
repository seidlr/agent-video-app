import type { ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import { secsToTimecode } from '../../lib/time';
import { deletePersistedFrame } from '../../store/frames';
import { useStudio } from '../../store/studio';

/** Grid of frames captured this session (capture_frame, generate_thumbnails contactSheet) --
 * click to seek back to that frame's timestamp, or delete it. */
export function Frames(): ReactElement {
  const frames = useStudio((s) => s.frames);
  const removeFrame = useStudio((s) => s.removeFrame);
  const seek = useStudio((s) => s.seek);

  async function handleDelete(id: string): Promise<void> {
    removeFrame(id);
    await deletePersistedFrame(id);
  }

  if (frames.length === 0) {
    return <p className="text-[13px] text-ink-3">No frames captured yet. Ask an agent to call capture_frame, or generate a thumbnail contact sheet.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {[...frames].reverse().map((frame) => (
        <div key={frame.id} className="flex flex-col gap-1 rounded-token border border-line bg-surface-2 p-1.5">
          <button type="button" onClick={() => void seek(frame.time)} className="block overflow-hidden rounded bg-ink">
            <img src={frame.blobUrl} alt={`Frame at ${secsToTimecode(frame.time)}`} className="aspect-video w-full object-cover" />
          </button>
          <div className="flex items-center justify-between font-mono text-[10.5px] text-ink-3">
            <span>
              {secsToTimecode(frame.time)} · {frame.width}x{frame.height}
              {frame.kind === 'contact-sheet' && ' · sheet'}
            </span>
            <button type="button" onClick={() => void handleDelete(frame.id)} aria-label="Delete frame" className="grid h-5 w-5 place-items-center rounded text-ink-3 hover:bg-line hover:text-clay-ink">
              <Trash2 size={11} />
            </button>
          </div>
          {frame.downloadedAs && <p className="truncate text-[10px] text-good">Saved to Downloads as {frame.downloadedAs}</p>}
        </div>
      ))}
    </div>
  );
}
