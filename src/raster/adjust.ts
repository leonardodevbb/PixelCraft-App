import { alpha, hslToRgb, rgbToHsl, rgba, withAlpha, type RGBA } from './color';
import type { PixelBuffer } from './pixel-buffer';

/**
 * Colour adjustments and pixel filters. Each one returns a new buffer and
 * only touches pixels where `mask` (the selection) allows; fully transparent
 * pixels are left alone except by the outline, which adds pixels.
 */

export type Mask = ((x: number, y: number) => boolean) | undefined;

function mapPixels(img: PixelBuffer, mask: Mask, fn: (c: RGBA) => RGBA): PixelBuffer {
  const out = img.clone();
  const cache = new Map<RGBA, RGBA>();
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (mask && !mask(x, y)) continue;
      const c = img.get(x, y);
      if (alpha(c) === 0) continue;
      let n = cache.get(c);
      if (n === undefined) cache.set(c, (n = fn(c)));
      if (n !== c) out.set(x, y, n);
    }
  return out;
}

export interface HueSaturation {
  /** -180..180 degrees. */
  hue: number;
  /** -100..100 percent. */
  saturation: number;
  /** -100..100 percent. */
  lightness: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Shifts hue and scales saturation/lightness in HSL, like a paint program's "Hue/Saturation". */
export function hueSaturation(img: PixelBuffer, o: HueSaturation, mask?: Mask): PixelBuffer {
  if (!o.hue && !o.saturation && !o.lightness) return img.clone();
  return mapPixels(img, mask, (c) => {
    const hsl = rgbToHsl(c);
    const h = (((hsl.h + o.hue) % 360) + 360) % 360;
    const s = o.saturation >= 0 ? hsl.s + (100 - hsl.s) * (o.saturation / 100) : hsl.s * (1 + o.saturation / 100);
    const l = o.lightness >= 0 ? hsl.l + (100 - hsl.l) * (o.lightness / 100) : hsl.l * (1 + o.lightness / 100);
    return hslToRgb({ h, s: clamp(s, 0, 100), l: clamp(l, 0, 100) }, alpha(c));
  });
}

export interface BrightnessContrast {
  /** -100..100. */
  brightness: number;
  /** -100..100. */
  contrast: number;
}

export function brightnessContrast(img: PixelBuffer, o: BrightnessContrast, mask?: Mask): PixelBuffer {
  const k = o.contrast >= 0 ? 1 / Math.max(0.01, 1 - o.contrast / 100) : 1 + o.contrast / 100;
  const b = (o.brightness / 100) * 255;
  const f = (v: number): number => clamp(Math.round((v - 128) * k + 128 + b), 0, 255);
  return mapPixels(img, mask, (c) => rgba(f(c >>> 24), f((c >>> 16) & 255), f((c >>> 8) & 255), alpha(c)));
}

export interface OutlineOptions {
  color: RGBA;
  /** 'circle' uses the 4 orthogonal neighbours, 'square' all 8. */
  shape: 'circle' | 'square';
  /** Outside draws around the shape; inside replaces its border pixels. */
  place: 'outside' | 'inside';
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const N8 = [...N4, [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Draws a one-pixel outline around (or inside) the opaque shapes. */
export function outline(img: PixelBuffer, o: OutlineOptions, mask?: Mask): PixelBuffer {
  const out = img.clone();
  const near = o.shape === 'square' ? N8 : N4;
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < img.width && y < img.height && alpha(img.get(x, y)) > 0;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (mask && !mask(x, y)) continue;
      const here = solid(x, y);
      if (o.place === 'outside' ? here : !here) continue;
      const edge = near.some(([dx, dy]) => solid(x + dx!, y + dy!) !== here);
      if (edge) out.set(x, y, o.color);
    }
  return out;
}

/**
 * Median filter (3×3): removes isolated stray pixels ("speckles") while
 * keeping edges. The median is taken per channel over the neighbourhood.
 */
export function despeckle(img: PixelBuffer, mask?: Mask): PixelBuffer {
  const out = img.clone();
  const ch: number[][] = [[], [], [], []];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      if (mask && !mask(x, y)) continue;
      for (const c of ch) c.length = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const px = clamp(x + dx, 0, img.width - 1);
          const py = clamp(y + dy, 0, img.height - 1);
          const c = img.get(px, py);
          ch[0]!.push(c >>> 24);
          ch[1]!.push((c >>> 16) & 255);
          ch[2]!.push((c >>> 8) & 255);
          ch[3]!.push(c & 255);
        }
      const med = ch.map((c) => c.sort((a, b) => a - b)[4]!);
      const n = med[3] === 0 ? 0 : rgba(med[0]!, med[1]!, med[2]!, med[3]!);
      if (n !== img.get(x, y)) out.set(x, y, n);
    }
  return out;
}

/** Converts to grayscale using perceived luminance. */
export function grayscale(img: PixelBuffer, mask?: Mask): PixelBuffer {
  return mapPixels(img, mask, (c) => {
    const l = Math.round(0.299 * (c >>> 24) + 0.587 * ((c >>> 16) & 255) + 0.114 * ((c >>> 8) & 255));
    return withAlpha(rgba(l, l, l), alpha(c));
  });
}
