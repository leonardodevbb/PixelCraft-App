import { composeFrame } from '../../layers/compose';
import { TRANSPARENT, type RGBA } from '../../raster/color';
import type { EditorSession } from '../session';
import type { Tool, ToolHost, ToolPointer } from './types';

/** Color at (x, y) in the active layer, or in the visible composition. */
export function sampleColor(session: EditorSession, x: number, y: number, merged: boolean): RGBA {
  const s = session.state;
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return TRANSPARENT;
  if (!merged) {
    const draft = session.draft;
    const img =
      draft && draft.layerId === session.activeLayerId ? draft.buffer : session.celImage(session.activeLayerId, session.activeFrameId);
    return img ? img.get(x, y) : TRANSPARENT;
  }
  const out = composeFrame(s, session.lookup, session.activeFrameId, { region: { x, y, w: 1, h: 1 } });
  return out.get(x, y);
}

class EyedropperTool implements Tool {
  readonly id = 'eyedropper' as const;
  readonly label = 'Conta-gotas';
  cursor = 'copy';
  private active = false;

  private pick(p: ToolPointer, host: ToolHost): void {
    const s = host.session.state;
    if (p.x < 0 || p.y < 0 || p.x >= s.width || p.y >= s.height) return;
    host.setColor(p.slot, sampleColor(host.session, p.x, p.y, host.options.sampleMerged));
  }

  onDown(p: ToolPointer, host: ToolHost): void {
    this.active = true;
    this.pick(p, host);
  }
  onMove(p: ToolPointer, host: ToolHost): void {
    if (this.active) this.pick(p, host);
  }
  onUp(): void {
    this.active = false;
  }
  cancel(): void {
    this.active = false;
  }
}

export const eyedropperTool = new EyedropperTool();
