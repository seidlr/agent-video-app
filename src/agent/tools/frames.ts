import { isBoxVisibleAt } from '../../lib/boxVisibility';
import { parseTime, secsToTimecode } from '../../lib/time';
import { getVideoElement } from '../../lib/videoElement';
import { captureCurrentFrame, captureFilename, type CaptureFormat } from '../../media/capture';
import { getActiveTabCapture } from '../../media/tabCapture';
import { generateThumbnailSprite } from '../../media/thumbnails';
import { deletePersistedFrame, persistFrame, persistThumbnails } from '../../store/frames';
import { tryPersist } from '../../store/persist';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

/** `<a download>` click, no picker (Global Constraints / plan Key Decisions) -- lets a desktop
 * agent with file-system access find the frame in the user's Downloads folder afterward. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function defineFramesTools(registry: Registry, store: StudioStore): void {
  registry.define<{
    time?: string | number;
    format?: CaptureFormat;
    maxWidth?: number;
    includeOverlays?: boolean;
    download?: boolean;
    includeDataUrl?: boolean;
    name?: string;
    stay?: boolean;
  }>({
    name: 'capture_frame',
    description:
      'Captures the exact currently-displayed video frame as an image. Shows it in the Frames tray, and optionally downloads it or returns it as a data URL for a host with no file access.',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: ['string', 'number'] },
        format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
        maxWidth: { type: 'number', minimum: 1 },
        includeOverlays: { type: 'boolean' },
        download: { type: 'boolean' },
        includeDataUrl: { type: 'boolean' },
        name: { type: 'string' },
        stay: { type: 'boolean' },
      },
    },
    group: 'frames',
    // 'yt' rather than 'local': currentLocalWhens (webmcp.ts) registers 'yt'-tagged tools for
    // BOTH a local source and a YouTube one, which is exactly what this tool needs -- TS-003 step
    // 4 calls it on a YouTube source expecting a real (registered) tool that reports
    // youtube_pixels_unavailable, not a missing tool. A plain 'local' tag would only register it
    // for local sources, same as generate_thumbnails intentionally stays.
    when: 'yt',
    handler: async (args): Promise<ToolResult> => {
      const state = store.getState();
      if (!state.source) return { ok: false, error: 'no_video_loaded' };

      // A YouTube iframe's pixels are cross-origin and unreachable directly, but once the
      // TabCaptureButton has armed a getDisplayMedia() session (a user gesture is required, so a
      // tool call alone can never start one), its <video> is a real, readable capture of
      // whatever tab was picked -- typically this same page -- and works exactly like a local
      // video element here.
      const video = state.source.kind === 'youtube' ? (getActiveTabCapture()?.video ?? null) : getVideoElement();
      if (state.source.kind === 'youtube' && !video) {
        return {
          ok: false,
          error: 'youtube_pixels_unavailable',
          hint: 'No direct pixel access to a YouTube iframe. Use the tab-capture button in the player chrome to enable it for this video.',
        };
      }
      if (!video) return { ok: false, error: 'video_not_ready' };

      let previousTime: number | undefined;
      if (args.time !== undefined) {
        const target = parseTime(args.time, { currentTime: state.player.currentTime, duration: state.player.duration, fps: state.player.fps });
        if (target === null) {
          return { ok: false, error: 'invalid_time', hint: 'Use seconds, a timecode, "+N"/"-N", "N%", or "fN".' };
        }
        previousTime = state.player.currentTime;
        await state.seek(target);
      }

      // video.currentTime (the real DOM element), not store.getState().player.currentTime: the
      // store's copy only updates via the native `timeupdate` event (VideoStage.tsx), which does
      // not reliably fire in lockstep with a programmatic seek -- especially the very first seek
      // on a video that has never played, where `seeked` fires but no `timeupdate` follows in
      // time (confirmed empirically: capturedAt read immediately after `await state.seek(2.0)`
      // came back 0, producing the wrong filename). video.currentTime is always correct there: it
      // is the literal property `seeked` reports on, with no separate event-driven mirror to lag
      // behind. The one exception is the YouTube tab-capture path: `video` there is a
      // getDisplayMedia() screen-recording stream, whose `.currentTime` tracks elapsed capture
      // time, not the YouTube player's playhead -- state.seek() drives the actual YouTube
      // provider, so the store's own (separately synced) currentTime is the correct read there.
      const capturedAt = state.source.kind === 'youtube' ? store.getState().player.currentTime : video.currentTime;
      const format = args.format ?? 'png';
      const visibleBoxes = args.includeOverlays ? store.getState().boxes.filter((b) => isBoxVisibleAt(b, capturedAt)) : undefined;
      const result = await captureCurrentFrame(video, { maxWidth: args.maxWidth, format, boxes: visibleBoxes });

      if (previousTime !== undefined && !args.stay) {
        await store.getState().seek(previousTime);
      }

      if ('error' in result) {
        return {
          ok: false,
          error: result.error,
          hint: result.error === 'source_not_capturable' ? 'Load a CORS-enabled URL or a local file instead.' : undefined,
        };
      }

      const filename = captureFilename(capturedAt, args.name, format);

      let downloadedAs: string | undefined;
      if (args.download) {
        triggerDownload(result.blob, filename);
        downloadedAs = filename;
      }

      const blobUrl = URL.createObjectURL(result.blob);
      const frameId = store.getState().addFrame({ time: capturedAt, kind: 'frame', width: result.width, height: result.height, downloadedAs, blobUrl });
      await tryPersist(store.getState(), () => persistFrame({ id: frameId, time: capturedAt, kind: 'frame', width: result.width, height: result.height, blob: result.blob, downloadedAs }));

      const dataUrl = args.includeDataUrl ? await blobToDataUrl(result.blob) : undefined;

      return {
        ok: true,
        summary: `Captured frame at ${secsToTimecode(capturedAt)} (${result.width}x${result.height})${downloadedAs ? `, saved to Downloads as ${downloadedAs}` : ''}`,
        frameId,
        width: result.width,
        height: result.height,
        downloadedAs,
        dataUrl,
      };
    },
  });

  registry.define({
    name: 'list_frames',
    description: 'Lists every frame captured this session (the Frames tray).',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    group: 'frames',
    when: 'always',
    handler: (): ToolResult => {
      const frames = store.getState().frames;
      return {
        ok: true,
        summary: `${frames.length} frame(s)`,
        frames: frames.map((f) => ({ id: f.id, time: f.time, kind: f.kind, width: f.width, height: f.height, downloadedAs: f.downloadedAs })),
      };
    },
  });

  registry.define<{ frameId?: string }>({
    name: 'delete_frame',
    description: 'Removes a captured frame from the Frames tray.',
    inputSchema: { type: 'object', properties: { frameId: { type: 'string' } } },
    group: 'frames',
    when: 'always',
    handler: async (args): Promise<ToolResult> => {
      const { frameId } = args;
      if (!frameId) return { ok: false, error: 'missing_frame_id' };
      const exists = store.getState().frames.some((f) => f.id === frameId);
      if (!exists) return { ok: false, error: 'unknown_frame', hint: `no frame with id "${frameId}"` };
      store.getState().removeFrame(frameId);
      await deletePersistedFrame(frameId);
      return { ok: true, summary: `Removed frame ${frameId}` };
    },
  });

  registry.define<{ count?: number; intervalSeconds?: number; width?: number; contactSheet?: boolean }>({
    name: 'generate_thumbnails',
    description:
      'Generates a thumbnail sprite for the loaded video and wires it into the timeline hover preview. Give either count (evenly spread) or intervalSeconds (fixed spacing).',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1 },
        intervalSeconds: { type: 'number', minimum: 0.1 },
        contactSheet: { type: 'boolean' },
      },
    },
    group: 'frames',
    when: 'local',
    mode: 'job',
    handler: async (args): Promise<ToolResult> => {
      const source = store.getState().source;
      if (!source) return { ok: false, error: 'no_video_loaded' };
      if (source.kind === 'youtube') {
        return {
          ok: true,
          summary: 'YouTube has no direct pixel access; using the 4 free ytimg stills already shown in the filmstrip instead of generating a sprite.',
          timestamps: [],
        };
      }

      const sprite = await generateThumbnailSprite(source, { count: args.count, intervalSeconds: args.intervalSeconds });
      const vttUrl = URL.createObjectURL(new Blob([sprite.vtt], { type: 'text/vtt' }));
      store.getState().setSourceThumbnailsVtt(vttUrl);
      // A separate object URL from the contact-sheet frame's below (rather than sharing one):
      // delete_frame revokes a frame's own blobUrl on removal, and this one backs the persistent
      // Filmstrip strip -- sharing it would break the strip the moment the contact-sheet frame is
      // deleted from the tray.
      store.getState().setSourceThumbnailsSprite(URL.createObjectURL(sprite.spriteBlob), sprite.timestamps);

      if (source.assetId) {
        await tryPersist(store.getState(), () => persistThumbnails(source.assetId!, sprite.spriteBlob, sprite.vtt));
      }

      let contactSheetFrameId: string | undefined;
      if (args.contactSheet) {
        const blobUrl = URL.createObjectURL(sprite.spriteBlob);
        const bitmap = await createImageBitmap(sprite.spriteBlob);
        contactSheetFrameId = store.getState().addFrame({ time: 0, kind: 'contact-sheet', width: bitmap.width, height: bitmap.height, blobUrl });
        bitmap.close();
        await tryPersist(store.getState(), () =>
          persistFrame({
            id: contactSheetFrameId!,
            time: 0,
            kind: 'contact-sheet',
            width: sprite.tileWidth * Math.min(10, sprite.timestamps.length),
            height: sprite.tileHeight * Math.ceil(sprite.timestamps.length / 10),
            blob: sprite.spriteBlob,
          }),
        );
      }

      return {
        ok: true,
        summary: `Generated ${sprite.timestamps.length} thumbnail(s)`,
        timestamps: sprite.timestamps,
        contactSheetFrameId,
      };
    },
  });
}
