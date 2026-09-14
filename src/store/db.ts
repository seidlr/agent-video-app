import Dexie, { type Table } from 'dexie';
import type { Asset, AssetKind, Box, Chapter, Clip, Note, Track, TranscriptSegment } from '../lib/types';

export interface ProjectRow {
  id: string;
  name: string;
  theme: 'light' | 'dark' | 'system';
  /** The last source loaded (any kind), so a full page reload can restore it without the user
   * re-selecting it from the Library -- see src/store/library.ts save/getLastSource and Task 3's
   * DoD ("A dropped 50 MB file appears in the Library and plays after a full page reload without
   * re-selecting it"). */
  lastSource?: { kind: AssetKind; id?: string; url?: string };
  createdAt: number;
  updatedAt: number;
}

export interface FrameRow {
  id: string;
  projectId: string;
  time: number;
  kind: 'frame' | 'depth' | 'contact-sheet';
  width: number;
  height: number;
  blob: Blob;
  downloadedAs?: string;
  createdAt: number;
}

export interface ThumbnailRow {
  id: string;
  assetId: string;
  spriteBlob: Blob;
  vtt: string;
}

export interface HashRow {
  id: string;
  assetId: string;
  time: number;
  dhash: string;
  hist: number[];
}

export class StudioDB extends Dexie {
  projects!: Table<ProjectRow, string>;
  assets!: Table<Asset, string>;
  frames!: Table<FrameRow, string>;
  boxes!: Table<Box, string>;
  tracks!: Table<Track, string>;
  notes!: Table<Note, string>;
  chapters!: Table<Chapter, string>;
  transcripts!: Table<{ id: string; assetId: string; lang: string | null; segments: TranscriptSegment[] }, string>;
  clips!: Table<Clip, string>;
  thumbnails!: Table<ThumbnailRow, string>;
  hashes!: Table<HashRow, string>;

  constructor(name = 'agent-video-studio') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      assets: 'id, projectId, kind, createdAt',
      frames: 'id, projectId, time',
      boxes: 'id, time',
      tracks: 'id',
      notes: 'id, time',
      chapters: 'id, start',
      transcripts: 'id, assetId',
      clips: 'id, order',
      thumbnails: 'id, assetId',
      hashes: 'id, assetId, time',
    });
  }
}

export const db = new StudioDB();
