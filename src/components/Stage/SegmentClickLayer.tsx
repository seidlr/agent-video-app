import { useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import { runSegment } from '../../agent/tools/vision';
import { pickSegmentModel } from '../../ml/catalog';
import { getMlQueryOverrides } from '../../ml/client';
import { studioStore, useStudio } from '../../store/studio';
import { ensureModelForUi, UI_FEEDBACK_MS } from '../ui/ensureModel';
import { SizeConfirm } from '../ui/SizeConfirm';

/**
 * Click-to-segment while paused, mirroring BoxDrawLayer.tsx's own "capture pointer events only
 * while its own mode is on" convention -- Tracking.tsx's own "Segment" toggle arms this the same
 * way "Draw box" arms BoxDrawLayer. Closes the SHORTCUT that same panel's own doc comment named:
 * runSegment (agent/tools/vision.ts) is the exact same pipeline the `segment` tool calls, so a
 * human click and an agent's tool call produce identical results, not a second reimplementation.
 */
export function SegmentClickLayer(): ReactElement {
  const paused = useStudio((s) => s.player.paused);
  const clickMode = useStudio((s) => s.segmentClickMode);
  const setSegmentClickMode = useStudio((s) => s.setSegmentClickMode);
  const containerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ sizeMB: number; modelId: string; x: number; y: number } | null>(null);

  const active = paused && clickMode;

  function toNormalized(clientX: number, clientY: number): { x: number; y: number } {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5 };
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }

  async function segmentAt(x: number, y: number, confirmDownload: boolean): Promise<void> {
    const webgpu = studioStore.getState().capabilities.webgpu;
    const modelId = pickSegmentModel(webgpu, getMlQueryOverrides().forceWasm).id;
    setBusy(true);
    setFeedback(null);
    try {
      const probe = await ensureModelForUi(modelId, { confirmDownload });
      if (!probe.ok) {
        if (probe.needsConfirm) {
          setConfirm({ sizeMB: probe.sizeMB, modelId, x, y });
        } else {
          setConfirm(null);
          setFeedback(probe.message);
        }
        return;
      }
      setConfirm(null);

      const result = await runSegment(studioStore, { points: [{ x, y, label: 1 }], confirmDownload: true });
      setFeedback(result.ok ? `${result.summary} -- see Tracking panel` : result.error);
      if (result.ok) setSegmentClickMode(false);
    } catch (error) {
      // runSegment runs the worker directly (no registry.call to convert a throw into a result).
      setFeedback(`Segment failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      setTimeout(() => setFeedback(null), UI_FEEDBACK_MS);
    }
  }

  function handleClick(e: ReactMouseEvent<HTMLDivElement>): void {
    if (!active || busy) return;
    const { x, y } = toNormalized(e.clientX, e.clientY);
    void segmentAt(x, y, false);
  }

  if (!active && !confirm) return <></>;

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Segment: click an object on the video"
      className="absolute inset-0 z-20 cursor-crosshair"
      onClick={handleClick}
    >
      {busy && !confirm && <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-black/70 px-2 py-1 text-[11px] text-white">Segmenting…</div>}
      {feedback && <div className="absolute inset-x-0 top-2 mx-auto w-fit rounded bg-black/70 px-2 py-1 text-[11px] text-white">{feedback}</div>}
      {confirm && (
        <div className="absolute inset-x-0 top-2 mx-auto w-fit" onClick={(e) => e.stopPropagation()}>
          <SizeConfirm
            sizeMB={confirm.sizeMB}
            label={confirm.modelId}
            onConfirm={() => void segmentAt(confirm.x, confirm.y, true)}
            onCancel={() => setConfirm(null)}
          />
        </div>
      )}
    </div>
  );
}
