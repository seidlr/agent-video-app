import { useState } from 'react';
import type { ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import { runUpscaleFrame } from '../../agent/tools/effects';
import { resolveVlmId } from '../../ml/catalog';
import { buildDescribeFrameMessages } from '../../ml/vlmPrompts';
import { secsToTimecode } from '../../lib/time';
import type { BoxSource } from '../../lib/types';
import { deletePersistedFrame } from '../../store/frames';
import { persistBox } from '../../store/boxes';
import { studioStore, useStudio, type FrameEntry } from '../../store/studio';
import { ensureModelForUi, UI_FEEDBACK_MS } from '../ui/ensureModel';
import { SizeConfirm } from '../ui/SizeConfirm';

const VLM_MODEL_ID = resolveVlmId('default');
const FLORENCE_MODEL_ID = 'florence2-base';
const UPSCALE_MODEL_ID = 'swin2sr-upscale';

interface GenerateWorkerResult {
  text: string;
}

interface FlorenceWorkerResult {
  boxes: { label: string; box: { x: number; y: number; w: number; h: number } }[];
}

type Action = 'describe' | 'read_text' | 'upscale';

/** Turns a captured frame's own stored image (an object URL over the Dexie-persisted blob) into a
 * bitmap the VLM/Florence workers can consume -- same fetch-the-blob-URL approach
 * find_similar_frames already uses for a `frameId` query (src/agent/tools/vision.ts). */
async function bitmapFromBlobUrl(blobUrl: string): Promise<ImageBitmap> {
  const blob = await fetch(blobUrl).then((r) => r.blob());
  return createImageBitmap(blob);
}

/** Grid of frames captured this session (capture_frame, generate_thumbnails contactSheet) --
 * click to seek back to that frame's timestamp, delete it, or run a local VLM/Florence-2 read on
 * it directly (Task 12): unlike the describe_frame/read_text tools, these act on the frame's own
 * already-captured image rather than the live video, so they work for any frame regardless of the
 * loaded source (including a YouTube tab-capture still). UI actions call mlClient/the store
 * directly, same pattern Models.tsx and Notes.tsx already use for a human click. */
export function Frames(): ReactElement {
  const frames = useStudio((s) => s.frames);
  const removeFrame = useStudio((s) => s.removeFrame);
  const seek = useStudio((s) => s.seek);
  const addVisionResult = useStudio((s) => s.addVisionResult);
  const addBox = useStudio((s) => s.addBox);

  const [confirming, setConfirming] = useState<{ frameId: string; action: Action; sizeMB: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ frameId: string; action: Action; text: string } | null>(null);

  async function handleDelete(id: string): Promise<void> {
    removeFrame(id);
    await deletePersistedFrame(id);
  }

  function showFeedback(frameId: string, action: Action, text: string): void {
    setFeedback({ frameId, action, text });
    setTimeout(() => setFeedback((f) => (f?.frameId === frameId && f.action === action ? null : f)), UI_FEEDBACK_MS);
  }

  async function runDescribe(frame: FrameEntry, confirmDownload: boolean): Promise<void> {
    const busyKey = `${frame.id}:describe`;
    setBusy(busyKey);
    try {
      const ensured = await ensureModelForUi(VLM_MODEL_ID, { confirmDownload });
      if (!ensured.ok) {
        if (ensured.needsConfirm) {
          setConfirming({ frameId: frame.id, action: 'describe', sizeMB: ensured.sizeMB });
        } else {
          setConfirming(null);
          showFeedback(frame.id, 'describe', ensured.message);
        }
        return;
      }
      setConfirming(null);

      const bitmap = await bitmapFromBlobUrl(frame.blobUrl);
      let result: GenerateWorkerResult;
      try {
        result = await ensured.worker.call<GenerateWorkerResult>('generate', { messages: buildDescribeFrameMessages(), bitmaps: [bitmap] }, (chunk) => {
          studioStore.getState().setVisionStreaming((studioStore.getState().visionStreaming ?? '') + chunk);
        });
      } finally {
        bitmap.close();
        studioStore.getState().setVisionStreaming(null);
      }

      addVisionResult({ time: frame.time, kind: 'describe', text: result.text, model: VLM_MODEL_ID });
      showFeedback(frame.id, 'describe', 'Described -- see Vision panel');
    } catch (error) {
      showFeedback(frame.id, 'describe', `Describe failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  async function runReadText(frame: FrameEntry, confirmDownload: boolean): Promise<void> {
    const busyKey = `${frame.id}:read_text`;
    setBusy(busyKey);
    try {
      const ensured = await ensureModelForUi(FLORENCE_MODEL_ID, { confirmDownload });
      if (!ensured.ok) {
        if (ensured.needsConfirm) {
          setConfirming({ frameId: frame.id, action: 'read_text', sizeMB: ensured.sizeMB });
        } else {
          setConfirming(null);
          showFeedback(frame.id, 'read_text', ensured.message);
        }
        return;
      }
      setConfirming(null);

      const bitmap = await bitmapFromBlobUrl(frame.blobUrl);
      let result: FlorenceWorkerResult;
      try {
        result = await ensured.worker.call<FlorenceWorkerResult>('read_text', { bitmap });
      } finally {
        bitmap.close();
      }

      const source: BoxSource = 'ocr';
      await Promise.all(
        result.boxes.map(async (b) => {
          const boxId = addBox({ time: frame.time, x: b.box.x, y: b.box.y, w: b.box.w, h: b.box.h, label: b.label, source });
          await persistBox({ id: boxId, time: frame.time, x: b.box.x, y: b.box.y, w: b.box.w, h: b.box.h, label: b.label, source });
        }),
      );
      showFeedback(frame.id, 'read_text', `${result.boxes.length} text region(s) found`);
    } catch (error) {
      showFeedback(frame.id, 'read_text', `Read text failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  /** Same "probe first, confirm, then run" shape as runDescribe/runReadText above, but the actual
   * upscale pipeline itself lives in agent/tools/effects.ts's runUpscaleFrame -- shared with the
   * upscale_frame tool -- rather than duplicated here, since that pipeline (tiled inference,
   * canvas compositing) is substantial enough that literal duplication would be a real drift
   * risk. */
  async function runUpscale(frame: FrameEntry, confirmDownload: boolean): Promise<void> {
    const busyKey = `${frame.id}:upscale`;
    setBusy(busyKey);
    try {
      const probe = await ensureModelForUi(UPSCALE_MODEL_ID, { confirmDownload });
      if (!probe.ok) {
        if (probe.needsConfirm) {
          setConfirming({ frameId: frame.id, action: 'upscale', sizeMB: probe.sizeMB });
        } else {
          setConfirming(null);
          showFeedback(frame.id, 'upscale', probe.message);
        }
        return;
      }
      setConfirming(null);

      const result = await runUpscaleFrame(studioStore, { frameId: frame.id, confirmDownload: true });
      showFeedback(frame.id, 'upscale', result.ok ? `Upscaled to ${result.width}x${result.height} -- see Frames panel` : result.error);
    } catch (error) {
      showFeedback(frame.id, 'upscale', `Upscale failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
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

          {confirming?.frameId === frame.id ? (
            <SizeConfirm
              sizeMB={confirming.sizeMB}
              label={confirming.action === 'describe' ? VLM_MODEL_ID : confirming.action === 'read_text' ? FLORENCE_MODEL_ID : UPSCALE_MODEL_ID}
              onConfirm={() => void (confirming.action === 'describe' ? runDescribe(frame, true) : confirming.action === 'read_text' ? runReadText(frame, true) : runUpscale(frame, true))}
              onCancel={() => setConfirming(null)}
            />
          ) : (
            <div className="flex gap-1.5 text-[11px]">
              <button
                type="button"
                disabled={busy === `${frame.id}:describe`}
                onClick={() => void runDescribe(frame, false)}
                className="rounded px-1.5 py-0.5 text-ink-2 hover:bg-line disabled:opacity-50"
              >
                {busy === `${frame.id}:describe` ? 'Describing…' : 'Describe'}
              </button>
              <button
                type="button"
                disabled={busy === `${frame.id}:read_text`}
                onClick={() => void runReadText(frame, false)}
                className="rounded px-1.5 py-0.5 text-ink-2 hover:bg-line disabled:opacity-50"
              >
                {busy === `${frame.id}:read_text` ? 'Reading…' : 'Read text'}
              </button>
              {frame.kind !== 'upscaled' && (
                <button
                  type="button"
                  disabled={busy === `${frame.id}:upscale`}
                  onClick={() => void runUpscale(frame, false)}
                  className="rounded px-1.5 py-0.5 text-ink-2 hover:bg-line disabled:opacity-50"
                >
                  {busy === `${frame.id}:upscale` ? 'Upscaling…' : 'Upscale'}
                </button>
              )}
            </div>
          )}
          {feedback?.frameId === frame.id && <p className="text-[10.5px] text-good">{feedback.text}</p>}
        </div>
      ))}
    </div>
  );
}
