import { describe, expect, it, vi } from 'vitest';
import { createStudioStore, type PlayerHandle } from '../../src/store/studio';

function createMockPlayer(overrides: Partial<PlayerHandle> = {}): PlayerHandle & {
  emit(type: string): void;
} {
  const listeners = new Map<string, Set<() => void>>();
  const handle: PlayerHandle & { emit(type: string): void } = {
    currentTime: 0,
    volume: 1,
    muted: false,
    playbackRate: 1,
    paused: true,
    play: vi.fn(async () => {
      handle.paused = false;
    }),
    pause: vi.fn(() => {
      handle.paused = true;
    }),
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type) {
      for (const l of listeners.get(type) ?? []) l();
    },
    ...overrides,
  };
  return handle;
}

describe('studio store player actions', () => {
  it('play()/pause() delegate to the registered player handle', async () => {
    const store = createStudioStore();
    const handle = createMockPlayer();
    store.getState().registerPlayer(handle);

    await store.getState().play();
    expect(handle.play).toHaveBeenCalledTimes(1);

    store.getState().pause();
    expect(handle.pause).toHaveBeenCalledTimes(1);
  });

  it('play() waits for canPlayQueue.waitForFlush() before calling play(), when the handle exposes one', async () => {
    const store = createStudioStore();
    const order: string[] = [];
    const handle = createMockPlayer({
      play: vi.fn(async () => {
        order.push('play');
      }),
      canPlayQueue: {
        waitForFlush: vi.fn(async () => {
          order.push('waitForFlush');
        }),
      },
    });
    store.getState().registerPlayer(handle);

    await store.getState().play();

    expect(order).toEqual(['waitForFlush', 'play']);
  });

  it('play() works without a canPlayQueue on the handle (a plain test double, or a real player that lacks it)', async () => {
    const store = createStudioStore();
    const handle = createMockPlayer(); // no canPlayQueue
    store.getState().registerPlayer(handle);

    await expect(store.getState().play()).resolves.toBeUndefined();
    expect(handle.play).toHaveBeenCalledTimes(1);
  });

  it('togglePlay() plays when paused and pauses when playing', async () => {
    const store = createStudioStore();
    const handle = createMockPlayer({ paused: true });
    store.getState().registerPlayer(handle);

    await store.getState().togglePlay();
    expect(handle.play).toHaveBeenCalledTimes(1);

    handle.paused = false;
    await store.getState().togglePlay();
    expect(handle.pause).toHaveBeenCalledTimes(1);
  });

  it('seek() sets currentTime and resolves only after the "seeked" event fires', async () => {
    const store = createStudioStore();
    const handle = createMockPlayer();
    store.getState().registerPlayer(handle);

    let resolved = false;
    const seekPromise = store.getState().seek(12.5).then(() => {
      resolved = true;
    });

    // Not resolved yet -- the mock player hasn't fired "seeked".
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(handle.currentTime).toBe(12.5);

    handle.emit('seeked');
    await seekPromise;
    expect(resolved).toBe(true);
  });

  it('seek() resolves on its own timeout if the player never fires "seeked" (e.g. vidstack\'s YouTube provider, confirmed live not to always dispatch it)', async () => {
    vi.useFakeTimers();
    try {
      const store = createStudioStore();
      const handle = createMockPlayer();
      store.getState().registerPlayer(handle);

      let resolved = false;
      const seekPromise = store.getState().seek(12.5).then(() => {
        resolved = true;
      });

      expect(handle.currentTime).toBe(12.5); // the seek is still requested immediately
      await vi.advanceTimersByTimeAsync(2000); // well past any reasonable "seeked" latency
      await seekPromise;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('seek() without a registered handle updates only the store snapshot', async () => {
    const store = createStudioStore();
    await store.getState().seek(5);
    expect(store.getState().player.currentTime).toBe(5);
  });

  it('setPlayerVolume/Muted/Rate write through to the handle and the store snapshot', () => {
    const store = createStudioStore();
    const handle = createMockPlayer();
    store.getState().registerPlayer(handle);

    store.getState().setPlayerVolume(0.4);
    store.getState().setPlayerMuted(true);
    store.getState().setPlayerRate(1.5);

    expect(handle.volume).toBe(0.4);
    expect(handle.muted).toBe(true);
    expect(handle.playbackRate).toBe(1.5);
    expect(store.getState().player).toMatchObject({ volume: 0.4, muted: true, rate: 1.5 });
  });

  it('stepFrames() seeks by count/fps seconds', async () => {
    const store = createStudioStore();
    const handle = createMockPlayer();
    store.getState().registerPlayer(handle);
    store.getState().setFps(30);
    store.getState().setCurrentTime(1);

    const p = store.getState().stepFrames(3); // +3 frames at 30fps = +0.1s
    handle.emit('seeked');
    await p;

    expect(handle.currentTime).toBeCloseTo(1.1);
  });
});
