import { encodeImage, IMAGE_FORMATS, type ImageFormat } from '../../import-export/browser-encode';
import { renderFrameForExport } from '../../import-export/export-image';
import { rgba, type RGBA } from '../../raster/color';
import { api } from '../api';
import { useEditor } from '../state/editor-store';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface ImageExportRequest {
  format: ImageFormat;
  scale: number;
  background: RGBA | null;
  frameId: string;
  /** 0..1, JPEG/WebP only. */
  quality: number;
}

/** Formats without alpha get a background (white by default). */
export function effectiveBackground(req: Pick<ImageExportRequest, 'format' | 'background'>): RGBA | null {
  if (req.background !== null) return req.background;
  return IMAGE_FORMATS.find((f) => f.id === req.format)!.alpha ? null : rgba(255, 255, 255);
}

export async function renderExport(req: ImageExportRequest): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const { session } = useEditor.getState();
  if (!session) return null;
  const img = renderFrameForExport(session.state, session.lookup, { frameId: req.frameId, scale: req.scale, background: effectiveBackground(req) });
  const bytes = await encodeImage(img, req.format, { quality: req.quality, software: `PixelCraft ${__APP_VERSION__}` });
  return { bytes, width: img.width, height: img.height };
}

export async function exportImage(req: ImageExportRequest): Promise<boolean> {
  const { session, toast, setBusy } = useEditor.getState();
  if (!session) return false;
  const fmt = IMAGE_FORMATS.find((f) => f.id === req.format)!;
  const path = await api.file.saveDialog({
    kind: 'image',
    defaultName: `${session.doc.name}${req.scale > 1 ? `@${req.scale}x` : ''}.${fmt.ext}`,
    title: `Exportar ${fmt.label}`,
    extensions: fmt.id === 'jpeg' ? ['jpg', 'jpeg'] : [fmt.ext],
    filterName: `Imagem ${fmt.label}`,
  });
  if (!path) return false;
  setBusy('Exportando…');
  try {
    const r = (await renderExport(req))!;
    await api.file.write(path, r.bytes);
    toast('success', `${fmt.label} exportado (${r.width}×${r.height}).`, {
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

/** Kept for callers that only need PNG. */
export function exportPng(req: Omit<ImageExportRequest, 'format' | 'quality'>): Promise<boolean> {
  return exportImage({ ...req, format: 'png', quality: 1 });
}
