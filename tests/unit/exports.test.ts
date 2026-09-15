import { describe, expect, it } from 'vitest';
import { EXPORT_FORMATS, secondsToEdlTimecode } from '../../src/lib/exports';
import { exportVtt } from '../../src/lib/exports/vtt';
import type { ExportContext } from '../../src/lib/exports/types';

// Task 6 DoD fixture: "2 notes, 1 chapter, 1 box, fps 30".
const CTX: ExportContext = {
  asset: { title: 'Test Video' },
  fps: 30,
  chapters: [{ id: 'c1', start: 0, end: 10, title: 'Intro' }],
  notes: [
    { id: 'n1', time: 1.5, text: 'First note', tags: ['important'], createdBy: 'agent', createdAt: 0 },
    { id: 'n2', time: 5, end: 8, text: 'Region note', tags: [], createdBy: 'user', createdAt: 0 },
  ],
  boxes: [{ id: 'b1', time: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.4, label: 'Ball', source: 'agent' }],
};

describe('exportMarkdown', () => {
  it('renders title, chapters, notes (with tags), and boxes sections', () => {
    expect(EXPORT_FORMATS.markdown.generate(CTX)).toBe(
      '# Test Video\n\n' +
        '## Chapters\n\n' +
        '- [00:00.000 → 00:10.000] Intro\n\n' +
        '## Notes\n\n' +
        '- [00:01.500] First note #important\n' +
        '- [00:05.000 → 00:08.000] Region note\n\n' +
        '## Boxes\n\n' +
        '- [00:02.000] Ball\n',
    );
  });

  it('omits a section entirely when it has nothing to show', () => {
    const empty: ExportContext = { ...CTX, chapters: [], boxes: [] };
    expect(EXPORT_FORMATS.markdown.generate(empty)).toBe('# Test Video\n\n## Notes\n\n- [00:01.500] First note #important\n- [00:05.000 → 00:08.000] Region note\n');
  });

  it('appends an optional Transcript section when segments are present', () => {
    const withTranscript: ExportContext = { ...CTX, transcript: { lang: 'en', segments: [{ start: 0, end: 2, text: 'Hello there' }] } };
    expect(EXPORT_FORMATS.markdown.generate(withTranscript)).toContain('## Transcript\n\n- [00:00.000 → 00:02.000] Hello there\n');
  });
});

describe('exportJson', () => {
  it('produces a versioned document with every section, defaulting tracks/clips to []', () => {
    const doc = JSON.parse(EXPORT_FORMATS.json.generate(CTX)) as Record<string, unknown>;
    expect(doc).toEqual({
      version: 1,
      asset: { title: 'Test Video' },
      chapters: CTX.chapters,
      notes: CTX.notes,
      boxes: CTX.boxes,
      tracks: [],
      clips: [],
    });
  });
});

describe('exportVtt', () => {
  it('renders notes as cues, giving a point note a fixed 2s span', () => {
    expect(EXPORT_FORMATS.vtt.generate(CTX)).toBe(
      'WEBVTT\n\n00:00:01.500 --> 00:00:03.500\nFirst note #important\n\n00:00:05.000 --> 00:00:08.000\nRegion note\n',
    );
  });

  it("renders chapters as a second, equally valid VTT block via kind:'chapters'", () => {
    expect(exportVtt(CTX, 'chapters')).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nIntro\n');
  });
});

describe('exportSrt', () => {
  it('numbers notes sequentially with comma-millisecond timestamps (not the app-wide dot format)', () => {
    expect(EXPORT_FORMATS.srt.generate(CTX)).toBe(
      '1\n00:00:01,500 --> 00:00:03,500\nFirst note #important\n\n2\n00:00:05,000 --> 00:00:08,000\nRegion note\n',
    );
  });

  it('returns an empty string when there are no notes', () => {
    expect(EXPORT_FORMATS.srt.generate({ ...CTX, notes: [] })).toBe('');
  });
});

describe('exportCsv', () => {
  it('emits one row per chapter/note/box with plain-seconds start/end and blank end where inapplicable', () => {
    expect(EXPORT_FORMATS.csv.generate(CTX)).toBe(
      'type,start,end,label,tags\n' +
        'chapter,0,10,Intro,\n' +
        'note,1.5,,First note,important\n' +
        'note,5,8,Region note,\n' +
        'box,2,,Ball,\n',
    );
  });

  it('quotes a label containing a comma', () => {
    const ctx: ExportContext = { ...CTX, chapters: [], notes: [], boxes: [{ id: 'b1', time: 0, x: 0, y: 0, w: 1, h: 1, label: 'Left, then right', source: 'agent' }] };
    expect(EXPORT_FORMATS.csv.generate(ctx)).toBe('type,start,end,label,tags\nbox,0,,"Left, then right",\n');
  });
});

describe('secondsToEdlTimecode', () => {
  it('DoD: 1.5s @ 30fps → 00:00:01:15', () => {
    expect(secondsToEdlTimecode(1.5, 30)).toBe('00:00:01:15');
  });

  it('rolls seconds/minutes/hours over correctly', () => {
    expect(secondsToEdlTimecode(3661, 30)).toBe('01:01:01:00');
  });
});

describe('exportEdl', () => {
  it('emits a CMX3600 header and one V C event per chapter when there are no clips', () => {
    expect(EXPORT_FORMATS.edl.generate(CTX)).toBe(
      'TITLE: Test Video\nFCM: NON-DROP FRAME\n\n001  AX       V     C        00:00:00:00 00:00:10:00 00:00:00:00 00:00:10:00\n* FROM CLIP NAME: Intro\n',
    );
  });

  it('prefers clips over chapters when clips exist', () => {
    const ctx: ExportContext = { ...CTX, clips: [{ id: 'clip1', start: 0, end: 1.5, name: 'Cut 1', order: 0 }] };
    expect(EXPORT_FORMATS.edl.generate(ctx)).toBe(
      'TITLE: Test Video\nFCM: NON-DROP FRAME\n\n001  AX       V     C        00:00:00:00 00:00:01:15 00:00:00:00 00:00:01:15\n* FROM CLIP NAME: Cut 1\n',
    );
  });
});
