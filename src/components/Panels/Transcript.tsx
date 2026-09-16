import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { secsToTimecode } from '../../lib/time';
import type { TranscriptSegment } from '../../lib/types';
import { getPersistedTranscript, listTranslatedLangs } from '../../store/transcript';
import { useStudio } from '../../store/studio';

/**
 * Transcript panel (Task 8, TS-006 step 3/4): segment rows (click seeks), a search box, and an
 * "Add as note" action per row -- per the plan's own Key Decisions. The search box filters
 * client-side with the same case-insensitive substring rule as the `search_transcript` tool
 * (agent/tools/transcript.ts) so a human typing here sees exactly what an agent's tool call would
 * find, without duplicating that tool's own network/model-loading path -- there is none here,
 * `transcript.segments` is already fully in memory once `transcribe` has run.
 *
 * Task 13's language switch reads whichever `translate_transcript` languages have been persisted
 * for the current asset (store/transcript.ts's own `listTranslatedLangs`) -- the original stays
 * the always-in-memory `transcript.segments`; a translated language is fetched from Dexie on
 * selection rather than replacing that in-memory slice, so switching away and back never re-runs
 * a model call or loses the original.
 */
export function Transcript(): ReactElement {
  const [query, setQuery] = useState('');
  const transcript = useStudio((s) => s.transcript);
  const source = useStudio((s) => s.source);
  const seek = useStudio((s) => s.seek);
  const addNote = useStudio((s) => s.addNote);
  const [addedAt, setAddedAt] = useState<number | null>(null);

  const [availableLangs, setAvailableLangs] = useState<string[]>([]);
  const [selectedLang, setSelectedLang] = useState<string | null>(null);
  const [translatedSegments, setTranslatedSegments] = useState<TranscriptSegment[] | null>(null);

  const assetId = source?.assetId;
  useEffect(() => {
    setSelectedLang(null);
    setTranslatedSegments(null);
    if (!assetId) {
      setAvailableLangs([]);
      return;
    }
    void listTranslatedLangs(assetId).then(setAvailableLangs);
  }, [assetId, transcript.segments]);

  useEffect(() => {
    if (!assetId || !selectedLang) {
      setTranslatedSegments(null);
      return;
    }
    void getPersistedTranscript(assetId, selectedLang).then(setTranslatedSegments);
  }, [assetId, selectedLang]);

  const displaySegments = useMemo(() => (selectedLang ? (translatedSegments ?? []) : transcript.segments), [selectedLang, translatedSegments, transcript.segments]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return displaySegments;
    return displaySegments.filter((s) => s.text.toLowerCase().includes(q));
  }, [displaySegments, query]);

  function handleAddAsNote(start: number, end: number, text: string): void {
    addNote({ time: start, end, text, tags: ['transcript'], createdBy: 'user' });
    setAddedAt(start);
    setTimeout(() => setAddedAt((t) => (t === start ? null : t)), 1500);
  }

  if (transcript.segments.length === 0) {
    return <p className="text-[13px] text-ink-3">No transcript yet -- ask the agent to transcribe this video, or call `transcribe` yourself.</p>;
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcript"
          aria-label="Search transcript"
          className="min-w-0 flex-1 rounded border border-line bg-surface px-1.5 py-1 text-[12.5px]"
        />
        {availableLangs.length > 0 && (
          <select
            value={selectedLang ?? ''}
            onChange={(e) => setSelectedLang(e.target.value || null)}
            aria-label="Transcript language"
            className="flex-none rounded border border-line bg-surface px-1.5 py-1 text-[12.5px]"
          >
            <option value="">Original</option>
            {availableLangs.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-[13px] text-ink-3">{selectedLang ? `No ${selectedLang} segments yet.` : `No segments match "${query}".`}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((segment, i) => (
            <div key={`${segment.start}-${i}`} className="flex items-start gap-2 rounded-token bg-surface-2 p-2 text-[12.5px]">
              <button type="button" onClick={() => void seek(segment.start)} className="min-w-0 flex-1 text-left">
                <span className="font-mono text-[11px] text-ink-3">
                  {secsToTimecode(segment.start)} → {secsToTimecode(segment.end)}
                </span>
                <p>{segment.text}</p>
              </button>
              <button
                type="button"
                onClick={() => handleAddAsNote(segment.start, segment.end, segment.text)}
                className="flex-none self-center rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-line"
              >
                {addedAt === segment.start ? 'Added!' : 'Add as note'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
