import { unzipSync, zipSync } from 'fflate';
import { buildJsonDoc, type JsonDoc } from '../lib/exports/json';
import { exportMarkdown } from '../lib/exports/markdown';
import { buildSrtString } from '../lib/exports/srt';
import type { ExportContext } from '../lib/exports/types';
import type { CapturedFrame } from '../lib/types';
import { persistFrame } from '../store/frames';
import type { FrameEntry, StudioStore } from '../store/studio';

/** One frame's zip-relative metadata -- everything `restoreFrames`-equivalent import logic needs
 * to recreate a `FrameRow`/`FrameEntry` from the PNG bytes stored at `file`. */
export type FrameManifestEntry = Pick<CapturedFrame, 'id' | 'time' | 'kind' | 'width' | 'height' | 'downloadedAs'> & { file: string };

export interface ProjectManifest extends JsonDoc {
  frames: FrameManifestEntry[];
}

/**
 * `project.json`'s schema: the Task 6 JSON export shape (`buildJsonDoc`) plus a `frames` manifest
 * -- the plan's own Key Decisions phrase this as "schema from Task 6 JSON export + tracks/clips/
 * thumbnail vtt"; `tracks`/`clips` already come from `buildJsonDoc`, and `frames` is the analogous
 * addition needed for the DoD's own "restores ... frames byte-identically" line (there is
 * otherwise no way to know which zip-relative PNG belongs to which frame, at what time, or what
 * kind). Kept as its own function (not folded into `buildJsonDoc`) so the Notes panel's plain JSON
 * export format is untouched by a schema this task alone needs.
 */
export function buildProjectManifest(ctx: ExportContext, frames: FrameManifestEntry[]): ProjectManifest {
  return { ...buildJsonDoc(ctx), frames };
}

/** Parses and validates a `project.json` document back into a `ProjectManifest`, rejecting
 * anything that isn't valid JSON or is missing a required array field -- `import_project` must
 * never partially apply a corrupt/foreign zip to the live store. */
export function parseProjectManifest(json: string): ProjectManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('invalid_project_json: not valid JSON');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Record<string, unknown>).notes) ||
    !Array.isArray((parsed as Record<string, unknown>).chapters) ||
    !Array.isArray((parsed as Record<string, unknown>).boxes) ||
    !Array.isArray((parsed as Record<string, unknown>).tracks) ||
    !Array.isArray((parsed as Record<string, unknown>).clips) ||
    !Array.isArray((parsed as Record<string, unknown>).frames)
  ) {
    throw new Error('invalid_project_json: missing a required field (notes/chapters/boxes/tracks/clips/frames)');
  }
  return parsed as ProjectManifest;
}

export interface ProjectFrameInput {
  id: string;
  time: number;
  kind: CapturedFrame['kind'];
  width: number;
  height: number;
  downloadedAs?: string;
  blob: Blob;
}

export interface BuildProjectZipInput {
  ctx: ExportContext;
  frames: ProjectFrameInput[];
}

/**
 * Builds the exportable zip: `project.json`, `notes.md`, `transcript.srt` (only when a transcript
 * exists), and `frames/<id>.png` per captured frame. Metadata-only (`fflate`'s synchronous
 * `zipSync`, matching the plan's own "for metadata-only" branch) -- bundling the source video
 * itself (`includeMedia`, a streaming `Zip` for files that can exceed what fits comfortably in
 * memory) is deferred: neither TS-007 step 4 nor this task's own DoD line ("restores notes,
 * chapters, boxes, clips, frames byte-identically") exercises it, and streaming multi-hundred-MB
 * video through `Zip`/`ZipPassThrough` correctly is a meaningfully larger, separately-verifiable
 * unit of work. SHORTCUT: `export_project`/`import_project` today only ever round-trip metadata;
 * upgrade trigger is a real request to move a whole project (video included) between profiles.
 */
