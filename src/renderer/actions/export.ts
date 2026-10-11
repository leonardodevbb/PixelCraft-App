import { encodePng } from '../../import-export/png';
import { renderFrameForExport } from '../../import-export/export-image';
import type { RGBA } from '../../raster/color';
import { api } from '../api';
import { useEditor } from '../state/editor-store';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface PngExportRequest {
  scale: number;
  background: RGBA | null;
  frameId: string;
}

export async function exportPng(req: PngExportRequest): Promise<boolean> {
  const { session, toast, setBusy } = useEditor.getState();
  if (!session) return false;
  const path = await api.file.saveDialog({
    kind: 'image',
    defaultName: `${session.doc.name}${req.scale > 1 ? `@${req.scale}x` : ''}.png`,
    title: 'Exportar PNG',
    extensions: ['png'],
    filterName: 'Imagem PNG',
  });
  if (!path) return false;
  setBusy('Exportando…');
  try {
    const img = renderFrameForExport(session.state, session.lookup, req);
    const bytes = encodePng(img, { text: { Software: `PixelCraft ${__APP_VERSION__}` } });
    await api.file.write(path, bytes);
    toast('success', `PNG exportado (${img.width}×${img.height}).`, {
      label: 'Mostrar na pasta',
      run: () => void api.file.showInFolder(path),
    });
    return true;
  } catch (e) {
    toast('error', `Falha ao exportar: ${errorMessage(e)}`);
    return false;
  } finally {
    setBusy(null);
  }
}
