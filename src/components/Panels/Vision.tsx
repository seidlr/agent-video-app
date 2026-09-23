import { useState } from 'react';
import type { ReactElement } from 'react';
import { runDetectObjects, runDetectScenes } from '../../agent/tools/vision';
import { getMlQueryOverrides, mlClient } from '../../ml/client';
import { pickDetectModel } from '../../ml/catalog';
import { secsToTimecode } from '../../lib/time';
import { studioStore, useStudio, type VisionResult } from '../../store/studio';
import { SizeConfirm } from '../ui/SizeConfirm';

const KIND_LABELS: Record<VisionResult['kind'], string> = {
  describe: 'Frame description',
  describe_range: 'Range description',
  ask: 'Answer',
  dense_captions: 'Dense captions',
};

/** How long a chapter should span when promoting a vision result (a single point in time, not a
 * range) to one -- long enough to read as a real chapter, short enough to rarely collide with
 * whatever the agent adds right after it. */
const CHAPTER_SPAN_SECONDS = 5;
const CHAPTER_TITLE_MAX = 60;

/**
 * Vision panel: the Task 12 VLM/Florence-2 text-result history (describe_frame/describe_range/
 * ask_about_frame), streamed live while a call is in flight, each promotable to a note or chapter
 * title -- plus (below it, unchanged from Task 8) the search_frames hit list with click-to-seek.
 * Promotion buttons call the store directly, same pattern Notes.tsx already uses for its own
 * Add note/Add chapter actions, rather than round-tripping through the agent registry for a
 * plain human click.
 */
