/**
 * Colors are straight (non-premultiplied) RGBA, 8 bits per channel.
 * Packed form is 0xRRGGBBAA stored as an unsigned 32-bit number, which keeps
 * comparisons cheap and independent of platform endianness.
 */
export type RGBA = number;

export const TRANSPARENT: RGBA = 0x00000000;

export function rgba(r: number, g: number, b: number, a = 255): RGBA {
  return (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
}

export function red(c: RGBA): number {
  return (c >>> 24) & 255;
}
export function green(c: RGBA): number {
  return (c >>> 16) & 255;
}
export function blue(c: RGBA): number {
  return (c >>> 8) & 255;
}
export function alpha(c: RGBA): number {
  return c & 255;
}

export function withAlpha(c: RGBA, a: number): RGBA {
  return ((c & 0xffffff00) | (a & 255)) >>> 0;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** #RRGGBB when opaque, #RRGGBBAA otherwise. */
export function toHex(c: RGBA, forceAlpha = false): string {
  const base = `#${hex2(red(c))}${hex2(green(c))}${hex2(blue(c))}`;
  return forceAlpha || alpha(c) !== 255 ? base + hex2(alpha(c)) : base;
}

/** Accepts #RGB, #RGBA, #RRGGBB and #RRGGBBAA (the # is optional). */
export function parseHex(input: string): RGBA | null {
  let s = input.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  if (s.length === 3 || s.length === 4) {
    s = s
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (s.length === 6) s += 'ff';
  if (s.length !== 8) return null;
  return parseInt(s, 16) >>> 0;
}

export function toCss(c: RGBA): string {
  return `rgba(${red(c)}, ${green(c)}, ${blue(c)}, ${(alpha(c) / 255).toFixed(3)})`;
}

export interface HSL {
  h: number; // 0..360
  s: number; // 0..100
  l: number; // 0..100
}

export function rgbToHsl(c: RGBA): HSL {
  const r = red(c) / 255;
  const g = green(c) / 255;
  const b = blue(c) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToRgb(hsl: HSL, a = 255): RGBA {
  const h = (((hsl.h % 360) + 360) % 360) / 360;
  const s = Math.min(100, Math.max(0, hsl.s)) / 100;
  const l = Math.min(100, Math.max(0, hsl.l)) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return rgba(v, v, v, a);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgba(
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
    a,
  );
}

export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

export function rgbToHsv(c: RGBA): HSV {
  const r = red(c) / 255;
  const g = green(c) / 255;
  const b = blue(c) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb(hsv: HSV, a = 255): RGBA {
  const h = (((hsv.h % 360) + 360) % 360) / 60;
  const s = Math.min(1, Math.max(0, hsv.s));
  const v = Math.min(1, Math.max(0, hsv.v));
  const c = v * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 1) [r, g, b] = [c, x, 0];
  else if (h < 2) [r, g, b] = [x, c, 0];
  else if (h < 3) [r, g, b] = [0, c, x];
  else if (h < 4) [r, g, b] = [0, x, c];
  else if (h < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgba(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), a);
}

/**
 * Euclidean distance in RGBA space normalised to 0..100, used by tolerance
 * based tools (bucket fill, magic wand). Fully transparent colors are treated
 * as equal to each other regardless of their RGB payload.
 */
export function colorDistance(a: RGBA, b: RGBA): number {
  if (alpha(a) === 0 && alpha(b) === 0) return 0;
  const dr = red(a) - red(b);
  const dg = green(a) - green(b);
  const db = blue(a) - blue(b);
  const da = alpha(a) - alpha(b);
  return (Math.sqrt(dr * dr + dg * dg + db * db + da * da) / 510) * 100;
}
