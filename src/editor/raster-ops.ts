import { blendPixel } from '../raster/blend';
import { PixelBuffer } from '../raster/pixel-buffer';

/** Pure pixel transforms used by selection, layer and document operations. */

export function flipH(src: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(src.width, src.height);
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) out.set(src.width - 1 - x, y, src.get(x, y));
  return out;
}

export function flipV(src: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(src.width, src.height);
  const row = src.width * 4;
  for (let y = 0; y < src.height; y++) out.data.set(src.data.subarray(y * row, (y + 1) * row), (src.height - 1 - y) * row);
  return out;
}

/** Rotates clockwise by 90, 180 or 270 degrees. */
export function rotate(src: PixelBuffer, deg: 90 | 180 | 270): PixelBuffer {
  if (deg === 180) return flipV(flipH(src));
  const out = new PixelBuffer(src.height, src.width);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      const c = src.get(x, y);
      if (deg === 90) out.set(src.height - 1 - y, x, c);
      else out.set(y, src.width - 1 - x, c);
    }
  return out;
}

/** Composites `src` over `dst` at (dx, dy) in normal mode. Opaque pixels are copied exactly. */
export function drawOver(dst: PixelBuffer, src: PixelBuffer, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const si = (y * src.width + x) * 4;
      const a = src.data[si + 3]!;
      if (a === 0) continue;
      blendPixel(dst.data, (ty * dst.width + tx) * 4, src.data[si]!, src.data[si + 1]!, src.data[si + 2]!, a, 1, 'normal');
    }
  }
}

/** Moves content by (dx, dy); with `wrap` pixels leaving one edge enter the other. */
export function offset(src: PixelBuffer, dx: number, dy: number, wrap: boolean): PixelBuffer {
  const out = new PixelBuffer(src.width, src.height);
  const { width: w, height: h } = src;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let tx = x + dx;
      let ty = y + dy;
      if (wrap) {
        tx = ((tx % w) + w) % w;
        ty = ((ty % h) + h) % h;
      } else if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      out.set(tx, ty, src.get(x, y));
    }
  return out;
}

/** Inverts RGB, keeping alpha. */
export function invertColors(src: PixelBuffer, mask?: (x: number, y: number) => boolean): PixelBuffer {
  const out = src.clone();
  const d = out.data;
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++) {
      if (mask && !mask(x, y)) continue;
      const i = (y * src.width + x) * 4;
      if (d[i + 3] === 0) continue;
      d[i] = 255 - d[i]!;
      d[i + 1] = 255 - d[i + 1]!;
      d[i + 2] = 255 - d[i + 2]!;
    }
  return out;
}
