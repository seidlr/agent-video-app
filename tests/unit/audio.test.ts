import { describe, expect, it } from 'vitest';
import { wavDataToFloat32 } from '../../src/media/audio';

/** Builds a minimal RIFF/WAVE buffer by hand: RIFF header, a "fmt " chunk, an extra odd-sized
 * "LIST" chunk (metadata, word-padded) BEFORE "data" -- proving wavDataToFloat32 actually walks
 * the chunk list rather than assuming a fixed 44-byte header. */
function buildWav(samples: number[], options: { withListChunk?: boolean } = {}): ArrayBuffer {
  const fmtChunk = new Uint8Array(16); // contents irrelevant to the parser under test
  const listPayload = new Uint8Array([1, 2, 3]); // odd size -> exercises the word-padding branch
  const dataPayload = new Float32Array(samples);

  const chunks: { id: string; payload: Uint8Array }[] = [{ id: 'fmt ', payload: fmtChunk }];
  if (options.withListChunk) chunks.push({ id: 'LIST', payload: listPayload });
  chunks.push({ id: 'data', payload: new Uint8Array(dataPayload.buffer) });

  let bodySize = 4; // "WAVE"
  for (const c of chunks) bodySize += 8 + c.payload.length + (c.payload.length % 2);

  const buffer = new ArrayBuffer(8 + bodySize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, bodySize, true);
  writeAscii(8, 'WAVE');

  let offset = 12;
  for (const c of chunks) {
    writeAscii(offset, c.id);
    view.setUint32(offset + 4, c.payload.length, true);
    bytes.set(c.payload, offset + 8);
    offset += 8 + c.payload.length + (c.payload.length % 2);
  }

  return buffer;
}

describe('wavDataToFloat32', () => {
  it('reads PCM samples straight from a minimal 44-byte-header WAV', () => {
    const samples = wavDataToFloat32(buildWav([0.5, -0.25, 1, -1]));
    expect(Array.from(samples)).toEqual([0.5, -0.25, 1, -1]);
  });

  it('walks past a metadata chunk before "data" rather than assuming a fixed header size', () => {
    // Exact binary fractions (unlike 0.1/0.2/0.3) round-trip losslessly through Float32, so a
    // plain toEqual isn't just tolerating float32 rounding error.
    const samples = wavDataToFloat32(buildWav([0.125, 0.25, -0.5], { withListChunk: true }));
    expect(Array.from(samples)).toEqual([0.125, 0.25, -0.5]);
  });

  it('throws a clear error for a non-WAV buffer', () => {
    expect(() => wavDataToFloat32(new ArrayBuffer(16))).toThrow(/invalid_wav/);
  });
});