export function Vision(): ReactElement {
  const vision = useStudio((s) => s.vision);
  const visionStreaming = useStudio((s) => s.visionStreaming);
  const visionSearch = useStudio((s) => s.visionSearch);
  const duration = useStudio((s) => s.player.duration);
  const seek = useStudio((s) => s.seek);
  const addNote = useStudio((s) => s.addNote);
  const addChapter = useStudio((s) => s.addChapter);

  const [noteFeedback, setNoteFeedback] = useState<string | null>(null);
  const [chapterFeedback, setChapterFeedback] = useState<{ id: string; error: boolean } | null>(null);

  const [scenesBusy, setScenesBusy] = useState(false);
  const [scenesFeedback, setScenesFeedback] = useState<string | null>(null);
  const [objectsBusy, setObjectsBusy] = useState(false);
  const [objectsFeedback, setObjectsFeedback] = useState<string | null>(null);
  const [objectLabels, setObjectLabels] = useState('');
  const [detectConfirm, setDetectConfirm] = useState<{ sizeMB: number; modelId: string } | null>(null);

  async function handleDetectScenes(): Promise<void> {
    setScenesBusy(true);
    setScenesFeedback(null);
    try {
      const result = await runDetectScenes(studioStore, { addChapters: true });
      setScenesFeedback(result.ok ? result.summary : result.error);
    } finally {
      setScenesBusy(false);
      setTimeout(() => setScenesFeedback(null), 3000);
    }
  }

  /** Same "probe first, confirm, then run" shape as Frames.tsx's own upscale button -- the actual
   * pipeline lives in agent/tools/vision.ts's runDetectObjects, shared with the detect_objects
   * tool. */
  async function handleDetectObjects(confirmDownload: boolean): Promise<void> {
    const labels = objectLabels
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
    const zeroShot = labels.length > 0;
    const webgpu = studioStore.getState().capabilities.webgpu;
    const modelId = zeroShot ? 'grounding-dino-tiny' : pickDetectModel(webgpu, getMlQueryOverrides().forceWasm).id;

    setObjectsBusy(true);
    setObjectsFeedback(null);
    try {
      const probe = await mlClient.ensureModel(modelId, { confirmDownload });
      if (!probe.ok) {
        if (probe.error === 'model_not_loaded') setDetectConfirm({ sizeMB: probe.sizeMB, modelId });
        return;
      }
      setDetectConfirm(null);

      const result = await runDetectObjects(studioStore, { labels: zeroShot ? labels : undefined, addBoxes: true, confirmDownload: true });
      setObjectsFeedback(result.ok ? result.summary : result.error);
    } finally {
      setObjectsBusy(false);
      setTimeout(() => setObjectsFeedback(null), 3000);
    }
  }

  function handleAddNote(r: VisionResult): void {
    addNote({ time: r.time, text: r.text, tags: [r.kind], createdBy: 'agent' });
    setNoteFeedback(r.id);
    setTimeout(() => setNoteFeedback((id) => (id === r.id ? null : id)), 1500);
  }

  function handleAddChapter(r: VisionResult): void {
    const end = Math.min(r.time + CHAPTER_SPAN_SECONDS, duration || r.time + CHAPTER_SPAN_SECONDS);
    const title = r.text.length > CHAPTER_TITLE_MAX ? `${r.text.slice(0, CHAPTER_TITLE_MAX - 1)}…` : r.text;
    try {
      addChapter({ start: r.time, end: end > r.time ? end : r.time + 0.1, title });
      setChapterFeedback({ id: r.id, error: false });
    } catch {
      setChapterFeedback({ id: r.id, error: true });
    }
    setTimeout(() => setChapterFeedback((f) => (f?.id === r.id ? null : f)), 1500);
  }

  const hasVisionResults = vision.length > 0 || visionStreaming !== null;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5 rounded-token border border-line bg-surface-2 p-2">
        <h3 className="text-[13px] font-semibold">Detect</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={scenesBusy}
            onClick={() => void handleDetectScenes()}
            className="rounded-token bg-ink px-2.5 py-1 text-[12px] font-medium text-surface disabled:opacity-50"
          >
            {scenesBusy ? 'Detecting…' : 'Detect scenes'}
          </button>
          {scenesFeedback && <span className="text-[11px] text-ink-3">{scenesFeedback}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={objectLabels}
            onChange={(e) => setObjectLabels(e.target.value)}
            placeholder="Labels (optional), e.g. a red car, a person"
            className="min-w-0 flex-1 rounded border border-line bg-surface px-1.5 py-1 text-[12px]"
            aria-label="Zero-shot detection labels"
          />
          <button
            type="button"
            disabled={objectsBusy}
            onClick={() => void handleDetectObjects(false)}
            className="rounded-token bg-ink px-2.5 py-1 text-[12px] font-medium text-surface disabled:opacity-50"
          >
            {objectsBusy ? 'Detecting…' : 'Detect objects'}
          </button>
        </div>
        {detectConfirm && (
          <SizeConfirm
            sizeMB={detectConfirm.sizeMB}
            label={detectConfirm.modelId}
            onConfirm={() => void handleDetectObjects(true)}
            onCancel={() => setDetectConfirm(null)}
          />
        )}
        {objectsFeedback && <p className="text-[11px] text-ink-3">{objectsFeedback}</p>}
      </div>

      {hasVisionResults && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold">Vision results</h3>

          {visionStreaming !== null && (
            <div aria-live="polite" className="rounded-token border border-line bg-surface-2 p-2 text-[12.5px]">
              <span className="font-mono text-[11px] text-ink-3">Describing…</span>
              <p className="mt-0.5 whitespace-pre-wrap">{visionStreaming}</p>
            </div>
          )}

          {[...vision].reverse().map((r) => (
            <div key={r.id} className="flex flex-col gap-1.5 rounded-token bg-surface-2 p-2 text-[12.5px]">
              <button type="button" onClick={() => void seek(r.time)} className="min-w-0 text-left" aria-label={`Seek to vision result at ${secsToTimecode(r.time)}`}>
                <span className="font-mono text-[11px] text-ink-3">
                  {secsToTimecode(r.time)} · {KIND_LABELS[r.kind]} · {r.model}
                </span>
                <p className="mt-0.5 whitespace-pre-wrap">{r.text}</p>
              </button>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => handleAddNote(r)} className="rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-line">
                  {noteFeedback === r.id ? 'Added!' : 'Add as note'}
                </button>
                <button type="button" onClick={() => handleAddChapter(r)} className="rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-line">
                  {chapterFeedback?.id === r.id ? (chapterFeedback.error ? 'Overlaps existing chapter' : 'Added!') : 'Add as chapter title'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div>
          <h3 className="text-[13px] font-semibold">Search results</h3>
          {visionSearch && <p className="font-mono text-[11px] text-ink-3">"{visionSearch.query}"</p>}
        </div>

        {!visionSearch ? (
          <p className="text-[13px] text-ink-3">
            No search yet -- ask the agent to run `search_frames` (e.g. "find the moment it turns red") to see ranked matches here.
          </p>
        ) : visionSearch.ranges.length === 0 ? (
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
    </div>
  );
}
