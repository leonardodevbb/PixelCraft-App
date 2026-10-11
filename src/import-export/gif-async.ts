import { encodeGif, GifError, type GifEncodeOptions, type GifEncodeReport, type GifFrameIn } from './gif';

/**
 * Encodes a GIF in a Web Worker so long exports do not freeze the editor.
 * Falls back to the main thread where workers are unavailable (tests).
 * Frame pixel buffers are copied, so the caller's images stay intact.
 */
export function encodeGifAsync(frames: GifFrameIn[], options: GifEncodeOptions, signal?: AbortSignal): Promise<GifEncodeReport> {
  if (typeof Worker === 'undefined') return Promise.resolve().then(() => encodeGif(frames, options));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
    const done = (): void => worker.terminate();
    signal?.addEventListener('abort', () => {
      done();
      reject(new DOMException('Cancelado', 'AbortError'));
    });
    worker.onmessage = (e: MessageEvent<{ ok: true; report: GifEncodeReport } | { ok: false; error: string }>) => {
      done();
      if (e.data.ok) resolve(e.data.report);
      else reject(new GifError(e.data.error));
    };
    worker.onerror = (e) => {
      done();
      reject(new GifError(e.message || 'Falha no codificador de GIF.'));
    };
    const payload = frames.map((f) => {
      const data = f.image.data.slice().buffer;
      return { width: f.image.width, height: f.image.height, data, delayMs: f.delayMs };
    });
    worker.postMessage({ frames: payload, options }, payload.map((p) => p.data));
  });
}
