/// <reference lib="webworker" />
import { PixelBuffer } from '../raster/pixel-buffer';
import { encodeGif, type GifEncodeOptions } from './gif';

export interface GifWorkerRequest {
  frames: { width: number; height: number; data: ArrayBuffer; delayMs: number }[];
  options: GifEncodeOptions;
}

/** Encodes a GIF off the UI thread; the result bytes are transferred back. */
self.onmessage = (e: MessageEvent<GifWorkerRequest>) => {
  try {
    const frames = e.data.frames.map((f) => ({ image: new PixelBuffer(f.width, f.height, new Uint8ClampedArray(f.data)), delayMs: f.delayMs }));
    const report = encodeGif(frames, e.data.options);
    (self as unknown as Worker).postMessage({ ok: true, report }, [report.bytes.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
