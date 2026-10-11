/**
 * Generates the PixelCraft brand assets (SVG + PNG + ICO) from a single
 * description, so every size stays consistent and nothing depends on an
 * external renderer. Run with: npm run branding
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../src/import-export/png';
import { renderText } from '../src/raster/bitmap-font';
import { parseHex } from '../src/raster/color';
import { PixelBuffer } from '../src/raster/pixel-buffer';

const ROOT = process.cwd();
const OUT = join(ROOT, 'assets/branding');
const ICONS = join(ROOT, 'build/icons');
const PUBLIC = join(ROOT, 'assets/public');

export const BRAND = {
  ink: '#1B1726', // deep violet-black, icon tile and dark UI base
  paper: '#F4F2FA',
  teal: '#2EC4B6',
  violet: '#7B5CFF',
  pink: '#FF4F81',
  orange: '#FF7A3D',
  yellow: '#FFD23F',
};

interface Cell {
  x: number;
  y: number;
  color: string;
  /** Draw without the grid gap (used for lettering). */
  solid?: boolean;
}

/**
 * The symbol: a "P" assembled from pixel blocks on a 10×10 grid. Its
 * top-right corner is missing and the yellow block above it is being placed,
 * the moment a sprite comes together.
 */
function symbolCells(palette: Partial<typeof BRAND> = {}): Cell[] {
  const c = { ...BRAND, ...palette };
  const cells: Cell[] = [];
  for (let y = 1; y <= 8; y++) for (const x of [1, 2]) cells.push({ x, y, color: c.teal });
  for (let x = 3; x <= 6; x++) cells.push({ x, y: 1, color: c.violet });
  for (let y = 2; y <= 4; y++) cells.push({ x: 7, y, color: c.pink });
  for (let x = 3; x <= 6; x++) cells.push({ x, y: 5, color: c.orange });
  cells.push({ x: 8, y: 0, color: c.yellow });
  return cells;
}

function wordCells(text: string, x0: number, y0: number, color: (i: number) => string): { cells: Cell[]; width: number } {
  const cells: Cell[] = [];
  let x = x0;
  [...text].forEach((ch, i) => {
    const m = renderText(ch, undefined, { letterSpacing: 0 });
    for (let y = 0; y < m.height; y++)
      for (let xx = 0; xx < m.width; xx++) if (m.mask[y * m.width + xx]) cells.push({ x: x + xx, y: y0 + y - 2, color: color(i), solid: true });
    x += m.width + 1;
  });
  return { cells, width: x - x0 - 1 };
}

interface Art {
  width: number;
  height: number;
  cells: Cell[];
  background?: { color: string; radius: number };
  /** Gap between blocks as a fraction of a cell (shows the pixel grid). */
  gap: number;
}

function svg(a: Art, title: string, mono = false): string {
  const g = a.gap;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${a.width} ${a.height}" width="${a.width * 16}" height="${a.height * 16}" role="img" aria-label="${title}" shape-rendering="crispEdges">`,
    `<title>${title}</title>`,
  ];
  if (a.background) {
    parts.push(`<rect width="${a.width}" height="${a.height}" rx="${a.background.radius}" fill="${a.background.color}" shape-rendering="geometricPrecision"/>`);
  }
  for (const c of a.cells) {
    const cg = c.solid ? 0 : g;
    parts.push(
      `<rect x="${+(c.x + cg / 2).toFixed(3)}" y="${+(c.y + cg / 2).toFixed(3)}" width="${+(1 - cg).toFixed(3)}" height="${+(1 - cg).toFixed(3)}" fill="${mono ? 'currentColor' : c.color}"/>`,
    );
  }
  parts.push('</svg>\n');
  return parts.join('\n');
}

/** Rasterizes an Art at `size` px for its larger side, 4×4 supersampled. */
function raster(a: Art, size: number, gap = a.gap): PixelBuffer {
  const ss = 4;
  const scale = size / Math.max(a.width, a.height);
  const W = Math.round(a.width * scale);
  const H = Math.round(a.height * scale);
  const acc = new Float64Array(W * H * 4);
  const sample = (fx: number, fy: number): [number, number, number, number] | null => {
    const ux = fx / scale;
    const uy = fy / scale;
    for (const c of a.cells) {
      const g = c.solid ? 0 : gap;
      if (ux >= c.x + g / 2 && ux < c.x + 1 - g / 2 && uy >= c.y + g / 2 && uy < c.y + 1 - g / 2) {
        const v = parseHex(c.color)!;
        return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, 255];
      }
    }
    if (a.background) {
      const r = a.background.radius;
      const cx = Math.min(Math.max(ux, r), a.width - r);
      const cy = Math.min(Math.max(uy, r), a.height - r);
      if ((ux - cx) ** 2 + (uy - cy) ** 2 <= r * r) {
        const v = parseHex(a.background.color)!;
        return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, 255];
      }
    }
    return null;
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const s = sample(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss);
          if (!s) continue;
          const i = (y * W + x) * 4;
          acc[i]! += s[0];
          acc[i + 1]! += s[1];
          acc[i + 2]! += s[2];
          acc[i + 3]! += 1;
        }
  const out = new PixelBuffer(W, H);
  for (let i = 0; i < W * H; i++) {
    const n = acc[i * 4 + 3]!;
    if (!n) continue;
    out.data[i * 4] = Math.round(acc[i * 4]! / n);
    out.data[i * 4 + 1] = Math.round(acc[i * 4 + 1]! / n);
    out.data[i * 4 + 2] = Math.round(acc[i * 4 + 2]! / n);
    out.data[i * 4 + 3] = Math.round((n / (ss * ss)) * 255);
  }
  return out;
}

