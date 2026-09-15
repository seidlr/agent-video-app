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
