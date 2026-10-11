import { celKey, pixelLayers, type FrameId } from '../project/model';
import type { EditorSession } from './session';

const layerIds = new WeakMap<object, number>();
let layerSeq = 0;
function refId(o: object): number {
  let id = layerIds.get(o);
  if (id === undefined) layerIds.set(o, (id = ++layerSeq));
  return id;
}

/**
 * Cheap key that changes whenever anything visible in a frame changes
 * (layer tree, size, cel images or their pixels). Used by caches.
 */
export function frameSignature(s: EditorSession, frameId: FrameId): string {
  const st = s.state;
  const parts: (string | number)[] = [refId(st.layers), st.width, st.height];
  for (const l of pixelLayers(st.layers)) {
    const id = st.cels[celKey(l.id, frameId)];
    if (id) parts.push(id, s.imageVersion(id));
  }
  return parts.join('|');
}
