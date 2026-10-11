import { addLayerWithImage } from '../../editor/layer-ops';
import { resizeCanvas } from '../../editor/doc-ops';
import { EditorError } from '../../editor/session';
import { decodeImage } from '../../import-export/browser-decode';
import { LIMITS } from '../../project/limits';
import { api } from '../api';
import { attemptAsync } from './edit';
import { confirmDialog, useEditor } from '../state/editor-store';

function stripExt(n: string): string {
  return n.replace(/\.[^.]+$/, '');
}

/** Imports an image file as a new layer of the open document, centred. */
export async function importImageAsLayer(): Promise<void> {
  const file = await api.file.openDialog('image', 'Importar imagem como camada');
  if (!file) return;
  await attemptAsync(async (s) => {
    let img;
    try {
      img = await decodeImage(file.data, LIMITS.maxPixels);
    } catch (e) {
      throw new EditorError(`Não foi possível ler "${file.name}": ${e instanceof Error ? e.message : String(e)}`);
    }
    const { width: w, height: h } = s.state;
    if (img.width > w || img.height > h) {
      const c = await confirmDialog({
        title: 'Imagem maior que a tela',
        message: `"${file.name}" tem ${img.width}×${img.height} pixels e o documento ${w}×${h}. Aumentar a tela para caber?`,
        confirmLabel: 'Aumentar a tela',
        altLabel: 'Importar recortada',
      });
      if (c === 'cancel') return;
      if (c === 'confirm') resizeCanvas(s, Math.max(w, img.width), Math.max(h, img.height), { ax: 0.5, ay: 0.5 });
    }
    addLayerWithImage(s, stripExt(file.name), img, Math.floor((s.state.width - img.width) / 2), Math.floor((s.state.height - img.height) / 2), 'Importar imagem como camada');
    useEditor.getState().toast('success', `"${file.name}" importada como camada.`);
  });
}

/** Opens the spritesheet slicer with a file chosen by the user. */
export async function importSpritesheet(): Promise<void> {
  const file = await api.file.openDialog('image', 'Importar spritesheet');
  if (!file) return;
  useEditor.getState().openDialog({ type: 'import-spritesheet', file: { name: file.name, data: file.data } });
}
