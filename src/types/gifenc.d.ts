/** gifenc ships no types (its own README examples are plain JS) -- a minimal, narrow shim
 * covering only the API surface media/gif.ts actually calls, rather than a bare
 * `declare module 'gifenc'` that would silently type everything as `any`. */
declare module 'gifenc' {
  export type GifencPalette = number[][];

  export interface QuantizeOptions {
    format?: 'rgb565' | 'rgb444' | 'rgba4444';
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  }

  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: QuantizeOptions): GifencPalette;

  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: GifencPalette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;

  export interface WriteFrameOptions {
    palette?: GifencPalette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    repeat?: number;
    dispose?: number;
  }

  export interface GifEncoderStream {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    writeHeader(): void;
    reset(): void;
    buffer: ArrayBuffer;
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoderStream;
}
