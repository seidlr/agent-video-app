import { describe, expect, it } from 'vitest';
import { buildProjectManifest, buildProjectZip, parseProjectManifest, parseProjectZip } from '../../src/media/project';

const CTX = {
  asset: { title: 'my-video' },
  notes: [{ id: 'n1', time: 1, text: 'hi', tags: [], createdBy: 'user' as const, createdAt: 0 }],
  chapters: [{ id: 'c1', start: 0, end: 2, title: 'Intro' }],
  boxes: [{ id: 'b1', time: 0, x: 0, y: 0, w: 1, h: 1, label: 'x', source: 'manual' as const }],
  tracks: [{ id: 't1', boxIds: ['b1'], keyframes: [] }],
  clips: [{ id: 'cl1', start: 0, end: 1, order: 0 }],
  fps: 30,
};

const FRAME_META = [{ id: 'f1', time: 1, kind: 'frame' as const, width: 10, height: 10, file: 'frames/f1.png' }];

describe('media/project (pure serializer)', () => {
  it('buildProjectManifest wraps the Task 6 JSON export shape and adds a frames manifest', () => {
    const manifest = buildProjectManifest(CTX, FRAME_META);
    expect(manifest.version).toBe(1);
    expect(manifest.asset).toEqual({ title: 'my-video' });
    expect(manifest.notes).toEqual(CTX.notes);
    expect(manifest.chapters).toEqual(CTX.chapters);
    expect(manifest.boxes).toEqual(CTX.boxes);
    expect(manifest.tracks).toEqual(CTX.tracks);
    expect(manifest.clips).toEqual(CTX.clips);
    expect(manifest.frames).toEqual(FRAME_META);
  });

  it('buildProjectManifest defaults tracks/clips/frames to [] when omitted', () => {
    const manifest = buildProjectManifest({ asset: { title: 'x' }, notes: [], chapters: [], boxes: [], fps: 30 }, []);
    expect(manifest.tracks).toEqual([]);
    expect(manifest.clips).toEqual([]);
    expect(manifest.frames).toEqual([]);
  });

  it('parseProjectManifest round-trips a serialized manifest byte-identically', () => {
    const manifest = buildProjectManifest(CTX, FRAME_META);
    const json = JSON.stringify(manifest);
    const parsed = parseProjectManifest(json);
    expect(parsed).toEqual(manifest);
  });

  it('parseProjectManifest rejects malformed JSON with a clear error', () => {
    expect(() => parseProjectManifest('not json')).toThrow(/invalid_project_json/);
  });

  it('parseProjectManifest rejects a document missing required fields', () => {
    expect(() => parseProjectManifest(JSON.stringify({ version: 1 }))).toThrow(/invalid_project_json/);
  });

  it('buildProjectZip/parseProjectZip round-trips notes/chapters/boxes/clips and frame bytes byte-identically', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]); // arbitrary bytes standing in for a real PNG
    const frameBlob = new Blob([pngBytes], { type: 'image/png' });

    const zipBlob = await buildProjectZip({
      ctx: CTX,
      frames: [{ id: 'f1', time: 1, kind: 'frame', width: 10, height: 10, blob: frameBlob }],
    });
    expect(zipBlob.size).toBeGreaterThan(0);

    const parsed = await parseProjectZip(zipBlob);
    expect(parsed.manifest.notes).toEqual(CTX.notes);
    expect(parsed.manifest.chapters).toEqual(CTX.chapters);
    expect(parsed.manifest.boxes).toEqual(CTX.boxes);
    expect(parsed.manifest.clips).toEqual(CTX.clips);
    expect(parsed.manifest.frames).toEqual([{ id: 'f1', time: 1, kind: 'frame', width: 10, height: 10, downloadedAs: undefined, file: 'frames/f1.png' }]);

    const restoredBlob = parsed.frameBlobs.get('f1');
    expect(restoredBlob).toBeDefined();
    const restoredBytes = new Uint8Array(await restoredBlob!.arrayBuffer());
    expect(restoredBytes).toEqual(pngBytes);
  });

  it('parseProjectZip rejects a zip missing project.json', async () => {
    const { zipSync } = await import('fflate');
    const blob = new Blob([zipSync({ 'other.txt': new TextEncoder().encode('x') })]);
    await expect(parseProjectZip(blob)).rejects.toThrow(/invalid_project_zip/);
  });
});
