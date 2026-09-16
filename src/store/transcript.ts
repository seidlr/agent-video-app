import { db } from './db';
import type { TranscriptSegment } from '../lib/types';

/** Keys a transcript row by asset + language, same convention as the (still-unbuilt) Task 13
 * `translate_transcript` needs to store multiple languages per asset alongside the original --
 * `lang: null` means "the original, untranslated transcript". */
function rowId(assetId: string, lang: string | null): string {
  return `${assetId}:${lang ?? 'original'}`;
}

export async function persistTranscript(assetId: string, lang: string | null, segments: TranscriptSegment[]): Promise<void> {
  await db.transcripts.put({ id: rowId(assetId, lang), assetId, lang, segments });
}

export async function getPersistedTranscript(assetId: string, lang: string | null = null): Promise<TranscriptSegment[] | null> {
  const row = await db.transcripts.get(rowId(assetId, lang));
  return row ? row.segments : null;
}

/** Every non-original language `translate_transcript` has produced for this asset so far -- the
 * Transcript panel's own language switch (Task 13) uses this to populate its dropdown without
 * tracking a separate "known languages" list anywhere else. */
export async function listTranslatedLangs(assetId: string): Promise<string[]> {
  const rows = await db.transcripts.where('assetId').equals(assetId).toArray();
  return rows.map((r) => r.lang).filter((lang): lang is string => lang !== null);
}
