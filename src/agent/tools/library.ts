import type { AssetKind } from '../../lib/types';
import { DEFAULT_PROJECT_ID } from '../../lib/types';
import { loadSource } from '../../media/load';
import { defaultSourceDeps } from '../../media/source';
import { listLibraryAssets, readLibraryFile, removeLibraryAsset } from '../../store/library';
import type { StudioStore } from '../../store/studio';
import type { Registry, ToolResult } from '../registry';

/** Agent-facing source names (`library`) intentionally differ from the internal AssetKind
 * (`file`) -- `library` reads better as "a video already in your library" from an agent's
 * perspective than the storage-layer term `file`. */
const SOURCE_TO_KIND: Record<string, AssetKind> = { sample: 'sample', library: 'file', url: 'url', youtube: 'youtube' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** library tools: list_library, load_video, request_file_upload, remove_video. All `always`. */
export function defineLibraryTools(registry: Registry, store: StudioStore): void {
  registry.define({
    name: 'list_library',
    description: 'Lists the sample catalog and every video stored locally in this browser.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    group: 'library',
    when: 'always',
    handler: async (): Promise<ToolResult> => {
      const deps = defaultSourceDeps(readLibraryFile);
      const [{ samples }, library] = await Promise.all([deps.fetchSamples(), listLibraryAssets(DEFAULT_PROJECT_ID)]);
      return {
        ok: true,
        summary: `${samples.length} sample(s), ${library.length} stored video(s)`,
        samples: samples.map((s) => ({ id: s.id, title: s.title, duration: s.duration, width: s.width, height: s.height })),
        library: library.map((a) => ({ id: a.id, name: a.name, kind: a.kind, duration: a.duration, bytes: a.bytes })),
      };
    },
  });

  registry.define<{ source: string; id?: string; url?: string }>({
    name: 'load_video',
    description: 'Loads a video into the player: a sample by id, a video already in your library by id, a CORS-enabled URL, or a YouTube link.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['sample', 'library', 'url', 'youtube'] },
        id: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['source'],
    },
    group: 'library',
    when: 'always',
    handler: async (args): Promise<ToolResult> => {
      const kind = SOURCE_TO_KIND[args.source];
      if (!kind) return { ok: false, error: 'invalid_source', hint: 'source must be one of sample|library|url|youtube' };
      try {
        await loadSource(store.getState(), { kind, id: args.id, url: args.url });
        const source = store.getState().source;
        return { ok: true, summary: `Loaded "${source?.title}"`, source: source ? { kind: source.kind, title: source.title } : null };
      } catch (error) {
        return { ok: false, error: `load_failed: ${errorMessage(error)}`, hint: 'Check the id/url and try again.' };
      }
    },
  });

  registry.define({
    name: 'request_file_upload',
    description: 'Switches to the Library panel and focuses the local-file input, so an agent with a file-upload capability (or the human) can attach a video.',
    inputSchema: { type: 'object', properties: {} },
    group: 'library',
    when: 'always',
    handler: (): ToolResult => {
      store.getState().setView('library');
      if (typeof document !== 'undefined' && typeof requestAnimationFrame === 'function') {
        // The #video-file input only exists once the Library panel has actually rendered.
        requestAnimationFrame(() => {
          document.getElementById('video-file')?.focus();
        });
      }
      return {
        ok: true,
        summary: 'Waiting for a file on input#video-file …',
        hint: 'Agents with a file-upload tool can target the file input with id "video-file".',
      };
    },
  });

  registry.define<{ id: string }>({
    name: 'remove_video',
    description: 'Deletes a stored video from the library (its bytes and metadata).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { consequentialHint: true },
    group: 'library',
    when: 'always',
    handler: async (args): Promise<ToolResult> => {
      await removeLibraryAsset(args.id);
      return { ok: true, summary: `Removed video ${args.id}` };
    },
  });
}
