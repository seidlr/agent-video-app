import { useState } from 'react';
import type { ReactElement } from 'react';
import { Trash2 } from 'lucide-react';
import { EXPORT_FORMATS } from '../../lib/exports';
import type { ExportFormatId } from '../../lib/exports';
import { parseTime, secsToTimecode } from '../../lib/time';
import { useStudio } from '../../store/studio';

const FORMAT_LABELS: Record<ExportFormatId, string> = {
  markdown: 'Markdown',
  json: 'JSON',
  vtt: 'VTT',
  srt: 'SRT',
  csv: 'CSV',
  edl: 'EDL',
};

/** `<a download>` click, no picker -- same pattern as tools/frames.ts and tools/exports.ts's own
 * triggerDownload, kept separate here since this one runs from a real user click rather than an
 * agent tool call. */
function triggerDownload(text: string, filename: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Notes + Chapters tabs and the six-format export menu (TS-004). UI actions call the store
 * directly rather than going through the agent registry -- the same pattern Timeline/Markers
 * already use for seek, and Frames.tsx for delete -- since the Activity feed is for what an agent
 * did, not a running log of human clicks.
 */
export function Notes(): ReactElement {
  const [tab, setTab] = useState<'notes' | 'chapters'>('notes');
  const [copiedFormat, setCopiedFormat] = useState<ExportFormatId | null>(null);

  const notes = useStudio((s) => s.notes);
  const chapters = useStudio((s) => s.chapters);
  const boxes = useStudio((s) => s.boxes);
  const tracks = useStudio((s) => s.tracks);
  const clips = useStudio((s) => s.clips);
  const transcript = useStudio((s) => s.transcript);
  const player = useStudio((s) => s.player);
  const source = useStudio((s) => s.source);
  const seek = useStudio((s) => s.seek);
  const addNote = useStudio((s) => s.addNote);
  const removeNote = useStudio((s) => s.removeNote);
  const addChapter = useStudio((s) => s.addChapter);
  const removeChapter = useStudio((s) => s.removeChapter);

  const [noteTime, setNoteTime] = useState('');
  const [noteEnd, setNoteEnd] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteTags, setNoteTags] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const [chapterStart, setChapterStart] = useState('');
  const [chapterEnd, setChapterEnd] = useState('');
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterError, setChapterError] = useState<string | null>(null);

  const timeCtx = { currentTime: player.currentTime, duration: player.duration, fps: player.fps };

  function handleAddNote(): void {
    setNoteError(null);
    if (!noteText.trim()) return setNoteError('Text is required.');
    const time = parseTime(noteTime || player.currentTime, timeCtx);
    if (time === null) return setNoteError('Invalid time.');
    let end: number | undefined;
    if (noteEnd.trim()) {
      const parsedEnd = parseTime(noteEnd, timeCtx);
      if (parsedEnd === null) return setNoteError('Invalid end time.');
      if (parsedEnd <= time) return setNoteError('End must be after time.');
      end = parsedEnd;
    }
    addNote({ time, end, text: noteText.trim(), tags: noteTags.split(',').map((t) => t.trim()).filter(Boolean), createdBy: 'user' });
    setNoteTime('');
    setNoteEnd('');
    setNoteText('');
    setNoteTags('');
  }

  function handleAddChapter(): void {
    setChapterError(null);
    if (!chapterTitle.trim()) return setChapterError('Title is required.');
    const start = parseTime(chapterStart || 0, timeCtx);
    const end = parseTime(chapterEnd, timeCtx);
    if (start === null || end === null) return setChapterError('Invalid start/end.');
    if (end <= start) return setChapterError('End must be after start.');
    try {
      addChapter({ start, end, title: chapterTitle.trim() });
      setChapterStart('');
      setChapterEnd('');
      setChapterTitle('');
    } catch {
      setChapterError('Overlaps an existing chapter.');
    }
  }

  function buildExportContext() {
    return {
      asset: { title: source?.title ?? 'video' },
      notes,
      chapters,
      boxes,
      tracks,
      clips,
      transcript,
      fps: player.fps || 30,
    };
  }

  function handleDownload(formatId: ExportFormatId): void {
    const def = EXPORT_FORMATS[formatId];
    const title = source?.title ?? 'video';
    triggerDownload(def.generate(buildExportContext()), `${title}-notes.${def.extension}`, def.mimeType);
  }

  async function handleCopy(formatId: ExportFormatId): Promise<void> {
    const def = EXPORT_FORMATS[formatId];
    try {
      await navigator.clipboard.writeText(def.generate(buildExportContext()));
      setCopiedFormat(formatId);
      setTimeout(() => setCopiedFormat((f) => (f === formatId ? null : f)), 1500);
    } catch {
      // Clipboard API unavailable/denied -- nothing more to do from a plain click.
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex gap-1 rounded-token bg-surface-2 p-0.5">
        {(['notes', 'chapters'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded px-2 py-1 text-[12px] font-medium capitalize transition-colors ${tab === t ? 'bg-surface text-ink shadow-sm' : 'text-ink-3'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'notes' ? (
        <>
          <div className="flex flex-col gap-1.5 rounded-token border border-line bg-surface-2 p-2">
            <div className="flex gap-1.5">
              <input
                value={noteTime}
                onChange={(e) => setNoteTime(e.target.value)}
                placeholder={secsToTimecode(player.currentTime)}
                className="w-16 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[11px]"
                aria-label="Note time"
              />
              <input
                value={noteEnd}
                onChange={(e) => setNoteEnd(e.target.value)}
                placeholder="end (optional)"
                className="w-24 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[11px]"
                aria-label="Note end time"
              />
            </div>
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Note text"
              className="rounded border border-line bg-surface px-1.5 py-1 text-[12.5px]"
              aria-label="Note text"
            />
            <input
              value={noteTags}
              onChange={(e) => setNoteTags(e.target.value)}
              placeholder="tags, comma, separated"
              className="rounded border border-line bg-surface px-1.5 py-1 text-[12px]"
              aria-label="Note tags"
            />
            {noteError && <p className="text-[11px] text-clay-ink">{noteError}</p>}
            <button type="button" onClick={handleAddNote} className="self-start rounded-token bg-ink px-2.5 py-1 text-[12px] font-medium text-surface">
              Add note
            </button>
          </div>

          {notes.length === 0 ? (
            <p className="text-[13px] text-ink-3">No notes yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {notes.map((n) => (
                <div key={n.id} className="flex items-start gap-2 rounded-token bg-surface-2 p-2 text-[12.5px]">
                  <button type="button" onClick={() => void seek(n.time)} className="min-w-0 flex-1 text-left">
                    <span className="font-mono text-[11px] text-ink-3">
                      {secsToTimecode(n.time)}
                      {n.end !== undefined && ` → ${secsToTimecode(n.end)}`}
                    </span>
                    <p className="truncate">{n.text}</p>
                    {n.tags.length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {n.tags.map((t) => (
                          <span key={t} className="rounded bg-chip px-1.5 py-0.5 text-[10px] text-ink-2">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeNote(n.id)}
                    aria-label={`Delete note: ${n.text}`}
                    className="grid h-5 w-5 flex-none place-items-center rounded text-ink-3 hover:bg-line hover:text-clay-ink"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5 rounded-token border border-line bg-surface-2 p-2">
            <div className="flex gap-1.5">
              <input
                value={chapterStart}
                onChange={(e) => setChapterStart(e.target.value)}
                placeholder="start"
                className="w-16 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[11px]"
                aria-label="Chapter start"
              />
              <input
                value={chapterEnd}
                onChange={(e) => setChapterEnd(e.target.value)}
                placeholder="end"
                className="w-16 rounded border border-line bg-surface px-1.5 py-1 font-mono text-[11px]"
                aria-label="Chapter end"
              />
            </div>
            <input
              value={chapterTitle}
              onChange={(e) => setChapterTitle(e.target.value)}
              placeholder="Chapter title"
              className="rounded border border-line bg-surface px-1.5 py-1 text-[12.5px]"
              aria-label="Chapter title"
            />
            {chapterError && <p className="text-[11px] text-clay-ink">{chapterError}</p>}
            <button type="button" onClick={handleAddChapter} className="self-start rounded-token bg-ink px-2.5 py-1 text-[12px] font-medium text-surface">
              Add chapter
            </button>
          </div>

          {chapters.length === 0 ? (
            <p className="text-[13px] text-ink-3">No chapters yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {chapters.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-token bg-surface-2 p-2 text-[12.5px]">
                  <button type="button" onClick={() => void seek(c.start)} className="min-w-0 flex-1 text-left">
                    <span className="font-mono text-[11px] text-ink-3">
                      {secsToTimecode(c.start)} → {secsToTimecode(c.end)}
                    </span>
                    <p className="truncate font-medium">{c.title}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeChapter(c.id)}
                    aria-label={`Delete chapter: ${c.title}`}
                    className="grid h-5 w-5 flex-none place-items-center rounded text-ink-3 hover:bg-line hover:text-clay-ink"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="border-t border-line pt-3">
        <h3 className="mb-1.5 text-[13px] font-semibold">Export notes</h3>
        <div className="flex flex-col gap-1">
          {(Object.keys(EXPORT_FORMATS) as ExportFormatId[]).map((id) => (
            <div key={id} className="flex items-center justify-between rounded-token bg-surface-2 px-2 py-1 text-[12px]">
              <span>{FORMAT_LABELS[id]}</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => handleDownload(id)} className="rounded px-1.5 py-0.5 text-ink-2 hover:bg-line" aria-label={`Download ${FORMAT_LABELS[id]}`}>
                  Download
                </button>
                <button type="button" onClick={() => void handleCopy(id)} className="rounded px-1.5 py-0.5 text-ink-2 hover:bg-line" aria-label={`Copy ${FORMAT_LABELS[id]}`}>
                  {copiedFormat === id ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
