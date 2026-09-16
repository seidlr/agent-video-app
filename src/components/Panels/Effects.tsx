import { useState } from 'react';
import type { ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import { secsToTimecode } from '../../lib/time';
import { useStudio } from '../../store/studio';

const REPLACE_LABELS: Record<'transparent' | 'color' | 'blur', string> = {
  transparent: 'Transparent',
  color: 'Color',
  blur: 'Blurred background',
};

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

  if (effects.length === 0 && voiceovers.length === 0) {
    return <p className="text-[13px] text-ink-3">No effects yet -- ask the agent to call remove_background or generate_voiceover.</p>;
  }

  return (
    <div className="flex flex-col gap-3.5">
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
