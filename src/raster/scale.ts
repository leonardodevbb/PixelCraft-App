import { PixelBuffer } from './pixel-buffer';

/** Integer nearest-neighbour upscale: every pixel becomes a factor×factor block. */
export function scaleInteger(src: PixelBuffer, factor: number): PixelBuffer {
  const f = Math.floor(factor);
  if (f < 1) throw new RangeError('A escala deve ser um inteiro ≥ 1.');
  if (f === 1) return src.clone();
  const out = new PixelBuffer(src.width * f, src.height * f);
  const s = new Uint32Array(src.data.buffer, src.data.byteOffset, src.width * src.height);
  const d = new Uint32Array(out.data.buffer, out.data.byteOffset, out.width * out.height);
  for (let y = 0; y < out.height; y++) {
    const sy = Math.floor(y / f);
    const srow = sy * src.width;
    const drow = y * out.width;
    for (let x = 0; x < out.width; x++) d[drow + x] = s[srow + Math.floor(x / f)]!;
  }
  return out;
}

/** Nearest-neighbour resample to arbitrary dimensions. */
export function resizeNearest(src: PixelBuffer, width: number, height: number): PixelBuffer {
  const out = new PixelBuffer(width, height);
  const s = new Uint32Array(src.data.buffer, src.data.byteOffset, src.width * src.height);
  const d = new Uint32Array(out.data.buffer, out.data.byteOffset, width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor(((y + 0.5) * src.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor(((x + 0.5) * src.width) / width));
      d[y * width + x] = s[sy * src.width + sx]!;
    }
  }
  return out;
}

/** Bilinear resample (only offered for reference images, never forced on sprites). */
export function resizeBilinear(src: PixelBuffer, width: number, height: number): PixelBuffer {
  const out = new PixelBuffer(width, height);
  const sd = src.data;
  const dd = out.data;
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, ((y + 0.5) * src.height) / height - 0.5);
    const y0 = Math.min(src.height - 1, Math.floor(fy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, ((x + 0.5) * src.width) / width - 0.5);
      const x0 = Math.min(src.width - 1, Math.floor(fx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const tx = fx - x0;
      const o = (y * width + x) * 4;
      // Interpolate premultiplied values so transparent pixels don't bleed color.
      const idx = [(y0 * src.width + x0) * 4, (y0 * src.width + x1) * 4, (y1 * src.width + x0) * 4, (y1 * src.width + x1) * 4];
      const wts = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 4; k++) {
        const i = idx[k]!;
        const w = wts[k]!;
        const al = sd[i + 3]! / 255;
        a += al * w;
        r += sd[i]! * al * w;
        g += sd[i + 1]! * al * w;
        b += sd[i + 2]! * al * w;
      }
      dd[o + 3] = Math.round(a * 255);
      if (a > 0) {
        dd[o] = Math.round(r / a);
        dd[o + 1] = Math.round(g / a);
        dd[o + 2] = Math.round(b / a);
      }
    }
  }
  return out;
}
