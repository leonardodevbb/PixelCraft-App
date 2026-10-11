import { type RGBA, TRANSPARENT } from './color';
import { type Rect, intersectRect, rectIsEmpty } from './rect';

/**
 * A rectangular grid of straight-alpha RGBA pixels. This is the only pixel
 * storage used by documents; it never goes through a canvas, so values are
 * never premultiplied or color-managed behind the user's back.
 */
export class PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number, data?: Uint8ClampedArray) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) {
      throw new RangeError(`Dimensões inválidas: ${width}x${height}`);
    }
    this.width = width;
    this.height = height;
    if (data) {
      if (data.length !== width * height * 4) {
        throw new RangeError('Tamanho dos dados não corresponde às dimensões');
      }
      this.data = data;
    } else {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  }

  static fromRGBA(width: number, height: number, bytes: ArrayLike<number>): PixelBuffer {
    const buf = new PixelBuffer(width, height);
    buf.data.set(bytes);
    return buf;
  }

  get bounds(): Rect {
    return { x: 0, y: 0, w: this.width, h: this.height };
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): RGBA {
    if (!this.inBounds(x, y)) return TRANSPARENT;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    return ((d[i]! << 24) | (d[i + 1]! << 16) | (d[i + 2]! << 8) | d[i + 3]!) >>> 0;
  }

  set(x: number, y: number, c: RGBA): void {
    if (!this.inBounds(x, y)) return;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    d[i] = c >>> 24;
    d[i + 1] = (c >>> 16) & 255;
    d[i + 2] = (c >>> 8) & 255;
    d[i + 3] = c & 255;
  }

  fill(c: RGBA): void {
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) this.set(x, y, c);
  }

  clone(): PixelBuffer {
    return new PixelBuffer(this.width, this.height, new Uint8ClampedArray(this.data));
  }

  /** True when every pixel has alpha 0. */
  isEmpty(): boolean {
    const d = this.data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  }

  equals(other: PixelBuffer): boolean {
    if (other.width !== this.width || other.height !== this.height) return false;
    const a = this.data;
    const b = other.data;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /** Copies a region out into a new buffer. Out-of-bounds areas are transparent. */
  extract(r: Rect): PixelBuffer {
    const out = new PixelBuffer(r.w, r.h);
    const clip = intersectRect(r, this.bounds);
    if (rectIsEmpty(clip)) return out;
    for (let y = clip.y; y < clip.y + clip.h; y++) {
      const src = (y * this.width + clip.x) * 4;
      const dst = ((y - r.y) * r.w + (clip.x - r.x)) * 4;
      out.data.set(this.data.subarray(src, src + clip.w * 4), dst);
    }
    return out;
  }

  /** Writes `src` with its top-left at (dx, dy), replacing pixels (no blending). */
  paste(src: PixelBuffer, dx: number, dy: number): void {
    const target = intersectRect({ x: dx, y: dy, w: src.width, h: src.height }, this.bounds);
    if (rectIsEmpty(target)) return;
    for (let y = target.y; y < target.y + target.h; y++) {
      const s = ((y - dy) * src.width + (target.x - dx)) * 4;
      const d = (y * this.width + target.x) * 4;
      this.data.set(src.data.subarray(s, s + target.w * 4), d);
    }
  }

  /** Smallest rectangle containing every pixel that differs between two equal-sized buffers. */
  diffBounds(other: PixelBuffer): Rect | null {
    if (other.width !== this.width || other.height !== this.height) return this.bounds;
    const a = new Uint32Array(this.data.buffer, this.data.byteOffset, this.width * this.height);
    const b = new Uint32Array(other.data.buffer, other.data.byteOffset, other.width * other.height);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    const w = this.width;
    for (let y = 0; y < this.height; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (a[row + x] !== b[row + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** Bounding box of non-transparent pixels, or null when empty. */
  contentBounds(): Rect | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    const d = this.data;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (d[(y * this.width + x) * 4 + 3] !== 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
      }
    }
    if (x1 < 0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}