function ico(pngs: { size: number; data: Uint8Array }[]): Uint8Array {
  const header = 6 + 16 * pngs.length;
  const total = header + pngs.reduce((n, p) => n + p.data.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(2, 1, true);
  dv.setUint16(4, pngs.length, true);
  let off = header;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    out[e] = p.size >= 256 ? 0 : p.size;
    out[e + 1] = p.size >= 256 ? 0 : p.size;
    dv.setUint16(e + 4, 1, true);
    dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, p.data.length, true);
    dv.setUint32(e + 12, off, true);
    out.set(p.data, off);
    off += p.data.length;
  });
  return out;
}

function shift(cells: Cell[], dx: number, dy: number): Cell[] {
  return cells.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
}

function main(): void {
  for (const d of [OUT, join(OUT, 'png'), ICONS, PUBLIC]) mkdirSync(d, { recursive: true });

  const symbol: Art = { width: 10, height: 10, cells: symbolCells(), gap: 0.1 };
  // App icon: symbol on an ink tile with breathing room.
  const icon: Art = { width: 14, height: 14, cells: shift(symbolCells(), 2, 2), background: { color: BRAND.ink, radius: 3 }, gap: 0.1 };

  const logo = (text: string, accent: string): Art => {
    const sym = symbolCells();
    const pixel = wordCells('Pixel', 12, 2, () => text);
    const craft = wordCells('Craft', 12 + pixel.width + 1, 2, () => accent);
    return { width: 12 + pixel.width + 1 + craft.width + 1, height: 10, cells: [...sym, ...pixel.cells, ...craft.cells], gap: 0.1 };
  };
  const logoDark = logo(BRAND.paper, BRAND.orange); // for dark backgrounds
  const logoLight = logo(BRAND.ink, '#E0552A'); // for light backgrounds (darker orange for contrast)

  const files: Record<string, string> = {
    'pixelcraft-symbol.svg': svg(symbol, 'PixelCraft'),
    'pixelcraft-symbol-mono.svg': svg(symbol, 'PixelCraft', true),
    'pixelcraft-logo-on-dark.svg': svg(logoDark, 'PixelCraft'),
    'pixelcraft-logo-on-light.svg': svg(logoLight, 'PixelCraft'),
    'pixelcraft-logo-mono.svg': svg(logoDark, 'PixelCraft', true),
    'pixelcraft-app-icon.svg': svg(icon, 'PixelCraft'),
    'favicon.svg': svg({ ...icon, gap: 0 }, 'PixelCraft'),
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(OUT, name), content);
  // The renderer uses the same files.
  writeFileSync(join(PUBLIC, 'logo-on-dark.svg'), files['pixelcraft-logo-on-dark.svg']!);
  writeFileSync(join(PUBLIC, 'logo-on-light.svg'), files['pixelcraft-logo-on-light.svg']!);
  writeFileSync(join(PUBLIC, 'symbol.svg'), files['pixelcraft-symbol.svg']!);
  writeFileSync(join(PUBLIC, 'favicon.svg'), files['favicon.svg']!);

  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const icoParts: { size: number; data: Uint8Array }[] = [];
  for (const size of sizes) {
    // Small sizes drop the grid gaps so blocks don't blur together.
    const png = encodePng(raster(icon, size, size < 64 ? 0 : icon.gap), { level: 9 });
    writeFileSync(join(OUT, 'png', `pixelcraft-icon-${size}.png`), png);
    if (size <= 512) writeFileSync(join(ICONS, `${size}x${size}.png`), png);
    if ([16, 32, 48, 256].includes(size)) icoParts.push({ size, data: png });
  }
  writeFileSync(join(OUT, 'favicon.ico'), ico(icoParts));
  writeFileSync(join(ROOT, 'build/icon.png'), encodePng(raster(icon, 512), { level: 9 }));
  writeFileSync(join(OUT, 'png', 'pixelcraft-symbol-512.png'), encodePng(raster(symbol, 512), { level: 9 }));
  writeFileSync(join(OUT, 'png', 'pixelcraft-logo-on-dark.png'), encodePng(raster(logoDark, 1200), { level: 9 }));
  writeFileSync(join(OUT, 'png', 'pixelcraft-logo-on-light.png'), encodePng(raster(logoLight, 1200), { level: 9 }));
  console.log('Brand assets written to', OUT);
}

main();
