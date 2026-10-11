import { centerTransform, fitTransform, nextZoom, zoomAround, type FitMode } from '../../renderer-engine/viewport';
import { useEditor } from '../state/editor-store';

/** Size of the canvas viewport in CSS pixels, reported by CanvasView. */
export const viewportSize = { width: 800, height: 600 };

export function fitView(mode: FitMode = 'fit'): void {
  const { session, setTransform } = useEditor.getState();
  if (!session) return;
  setTransform(fitTransform(session.state.width, session.state.height, viewportSize.width, viewportSize.height, mode));
}

export function zoomStep(dir: 1 | -1, at?: { x: number; y: number }): void {
  const { transform, setTransform } = useEditor.getState();
  const p = at ?? { x: viewportSize.width / 2, y: viewportSize.height / 2 };
  setTransform(zoomAround(transform, nextZoom(transform.zoom, dir), p.x, p.y));
}

export function zoomTo(zoom: number): void {
  const { transform, setTransform } = useEditor.getState();
  setTransform(zoomAround(transform, zoom, viewportSize.width / 2, viewportSize.height / 2));
}

export function centerView(): void {
  const { session, transform, setTransform } = useEditor.getState();
  if (!session) return;
  setTransform(centerTransform(session.state.width, session.state.height, viewportSize.width, viewportSize.height, transform.zoom));
}
