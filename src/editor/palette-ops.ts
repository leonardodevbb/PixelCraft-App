import { LIMITS } from '../project/limits';
import type { DocState, Palette } from '../project/model';
import { countColors, medianCut, nearestColor, paletteSnapper } from '../palette/analysis';
import { hslToRgb, rgbToHsl, withAlpha, type RGBA } from '../raster/color';
import type { PixelBuffer } from '../raster/pixel-buffer';
import { mapColors, type CelScope } from './doc-ops';
import { EditorError, type EditorSession } from './session';

/**
 * The document palette is part of the document and edits are undoable. In
 * indexed mode the pixels follow the palette in the same step: `recolor`
 * maps pixels of a changed entry to its new colour, anything else that left
 * the palette snaps to the nearest remaining entry.
 */
export function setPalette(s: EditorSession, palette: Palette, label = 'Editar paleta', recolor?: { from: RGBA; to: RGBA }): void {
  if (palette.colors.length > LIMITS.maxPaletteColors) throw new EditorError(`A paleta pode ter no máximo ${LIMITS.maxPaletteColors} cores.`);
  if (s.state.colorMode !== 'indexed' || palette.colors.length === 0) {
    s.apply(label, (st) => ({ ...st, palette }));
    return;
  }
  const snap = paletteSnapper(palette.colors);
  const fn = recolor ? (c: RGBA) => (c === recolor.from ? recolor.to : snap(c)) : snap;
  mapColors(s, label, fn, 'all', (st) => ({ ...st, palette }), { everywhere: true });
}

export function addPaletteColor(s: EditorSession, c: RGBA, at?: number): void {
  const p = s.state.palette;
  const colors = [...p.colors];
  colors.splice(at ?? colors.length, 0, c);
  setPalette(s, { ...p, colors }, 'Adicionar cor à paleta');
}

export function removePaletteColor(s: EditorSession, index: number): void {
  const p = s.state.palette;
  if (index < 0 || index >= p.colors.length) return;
  setPalette(s, { ...p, colors: p.colors.filter((_, i) => i !== index) }, 'Remover cor da paleta');
}

export function movePaletteColor(s: EditorSession, from: number, to: number): void {
  const p = s.state.palette;
  if (from === to || from < 0 || from >= p.colors.length) return;
  const colors = [...p.colors];
  const [c] = colors.splice(from, 1);
  colors.splice(Math.max(0, Math.min(colors.length, to)), 0, c!);
  setPalette(s, { ...p, colors }, 'Reordenar paleta');
}

export function setPaletteColor(s: EditorSession, index: number, c: RGBA): void {
  const p = s.state.palette;
  if (index < 0 || index >= p.colors.length || p.colors[index] === c) return;
  const old = p.colors[index]!;
  // Only recolour when the old colour had a single entry; otherwise other entries still claim it.
  const unique = p.colors.indexOf(old) === p.colors.lastIndexOf(old);
  setPalette(s, { ...p, colors: p.colors.map((x, i) => (i === index ? c : x)) }, 'Alterar cor da paleta', unique ? { from: old, to: c } : undefined);
}

/** All distinct images referenced by the document's cels. */
export function documentImages(s: EditorSession): PixelBuffer[] {
  const ids = new Set(Object.values(s.state.cels));
  return [...ids].map((id) => s.image(id)).filter((b): b is PixelBuffer => !!b);
}

export function usedColors(s: EditorSession): Map<RGBA, number> {
  return countColors(documentImages(s));
}

/** Snaps every pixel to the nearest palette colour. */
export function applyPalette(s: EditorSession, palette: readonly RGBA[], scope: CelScope = 'all', label = 'Aplicar paleta', patch?: (st: DocState) => DocState): void {
  if (palette.length === 0) throw new EditorError('A paleta está vazia.');
  const cache = new Map<RGBA, RGBA>();
  mapColors(
    s,
    label,
    (c) => {
      let n = cache.get(c);
      if (n === undefined) {
        n = nearestColor(c, palette);
        cache.set(c, n);
      }
      return n;
    },
    scope,
    patch,
  );
}

/**
 * Reduces the document to at most `max` colours (median cut), remaps the
 * pixels and replaces the document palette with the result.
 */
export function reduceColors(s: EditorSession, max: number): RGBA[] {
  const reduced = medianCut(usedColors(s), Math.max(1, Math.min(256, Math.floor(max))));
  applyPalette(s, reduced, 'all', `Reduzir para ${reduced.length} cores`, (st) => ({ ...st, palette: { ...st.palette, colors: reduced } }));
  return reduced;
}

