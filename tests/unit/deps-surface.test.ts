import { describe, expect, it } from 'vitest';
import * as mediabunny from 'mediabunny';

/**
 * Every dependency in this repo is pinned exact (.npmrc save-exact=true) specifically so a
 * deliberate upgrade is a reviewed commit, not a silent drift. This test is the fail-fast half
 * of that contract for mediabunny: if a future pin change renames or removes an export this
 * codebase relies on across Tasks 3/5/8/9, this test fails immediately instead of surfacing as
 * a runtime error deep in a worker.
 */
const REQUIRED_EXPORTS = [
  'Input',
  'ALL_FORMATS',
  'BlobSource',
  'UrlSource',
  'CanvasSink',
  'VideoSampleSink',
  'EncodedPacketSink',
  'Conversion',
  'Output',
  'Mp4OutputFormat',
  'WebMOutputFormat',
  'WavOutputFormat',
  'BufferTarget',
  'getFirstEncodableVideoCodec',
] as const;

describe('mediabunny export surface', () => {
  it.each(REQUIRED_EXPORTS)('exports %s', (name) => {
    expect((mediabunny as Record<string, unknown>)[name]).toBeDefined();
  });
});
