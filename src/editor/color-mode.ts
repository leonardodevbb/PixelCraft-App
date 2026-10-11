import { paletteSnapper } from '../palette/analysis';
import type { ColorMode, DocState } from '../project/model';
import { mapColors } from './doc-ops';
import { EditorError, type EditorSession } from './session';

export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  rgb: 'RGB (cores livres)',
  indexed: 'Indexado (só cores da paleta)',
};

export { paletteSnapper, snapBuffer } from '../palette/analysis';

export function isIndexed(st: DocState): boolean {
  return st.colorMode === 'indexed';
}

/**
 * Switches the colour mode. Going to indexed snaps every pixel of every layer
 * and frame to the palette in the same undo step.
 */
export function setColorMode(s: EditorSession, mode: ColorMode): void {
  if ((s.state.colorMode ?? 'rgb') === mode) return;
  if (mode === 'rgb') {
    s.apply('Modo de cor: RGB', (st) => {
      const { colorMode: _, ...rest } = st;
      return rest;
    });
    return;
  }
  const palette = s.state.palette.colors;
  if (!palette.some((c) => c >>> 0 !== 0 && (c & 255) > 0)) throw new EditorError('A paleta está vazia. Adicione cores antes de usar o modo indexado.');
  mapColors(s, 'Modo de cor: indexado', paletteSnapper(palette), 'all', (st) => ({ ...st, colorMode: 'indexed' }), { everywhere: true });
}