export type PaletteSort = 'hue' | 'lightness' | 'saturation' | 'usage';

export const PALETTE_SORT_LABELS: Record<PaletteSort, string> = {
  hue: 'Por matiz',
  lightness: 'Por luminosidade',
  saturation: 'Por saturação',
  usage: 'Por uso no desenho',
};

/** Reorders the palette. Pixels are untouched (only the order changes). */
export function sortPalette(s: EditorSession, by: PaletteSort): void {
  const p = s.state.palette;
  const usage = by === 'usage' ? usedColors(s) : null;
  const key = (c: RGBA): number[] => {
    const hsl = rgbToHsl(c);
    // Greys first when sorting by hue, so ramps of colour stay together.
    if (by === 'hue') return [hsl.s < 8 ? 0 : 1, hsl.s < 8 ? hsl.l : Math.round(hsl.h), hsl.l];
    if (by === 'lightness') return [hsl.l, hsl.h];
    if (by === 'saturation') return [hsl.s, hsl.h];
    return [-(usage!.get(c) ?? 0)];
  };
  const keyed = p.colors.map((c, i) => ({ c, i, k: key(c) }));
  keyed.sort((a, b) => {
    for (let j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j]! - b.k[j]!;
    return a.i - b.i;
  });
  const colors = keyed.map((e) => e.c);
  if (colors.every((c, i) => c === p.colors[i])) return;
  setPalette(s, { ...p, colors }, 'Ordenar paleta');
}

/**
 * A ramp of `steps` colours from `a` to `b` (both included). The hue travels
 * the short way round and lightness changes evenly, which gives the
 * shade-to-highlight ramps pixel artists build by hand.
 */
export function colorRamp(a: RGBA, b: RGBA, steps: number): RGBA[] {
  const n = Math.max(2, Math.min(64, Math.floor(steps)));
  const ha = rgbToHsl(a);
  const hb = rgbToHsl(b);
  let dh = hb.h - ha.h;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  // A grey end takes the other end's hue so the ramp doesn't swing through the wheel.
  const h0 = ha.s < 1 ? hb.h : ha.h;
  if (ha.s < 1 || hb.s < 1) dh = 0;
  const out: RGBA[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (i === 0) out.push(withAlpha(a, 255));
    else if (i === n - 1) out.push(withAlpha(b, 255));
    else out.push(hslToRgb({ h: h0 + dh * t, s: ha.s + (hb.s - ha.s) * t, l: ha.l + (hb.l - ha.l) * t }));
  }
  return out;
}

/** Appends a ramp between two colours to the palette, skipping colours it already has. */
export function addRamp(s: EditorSession, a: RGBA, b: RGBA, steps: number): number {
  const p = s.state.palette;
  const have = new Set(p.colors);
  const add = colorRamp(a, b, steps).filter((c) => !have.has(c) && (have.add(c), true));
  if (!add.length) return 0;
  setPalette(s, { ...p, colors: [...p.colors, ...add] }, 'Gerar degradê na paleta');
  return add.length;
}

/** Replaces the palette by the colours the drawing uses (reduced to 256 if needed). */
export function paletteFromDrawing(s: EditorSession): number {
  const counts = usedColors(s);
  if (counts.size === 0) throw new EditorError('O desenho ainda não tem cores.');
  const opaque = new Map<RGBA, number>();
  for (const [c, n] of counts) opaque.set(withAlpha(c, 255), (opaque.get(withAlpha(c, 255)) ?? 0) + n);
  const colors = opaque.size <= 256 ? [...opaque.entries()].sort((x, y) => y[1] - x[1]).map(([c]) => c) : medianCut(opaque, 256);
  setPalette(s, { ...s.state.palette, name: 'Cores do desenho', colors }, 'Paleta a partir do desenho');
  return colors.length;
}

/** Removes palette entries no pixel uses. */
export function removeUnusedColors(s: EditorSession): number {
  const used = new Set([...usedColors(s).keys()].map((c) => withAlpha(c, 255)));
  const p = s.state.palette;
  const colors = p.colors.filter((c) => used.has(withAlpha(c, 255)));
  const removed = p.colors.length - colors.length;
  if (removed) setPalette(s, { ...p, colors }, 'Remover cores sem uso');
  return removed;
}
