import { LIMITS } from '../project/limits';
import type { DocState, Palette } from '../project/model';
import { countColors, medianCut, nearestColor } from '../palette/analysis';
import type { RGBA } from '../raster/color';
import type { PixelBuffer } from '../raster/pixel-buffer';
import { mapColors, type CelScope } from './doc-ops';
import { EditorError, type EditorSession } from './session';

/** The document palette is part of the document and edits are undoable. */
export function setPalette(s: EditorSession, palette: Palette, label = 'Editar paleta'): void {
  if (palette.colors.length > LIMITS.maxPaletteColors) throw new EditorError(`A paleta pode ter no máximo ${LIMITS.maxPaletteColors} cores.`);
  s.apply(label, (st) => ({ ...st, palette }));
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
  setPalette(s, { ...p, colors: p.colors.map((x, i) => (i === index ? c : x)) }, 'Alterar cor da paleta');
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
