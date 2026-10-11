import { useEffect, useRef } from 'react';
import type { PixelBuffer } from '../../raster/pixel-buffer';

/**
 * Shows a pixel buffer scaled to fit a box (integer scale when possible,
 * never smoothed), over a checkerboard.
 */
export function BufferView({ buffer, max = 160, label, testId }: { buffer: PixelBuffer | null; max?: number; label: string; testId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !buffer) return;
    c.width = buffer.width;
    c.height = buffer.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(buffer.data), buffer.width, buffer.height), 0, 0);
  }, [buffer]);
  if (!buffer) return null;
  const fit = Math.min(max / buffer.width, max / buffer.height);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  return (
    <div className="buffer-view checker" style={{ width: Math.max(1, Math.round(buffer.width * scale)), height: Math.max(1, Math.round(buffer.height * scale)) }}>
      <canvas ref={ref} className="pixelated" role="img" aria-label={label} data-testid={testId} />
    </div>
  );
}
