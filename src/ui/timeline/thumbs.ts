import type { EditorSession } from '../../editor/session';
import { composeFrame } from '../../layers/compose';
import { resizeNearest } from '../../raster/scale';
import type { FrameId } from '../../project/model';
import { frameSignature } from '../../editor/signature';

const THUMB_MAX = 96;

const cache = new WeakMap<EditorSession, Map<FrameId, { sig: string; data: ImageData }>>();

/** Composite of a frame as a small ImageData (at most 96 px), cached by signature. */
export function frameImage(s: EditorSession, frameId: FrameId): ImageData {
  let m = cache.get(s);
  if (!m) cache.set(s, (m = new Map()));
  const sig = frameSignature(s, frameId);
  const hit = m.get(frameId);
  if (hit && hit.sig === sig) return hit.data;
  let buf = composeFrame(s.state, s.lookup, frameId);
  // Keep thumbnails small: memory stays bounded however big the document is.
  const k = Math.min(1, THUMB_MAX / Math.max(buf.width, buf.height));
  if (k < 1) buf = resizeNearest(buf, Math.max(1, Math.round(buf.width * k)), Math.max(1, Math.round(buf.height * k)));
  const data = new ImageData(new Uint8ClampedArray(buf.data), buf.width, buf.height);
  m.set(frameId, { sig, data });
  if (m.size > s.state.frames.length * 2) {
    const live = new Set(s.state.frames.map((f) => f.id));
    for (const k of m.keys()) if (!live.has(k)) m.delete(k);
  }
  return data;
}
