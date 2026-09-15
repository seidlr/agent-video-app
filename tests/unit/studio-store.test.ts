import { describe, expect, it } from 'vitest';
import { createStudioStore } from '../../src/store/studio';

describe('createStudioStore', () => {
  it('starts with the documented slice shape and defaults', () => {
    const store = createStudioStore();
    const s = store.getState();

    expect(s.source).toBeNull();
    expect(s.player).toEqual({
      currentTime: 0,
      duration: 0,
      paused: true,
      volume: 1,
      muted: false,
      rate: 1,
      loop: null,
      fps: 30,
      width: 0,
      height: 0,
    });
    expect(s.frames).toEqual([]);
    expect(s.boxes).toEqual([]);
    expect(s.tracks).toEqual([]);
    expect(s.notes).toEqual([]);
    expect(s.chapters).toEqual([]);
    expect(s.transcript).toEqual({ segments: [], lang: null });
    expect(s.scenes).toEqual([]);
    expect(s.visionSearch).toBeNull();
    expect(s.clips).toEqual([]);
    expect(s.activity).toEqual([]);
    expect(s.ui.theme).toBe('system');
    expect(s.ui.panel).toBe('activity');
    expect(s.ui.agentTransport).toBe('none');
    expect(s.storage.persisted).toBe(false);
  });

  it('setSource replaces the current resolved source', () => {
    const store = createStudioStore();
    const source = {
      src: 'https://files.vidstack.io/sprite-fight/720p.mp4',
      title: 'Sprite Fight',
      kind: 'sample' as const,
      canCapture: true,
    };
    store.getState().setSource(source);
    expect(store.getState().source).toEqual(source);
    store.getState().setSource(null);
    expect(store.getState().source).toBeNull();
  });

  it('player setters update only the targeted field', () => {
    const store = createStudioStore();
    store.getState().setCurrentTime(12.5);
    store.getState().setPaused(false);
    expect(store.getState().player.currentTime).toBe(12.5);
    expect(store.getState().player.paused).toBe(false);
    expect(store.getState().player.duration).toBe(0);
  });

  it('addNote/updateNote/removeNote manage the notes list', () => {
    const store = createStudioStore();
    const id = store.getState().addNote({ time: 1.5, text: 'hello', tags: ['x'], createdBy: 'agent' });
    expect(store.getState().notes).toHaveLength(1);
    expect(store.getState().notes[0]?.id).toBe(id);

    store.getState().updateNote(id, { text: 'updated' });
    expect(store.getState().notes[0]?.text).toBe('updated');

    store.getState().removeNote(id);
    expect(store.getState().notes).toHaveLength(0);
  });

  it('addChapter rejects an overlapping range', () => {
    const store = createStudioStore();
    store.getState().addChapter({ start: 0, end: 10, title: 'Intro' });
    expect(() => store.getState().addChapter({ start: 5, end: 15, title: 'Overlap' })).toThrow(
      /chapter_overlap/,
    );
    expect(store.getState().chapters).toHaveLength(1);
  });

  it('addFrame/removeFrame manage the frames tray and revoke the blob URL on removal', () => {
    const store = createStudioStore();
    const id = store.getState().addFrame({ time: 2, kind: 'frame', width: 640, height: 360, blobUrl: 'blob:mock-1' });
    expect(store.getState().frames).toHaveLength(1);
    expect(store.getState().frames[0]?.id).toBe(id);

    const revoked: string[] = [];
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => revoked.push(url);
    try {
      store.getState().removeFrame(id);
    } finally {
      URL.revokeObjectURL = original;
    }
    expect(store.getState().frames).toHaveLength(0);
    expect(revoked).toEqual(['blob:mock-1']);
  });

  it('setSourceThumbnailsVtt patches thumbnailsVttUrl onto the current source without touching other fields', () => {
    const store = createStudioStore();
    store.getState().setSource({ src: 'blob:video', title: 'Clip', kind: 'file', canCapture: true, assetId: 'a1' });

    store.getState().setSourceThumbnailsVtt('blob:generated-vtt');

    expect(store.getState().source).toEqual({
      src: 'blob:video',
      title: 'Clip',
      kind: 'file',
      canCapture: true,
      assetId: 'a1',
      thumbnailsVttUrl: 'blob:generated-vtt',
    });
  });

  it('setSourceThumbnailsVtt is a no-op when there is no current source', () => {
    const store = createStudioStore();
    store.getState().setSourceThumbnailsVtt('blob:generated-vtt');
    expect(store.getState().source).toBeNull();
  });

  it('setSourceThumbnailsSprite patches the sprite url and timestamps onto the current source', () => {
    const store = createStudioStore();
    store.getState().setSource({ src: 'blob:video', title: 'Clip', kind: 'file', canCapture: true, assetId: 'a1' });

    store.getState().setSourceThumbnailsSprite('blob:generated-sprite', [1, 3, 5]);

    expect(store.getState().source).toEqual({
      src: 'blob:video',
      title: 'Clip',
      kind: 'file',
      canCapture: true,
      assetId: 'a1',
      thumbnailsSpriteUrl: 'blob:generated-sprite',
      thumbnailsTimestamps: [1, 3, 5],
    });
  });

  it('setSourceThumbnailsSprite is a no-op when there is no current source', () => {
    const store = createStudioStore();
    store.getState().setSourceThumbnailsSprite('blob:generated-sprite', [1, 3, 5]);
    expect(store.getState().source).toBeNull();
  });

  it('addTrack/appendTrackKeyframe/removeTrack manage the tracks list', () => {
    const store = createStudioStore();
    const id = store.getState().addTrack({ boxIds: ['b1'], keyframes: [{ time: 0, box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }] });

    expect(store.getState().tracks).toEqual([{ id, boxIds: ['b1'], keyframes: [{ time: 0, box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 } }] }]);

    store.getState().appendTrackKeyframe(id, { time: 0.5, box: { x: 0.12, y: 0.1, w: 0.1, h: 0.1 } });
    expect(store.getState().tracks[0]?.keyframes).toHaveLength(2);
    expect(store.getState().tracks[0]?.keyframes[1]).toEqual({ time: 0.5, box: { x: 0.12, y: 0.1, w: 0.1, h: 0.1 } });

    store.getState().removeTrack(id);
    expect(store.getState().tracks).toEqual([]);
  });

  it('appendTrackKeyframe is a no-op for an unknown track id', () => {
    const store = createStudioStore();
    store.getState().appendTrackKeyframe('missing', { time: 0, box: { x: 0, y: 0, w: 1, h: 1 } });
    expect(store.getState().tracks).toEqual([]);
  });

  it('setModelState merges a patch into a model, defaulting unset fields, and preserves other models', () => {
    const store = createStudioStore();
    store.getState().setModelState('edgetam', { cached: true });
    expect(store.getState().models.edgetam).toEqual({ cached: true, loaded: false, progress: 0 });

    store.getState().setModelState('edgetam', { loaded: true, progress: 1 });
    expect(store.getState().models.edgetam).toEqual({ cached: true, loaded: true, progress: 1 });

    store.getState().setModelState('slimsam', { progress: 0.5 });
    expect(store.getState().models.slimsam).toEqual({ cached: false, loaded: false, progress: 0.5 });
    expect(store.getState().models.edgetam).toEqual({ cached: true, loaded: true, progress: 1 });
  });

  it('setScenes replaces the last detect_scenes result wholesale', () => {
    const store = createStudioStore();
    store.getState().setScenes([{ start: 0, end: 2 }, { start: 2, end: 4 }]);
    expect(store.getState().scenes).toEqual([{ start: 0, end: 2 }, { start: 2, end: 4 }]);

    store.getState().setScenes([{ start: 0, end: 8 }]);
    expect(store.getState().scenes).toEqual([{ start: 0, end: 8 }]);
  });

  it('setNotes/setChapters/setBoxes/setTracks/setClips/setFrames wholesale-replace their slices (project-restore-on-boot use)', () => {
    const store = createStudioStore();
    const note = { id: 'n1', time: 1, text: 'hi', tags: [], createdBy: 'user' as const, createdAt: 0 };
    const chapter = { id: 'c1', start: 0, end: 2, title: 'Intro' };
    const box = { id: 'b1', time: 0, x: 0, y: 0, w: 1, h: 1, label: 'x', source: 'manual' as const };
    const track = { id: 't1', boxIds: ['b1'], keyframes: [] };
    const clip = { id: 'cl1', start: 0, end: 1, order: 0 };
    const frame = { id: 'f1', time: 0, kind: 'frame' as const, width: 10, height: 10, blobUrl: 'blob:x' };

    store.getState().setNotes([note]);
    store.getState().setChapters([chapter]);
    store.getState().setBoxes([box]);
    store.getState().setTracks([track]);
    store.getState().setClips([clip]);
    store.getState().setFrames([frame]);

    expect(store.getState().notes).toEqual([note]);
    expect(store.getState().chapters).toEqual([chapter]);
    expect(store.getState().boxes).toEqual([box]);
    expect(store.getState().tracks).toEqual([track]);
    expect(store.getState().clips).toEqual([clip]);
    expect(store.getState().frames).toEqual([frame]);

    store.getState().setNotes([]);
    expect(store.getState().notes).toEqual([]);
  });

  it('setVisionSearch replaces the last search_frames result wholesale', () => {
    const store = createStudioStore();
    store.getState().setVisionSearch({ query: 'a red image', ranges: [{ start: 0, end: 2, score: 0.15 }] });
    expect(store.getState().visionSearch).toEqual({ query: 'a red image', ranges: [{ start: 0, end: 2, score: 0.15 }] });

    store.getState().setVisionSearch(null);
    expect(store.getState().visionSearch).toBeNull();
  });

  it('pushActivity keeps at most 200 entries, dropping the oldest', () => {
    const store = createStudioStore();
    for (let i = 0; i < 205; i++) {
      store.getState().pushActivity({
        id: `call-${i}`,
        name: 'seek',
        args: {},
        via: 'webmcp',
        status: 'done',
        startedAt: i,
      });
    }
    const activity = store.getState().activity;
    expect(activity).toHaveLength(200);
    expect(activity[0]?.id).toBe('call-5');
    expect(activity[199]?.id).toBe('call-204');
  });
});
