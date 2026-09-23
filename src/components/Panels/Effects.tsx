import { useState } from 'react';
import type { ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import { runGenerateVoiceover, runRemoveBackground } from '../../agent/tools/effects';
import { mlClient } from '../../ml/client';
import { secsToTimecode } from '../../lib/time';
import type { MatteReplace } from '../../lib/types';
import { studioStore, useStudio } from '../../store/studio';
import { SizeConfirm } from '../ui/SizeConfirm';

const REPLACE_LABELS: Record<'transparent' | 'color' | 'blur', string> = {
  transparent: 'Transparent',
  color: 'Color',
  blur: 'Blurred background',
};

function resolveMatteId(tier: 'portrait' | 'general'): string {
  return `matte-${tier}`;
}

/**
 * Effects panel (Task 13): the `remove_background` effect chips and `generate_voiceover` clips an
 * agent has added, each removable from here. A voice-over's own "Play" button previews its audio
 * standalone (a plain `<audio>` element over its own stored WAV blob) rather than the plan's own
 * "scheduled against the player clock" playback -- a real, working preview, just not timeline-
 * synced; see the plan's own Task 13 Deviations entry for the reasoning.
 */
export function Effects(): ReactElement {
  const effects = useStudio((s) => s.effects);
  const voiceovers = useStudio((s) => s.voiceovers);
  const removeEffect = useStudio((s) => s.removeEffect);
  const removeVoiceover = useStudio((s) => s.removeVoiceover);
  const seek = useStudio((s) => s.seek);
  const [playingId, setPlayingId] = useState<string | null>(null);

  function handlePlay(id: string, blob: Blob): void {
    const audio = new Audio(URL.createObjectURL(blob));
    setPlayingId(id);
    audio.addEventListener('ended', () => setPlayingId((p) => (p === id ? null : p)));
    void audio.play();
  }

  const [matteStart, setMatteStart] = useState('');
  const [matteEnd, setMatteEnd] = useState('');
  const [matteTier, setMatteTier] = useState<'portrait' | 'general'>('portrait');
  const [matteReplace, setMatteReplace] = useState<MatteReplace>('transparent');
  const [matteColor, setMatteColor] = useState('#00ff00');
  const [matteBusy, setMatteBusy] = useState(false);
  const [matteFeedback, setMatteFeedback] = useState<string | null>(null);
  const [matteConfirm, setMatteConfirm] = useState<{ sizeMB: number; modelId: string } | null>(null);

  const [voText, setVoText] = useState('');
  const [voAt, setVoAt] = useState('');
  const [voBusy, setVoBusy] = useState(false);
  const [voFeedback, setVoFeedback] = useState<string | null>(null);
  const [voConfirm, setVoConfirm] = useState<{ sizeMB: number; modelId: string } | null>(null);

  /** Same "probe first, confirm, then run" shape as the other new buttons -- the actual pipeline
   * lives in agent/tools/effects.ts's runRemoveBackground, shared with the remove_background
   * tool. */
  async function handleRemoveBackground(confirmDownload: boolean): Promise<void> {
    if (!matteStart.trim() || !matteEnd.trim()) return;
    const modelId = resolveMatteId(matteTier);
    setMatteBusy(true);
    setMatteFeedback(null);
    try {
      const probe = await mlClient.ensureModel(modelId, { confirmDownload });
      if (!probe.ok) {
        if (probe.error === 'model_not_loaded') setMatteConfirm({ sizeMB: probe.sizeMB, modelId });
        return;
      }
      setMatteConfirm(null);

      const result = await runRemoveBackground(
        studioStore,
        { start: matteStart, end: matteEnd, model: matteTier, replace: matteReplace, color: matteReplace === 'color' ? matteColor : undefined, confirmDownload: true },
        { progress: () => undefined },
      );
      setMatteFeedback(result.ok ? result.summary : result.error);
    } finally {
      setMatteBusy(false);
      setTimeout(() => setMatteFeedback(null), 3000);
    }
  }

  /** Same shape again -- pipeline lives in agent/tools/effects.ts's runGenerateVoiceover. */
  async function handleGenerateVoiceover(confirmDownload: boolean): Promise<void> {
    if (!voText.trim() || !voAt.trim()) return;
    const modelId = 'kokoro-tts';
    setVoBusy(true);
    setVoFeedback(null);
    try {
      const probe = await mlClient.ensureModel(modelId, { confirmDownload });
      if (!probe.ok) {
        if (probe.error === 'model_not_loaded') setVoConfirm({ sizeMB: probe.sizeMB, modelId });
        return;
      }
      setVoConfirm(null);

      const result = await runGenerateVoiceover(studioStore, { text: voText, at: voAt, confirmDownload: true });
      setVoFeedback(result.ok ? result.summary : result.error);
      if (result.ok) {
        setVoText('');
        setVoAt('');
      }
    } finally {
      setVoBusy(false);
      setTimeout(() => setVoFeedback(null), 3000);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5 rounded-token border border-line bg-surface-2 p-2">
        <h3 className="text-[13px] font-semibold">Remove background</h3>
        <div className="flex flex-wrap gap-1.5">
          <input value={matteStart} onChange={(e) => setMatteStart(e.target.value)} placeholder="start" className="w-16 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[11px]" aria-label="Matte start" />
          <input value={matteEnd} onChange={(e) => setMatteEnd(e.target.value)} placeholder="end" className="w-16 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[11px]" aria-label="Matte end" />
          <select value={matteTier} onChange={(e) => setMatteTier(e.target.value as 'portrait' | 'general')} className="rounded border border-line bg-surface px-1.5 py-1 text-[12px]" aria-label="Matting tier">
            <option value="portrait">Portrait</option>
            <option value="general">General</option>
          </select>
          <select value={matteReplace} onChange={(e) => setMatteReplace(e.target.value as MatteReplace)} className="rounded border border-line bg-surface px-1.5 py-1 text-[12px]" aria-label="Replace with">
            <option value="transparent">Transparent</option>
            <option value="color">Color</option>
            <option value="blur">Blur</option>
          </select>
          {matteReplace === 'color' && (
            <input type="color" value={matteColor} onChange={(e) => setMatteColor(e.target.value)} className="h-[30px] w-8 rounded border border-line bg-surface" aria-label="Replace color" />
          )}
        </div>
        <button
          type="button"
          disabled={matteBusy || !matteStart.trim() || !matteEnd.trim()}
          onClick={() => void handleRemoveBackground(false)}
          className="self-start rounded-token bg-ink px-2.5 py-1 text-[12px] font-medium text-surface disabled:opacity-50"
        >
          {matteBusy ? 'Processing…' : 'Remove background'}
        </button>
        {matteConfirm && (
          <SizeConfirm sizeMB={matteConfirm.sizeMB} label={matteConfirm.modelId} onConfirm={() => void handleRemoveBackground(true)} onCancel={() => setMatteConfirm(null)} />
        )}
        {matteFeedback && <p className="text-[11px] text-ink-3">{matteFeedback}</p>}
      </div>

      <div className="flex flex-col gap-1.5 rounded-token border border-line bg-surface-2 p-2">
        <h3 className="text-[13px] font-semibold">Generate voice-over</h3>
        <textarea
          value={voText}
          onChange={(e) => setVoText(e.target.value)}
          placeholder="What should the voice-over say?"
          rows={2}
          className="rounded border border-line bg-surface px-1.5 py-1 text-[12.5px]"
          aria-label="Voice-over text"
        />
        <div className="flex items-center gap-1.5">
          <input value={voAt} onChange={(e) => setVoAt(e.target.value)} placeholder="at (time)" className="w-20 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[11px]" aria-label="Voice-over time" />
          <button
            type="button"
            disabled={voBusy || !voText.trim() || !voAt.trim()}
            onClick={() => void handleGenerateVoiceover(false)}
            className="rounded-token bg-ink px-2.5 py-1 text-[12px] font-medium text-surface disabled:opacity-50"
          >
            {voBusy ? 'Generating…' : 'Generate'}
          </button>
        </div>
        {voConfirm && <SizeConfirm sizeMB={voConfirm.sizeMB} label={voConfirm.modelId} onConfirm={() => void handleGenerateVoiceover(true)} onCancel={() => setVoConfirm(null)} />}
        {voFeedback && <p className="text-[11px] text-ink-3">{voFeedback}</p>}
      </div>

      {effects.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold">Background removal</h3>
          {effects.map((effect) => (
            <div key={effect.id} className="flex items-center gap-2 rounded-token bg-surface-2 p-2 text-[12.5px]">
              <button type="button" onClick={() => void seek(effect.start)} className="min-w-0 flex-1 text-left">
                <span className="font-mono text-[11px] text-ink-3">
                  {secsToTimecode(effect.start)} → {secsToTimecode(effect.end)} · {effect.model}
                </span>
                <p className="flex items-center gap-1.5">
                  {REPLACE_LABELS[effect.replace]}
                  {effect.replace === 'color' && effect.color && (
                    <span
                      className="inline-block h-3 w-3 rounded-full border border-line"
                      style={{ background: `rgb(${effect.color.r}, ${effect.color.g}, ${effect.color.b})` }}
                    />
                  )}
                </p>
              </button>
              <button
                type="button"
                onClick={() => removeEffect(effect.id)}
                aria-label={`Remove effect: ${effect.model} ${secsToTimecode(effect.start)}`}
                className="grid h-5 w-5 flex-none place-items-center rounded text-ink-3 hover:bg-line hover:text-clay-ink"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {voiceovers.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-[13px] font-semibold">Voice-overs</h3>
          {voiceovers.map((vo) => (
            <div key={vo.id} className="flex items-start gap-2 rounded-token bg-surface-2 p-2 text-[12.5px]">
              <button type="button" onClick={() => void seek(vo.at)} className="min-w-0 flex-1 text-left">
                <span className="font-mono text-[11px] text-ink-3">
                  {secsToTimecode(vo.at)} · {vo.durationSeconds.toFixed(1)}s · {vo.voice}
                </span>
                <p className="truncate">{vo.text}</p>
              </button>
              <button
                type="button"
                onClick={() => handlePlay(vo.id, vo.blob)}
                aria-label={`Play voice-over: ${vo.text}`}
                className="flex-none self-center rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-line"
              >
                {playingId === vo.id ? 'Playing…' : 'Play'}
              </button>
              <button
                type="button"
                onClick={() => removeVoiceover(vo.id)}
                aria-label={`Remove voice-over: ${vo.text}`}
                className="grid h-5 w-5 flex-none place-items-center self-center rounded text-ink-3 hover:bg-line hover:text-clay-ink"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
