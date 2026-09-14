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