export async function buildProjectZip(input: BuildProjectZipInput): Promise<Blob> {
  const encoder = new TextEncoder();
  const frameMetas: FrameManifestEntry[] = input.frames.map((f) => ({
    id: f.id,
    time: f.time,
    kind: f.kind,
    width: f.width,
    height: f.height,
    downloadedAs: f.downloadedAs,
    file: `frames/${f.id}.png`,
  }));

  const manifest = buildProjectManifest(input.ctx, frameMetas);
  const files: Record<string, Uint8Array> = {
    'project.json': encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
    'notes.md': encoder.encode(exportMarkdown(input.ctx)),
  };
  if (input.ctx.transcript && input.ctx.transcript.segments.length > 0) {
    files['transcript.srt'] = encoder.encode(buildSrtString(input.ctx.transcript.segments));
  }
  for (const frame of input.frames) {
    files[`frames/${frame.id}.png`] = new Uint8Array(await frame.blob.arrayBuffer());
  }

  return new Blob([zipSync(files)], { type: 'application/zip' });
}

export interface ParsedProjectZip {
  manifest: ProjectManifest;
  frameBlobs: Map<string, Blob>;
}

/** Reads an `export_project` zip back: validates `project.json` and pairs each manifest frame
 * entry with its actual PNG bytes (as a fresh `Blob`, ready for `persistFrame`/`URL.createObjectURL`
 * exactly like a freshly-captured frame). */
export async function parseProjectZip(blob: Blob): Promise<ParsedProjectZip> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const entries = unzipSync(bytes);

  const projectJsonBytes = entries['project.json'];
  if (!projectJsonBytes) throw new Error('invalid_project_zip: missing project.json');
  const manifest = parseProjectManifest(new TextDecoder().decode(projectJsonBytes));

  const frameBlobs = new Map<string, Blob>();
  for (const frame of manifest.frames) {
    const pngBytes = entries[frame.file];
    if (!pngBytes) throw new Error(`invalid_project_zip: missing frame file "${frame.file}"`);
    frameBlobs.set(frame.id, new Blob([pngBytes], { type: 'image/png' }));
  }

  return { manifest, frameBlobs };
}

/**
 * Applies a parsed project zip to the live store -- the other half of `export_project`'s round
 * trip, driven by the Library panel's "Import project" button (not a registered agent tool: the
 * plan's own Files list only names `export_project` for `agent/tools/exports.ts`, and a multi-MB
 * zip is an awkward fit for the JSON tool-call contract). Wholesale-replaces notes/chapters/boxes/
 * tracks/clips via the same bulk setters `store/projectPersistence.ts`'s boot restore uses (so "a
 * fresh profile", per this task's own DoD wording, ends up with exactly the imported project, not
 * a merge with whatever was already loaded) -- `wireProjectPersistence`'s subscriber, already armed
 * by main.tsx, then persists all five to Dexie automatically. Frames are the one slice that
 * subscriber doesn't cover (see its own doc comment), so each restored frame is `persistFrame`d
 * explicitly here, exactly as a fresh `capture_frame` call would.
 */
export async function applyImportedProject(store: StudioStore, parsed: ParsedProjectZip): Promise<void> {
  const { manifest, frameBlobs } = parsed;
  store.getState().setNotes(manifest.notes);
  store.getState().setChapters(manifest.chapters);
  store.getState().setBoxes(manifest.boxes);
  store.getState().setTracks(manifest.tracks);
  store.getState().setClips(manifest.clips);

  const frameEntries: FrameEntry[] = [];
  for (const meta of manifest.frames) {
    const blob = frameBlobs.get(meta.id);
    if (!blob) continue;
    await persistFrame({ id: meta.id, time: meta.time, kind: meta.kind, width: meta.width, height: meta.height, downloadedAs: meta.downloadedAs, blob });
    frameEntries.push({ id: meta.id, time: meta.time, kind: meta.kind, width: meta.width, height: meta.height, downloadedAs: meta.downloadedAs, blobUrl: URL.createObjectURL(blob) });
  }
  store.getState().setFrames(frameEntries);
}
