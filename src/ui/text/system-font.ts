import type { TextMask } from '../../raster/bitmap-font';

/**
 * Text in system or user-loaded fonts (TTF/OTF/WOFF). The browser draws the
 * text and every pixel at least half covered becomes ink, so the result is
 * hard-edged pixel art with no anti-aliasing. Pixel fonts look best at their
 * native size (or a multiple of it).
 */

export const GENERIC_FONTS: { value: string; label: string }[] = [
  { value: 'sans-serif', label: 'Sem serifa (do sistema)' },
  { value: 'serif', label: 'Com serifa (do sistema)' },
  { value: 'monospace', label: 'Monoespaçada (do sistema)' },
];

const loaded: string[] = [];

/** Families loaded from font files in this session. */
export function loadedFonts(): readonly string[] {
  return loaded;
}

/** Registers a font file and returns its family name. */
export async function loadFontFile(fileName: string, data: Uint8Array): Promise<string> {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/["\\]/g, '').trim().slice(0, 60) || 'Fonte';
  let family = base;
  for (let i = 2; loaded.includes(family); i++) family = `${base} ${i}`;
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const face = new FontFace(family, buf);
  try {
    await face.load();
  } catch {
    throw new Error('O arquivo não é uma fonte que o PixelCraft consiga ler (use TTF, OTF ou WOFF).');
  }
  document.fonts.add(face);
  loaded.push(family);
  return family;
}

export interface SystemTextOptions {
  family: string;
  size: number;
  letterSpacing?: number;
  lineSpacing?: number;
  align?: 'left' | 'center' | 'right';
}

const MAX_SIDE = 4096;

function cssFont(family: string, size: number): string {
  const generic = GENERIC_FONTS.some((f) => f.value === family);
  return `${size}px ${generic ? family : `"${family}"`}`;
}

export function rasterizeSystemText(text: string, o: SystemTextOptions): TextMask {
  const size = Math.max(4, Math.min(256, Math.round(o.size)));
  const lines = text.split('\n');
  const canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const setup = (c: CanvasRenderingContext2D): void => {
    c.font = cssFont(o.family, size);
    c.textBaseline = 'alphabetic';
    (c as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${o.letterSpacing ?? 0}px`;
  };
  setup(ctx);
  const probe = ctx.measureText('Hg');
  const ascent = Math.ceil(probe.fontBoundingBoxAscent || size * 0.8);
  const descent = Math.ceil(probe.fontBoundingBoxDescent || size * 0.25);
  const lineH = ascent + descent;
  const gap = o.lineSpacing ?? 0;
  const widths = lines.map((l) => Math.ceil(ctx.measureText(l).width));
  const width = Math.min(MAX_SIDE, Math.max(1, ...widths));
  const height = Math.min(MAX_SIDE, Math.max(1, lines.length * lineH + (lines.length - 1) * gap));
  canvas.width = width;
  canvas.height = height;
  ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  setup(ctx);
  ctx.fillStyle = '#000';
  lines.forEach((line, i) => {
    const w = widths[i]!;
    const x = o.align === 'center' ? Math.floor((width - w) / 2) : o.align === 'right' ? width - w : 0;
    ctx.fillText(line, x, i * (lineH + gap) + ascent);
  });
  const px = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3]! >= 128 ? 1 : 0;
  return { width, height, mask };
}
