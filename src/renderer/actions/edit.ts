import { addLayerWithImage } from '../../editor/layer-ops';
import { rectSelection } from '../../editor/selection';
import { copySelection, cutSelection, deleteSelected, moveSelected, pastePiece, type Piece } from '../../editor/selection-ops';
import { EditorError, type EditorSession } from '../../editor/session';
import { decodeImage } from '../../import-export/browser-decode';
import { encodePng } from '../../import-export/png';
import { LIMITS } from '../../project/limits';
import { resizeCanvas } from '../../editor/doc-ops';
import { api } from '../api';
import { confirmDialog, useEditor } from '../state/editor-store';

/**
 * Runs an editing action and turns expected failures (locked layer, empty
 * selection, limits) into a toast instead of an exception.
 */
export function attempt<T>(fn: (s: EditorSession) => T): T | undefined {
  const { session, toast } = useEditor.getState();
  if (!session) return undefined;
  try {
    return fn(session);
  } catch (e) {
    if (e instanceof EditorError || e instanceof RangeError) toast('error', e.message);
    else {
      console.error(e);
      toast('error', `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`);
    }
    return undefined;
  }
}

export async function attemptAsync(fn: (s: EditorSession) => Promise<void>): Promise<void> {
  const { session, toast } = useEditor.getState();
  if (!session) return;
  try {
    await fn(session);
  } catch (e) {
    if (e instanceof EditorError || e instanceof RangeError) toast('error', e.message);
    else {
      console.error(e);
      toast('error', `Erro inesperado: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

/** Last piece copied inside PixelCraft, with the PNG we put on the system clipboard. */
let internal: { piece: Piece; png: Uint8Array } | null = null;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function publish(piece: Piece): Promise<void> {
  const png = encodePng(piece.buffer);
  internal = { piece, png };
  try {
    await api.clipboard.writePng(png);
  } catch {
    /* the internal clipboard keeps working without the system one */
  }
}

export async function copy(merged = false): Promise<void> {
  await attemptAsync(async (s) => {
    const piece = copySelection(s, merged);
    if (!piece) throw new EditorError('Nada para copiar: a seleção está vazia.');
    await publish(piece);
    useEditor.getState().toast('info', merged ? 'Cópia mesclada na área de transferência.' : 'Copiado.');
  });
}

export async function cut(): Promise<void> {
  await attemptAsync(async (s) => {
    const piece = cutSelection(s);
    if (!piece) throw new EditorError('Nada para recortar: a seleção está vazia.');
    await publish(piece);
  });
}

/** What to paste: the system clipboard image, unless it is the one we put there. */
async function clipboardPiece(): Promise<{ piece: Piece; external: boolean } | null> {
  let png: Uint8Array | null = null;
  try {
    png = await api.clipboard.readPng();
  } catch (e) {
    useEditor.getState().toast('error', e instanceof Error ? e.message : String(e));
  }
  if (internal && (!png || sameBytes(png, internal.png))) return { piece: internal.piece, external: false };
  if (!png) return null;
  const buffer = await decodeImage(png, LIMITS.maxPixels);
  // The system may re-encode our PNG; same pixels still mean it is our own copy.
  if (internal && buffer.equals(internal.piece.buffer)) return { piece: internal.piece, external: false };
  return { piece: { buffer, x: 0, y: 0, mask: new Uint8Array(buffer.width * buffer.height).fill(1) }, external: true };
}

export async function paste(intoNewLayer = false): Promise<void> {
  await attemptAsync(async (s) => {
    const got = await clipboardPiece();
    if (!got) throw new EditorError('A área de transferência não contém uma imagem.');
    const { piece, external } = got;
    const { width: w, height: h } = s.state;
    if (external && (piece.buffer.width > w || piece.buffer.height > h)) {
      const choice = await confirmDialog({
        title: 'Imagem maior que a tela',
        message: `A imagem colada tem ${piece.buffer.width}×${piece.buffer.height} pixels e o documento ${w}×${h}. Deseja aumentar a tela para caber?`,
        confirmLabel: 'Aumentar a tela',
        altLabel: 'Colar recortado',
        cancelLabel: 'Cancelar',
      });
      if (choice === 'cancel') return;
      if (choice === 'confirm') resizeCanvas(s, Math.max(w, piece.buffer.width), Math.max(h, piece.buffer.height), { ax: 0, ay: 0 });
    }
    // Internal pieces go back where they came from; external ones are centred.
    const x = external ? Math.floor((s.state.width - piece.buffer.width) / 2) : piece.x;
    const y = external ? Math.floor((s.state.height - piece.buffer.height) / 2) : piece.y;
    if (intoNewLayer) {
      addLayerWithImage(s, 'Colado', piece.buffer, x, y);
      s.setSelection({ bounds: { x, y, w: piece.buffer.width, h: piece.buffer.height }, mask: piece.mask }, 'Selecionar colagem');
    } else pastePiece(s, piece, x, y);
    useEditor.getState().setTool('move');
  });
}

export function selectAll(): void {
  attempt((s) => s.setSelection(rectSelection({ x: 0, y: 0, w: s.state.width, h: s.state.height }), 'Selecionar tudo'));
}

export function deleteSelection(): void {
  attempt((s) => deleteSelected(s));
}

/** Arrow-key nudge of the selected pixels (or the whole layer). */
export function nudge(dx: number, dy: number): void {
  attempt((s) => moveSelected(s, dx, dy));
}
