import { LIMITS } from '../project/limits';
import { celKey, makeFrame, parseCelKey, type AnimationSettings, type FrameId, type ImageId, type LayerId } from '../project/model';
import { EditorError, type EditorSession } from './session';

function assertRoom(s: EditorSession, extra = 1): void {
  if (s.state.frames.length + extra > LIMITS.maxFrames) throw new EditorError(`Limite de ${LIMITS.maxFrames} quadros atingido.`);
}

function clampDuration(ms: number): number {
  return Math.max(LIMITS.minFrameDuration, Math.min(LIMITS.maxFrameDuration, Math.round(ms)));
}

function frameIndex(s: EditorSession, id: FrameId = s.activeFrameId): number {
  const i = s.state.frames.findIndex((f) => f.id === id);
  if (i < 0) throw new EditorError('Quadro inexistente.');
  return i;
}

/** Adds an empty frame after the active one (same duration) and selects it. */
export function addFrame(s: EditorSession): FrameId {
  s.cancelDraft();
  assertRoom(s);
  const i = frameIndex(s);
  const f = makeFrame(s.state.frames[i]!.duration);
  s.apply('Novo quadro', (st) => ({ ...st, frames: [...st.frames.slice(0, i + 1), f, ...st.frames.slice(i + 1)] }), { frameId: f.id });
  return f.id;
}

/**
 * Duplicates the active frame right after it. With `linked`, the new cels
 * share images with the original (editing one edits both) until unlinked.
 */
export function duplicateFrame(s: EditorSession, linked = false): FrameId {
  s.cancelDraft();
  assertRoom(s);
  const st = s.state;
  const i = frameIndex(s);
  const src = st.frames[i]!;
  const f = { ...makeFrame(src.duration) };
  const cels: Record<string, ImageId> = { ...st.cels };
  const newImages: ImageId[] = [];
  for (const [k, id] of Object.entries(st.cels)) {
    const { layerId, frameId } = parseCelKey(k);
    if (frameId !== src.id) continue;
    if (linked) cels[celKey(layerId, f.id)] = id;
    else {
      const img = s.image(id);
      if (!img) continue;
      const nid = s.addImage(img.clone());
      newImages.push(nid);
      cels[celKey(layerId, f.id)] = nid;
    }
  }
  const next = { ...st, frames: [...st.frames.slice(0, i + 1), f, ...st.frames.slice(i + 1)], cels };
  s.commit(linked ? 'Duplicar quadro (vinculado)' : 'Duplicar quadro', next, [], newImages, { ...s.context, frameId: f.id, selection: s.selection });
  return f.id;
}

export function deleteFrame(s: EditorSession, id: FrameId = s.activeFrameId): void {
  s.cancelDraft();
  const st = s.state;
  if (st.frames.length <= 1) throw new EditorError('A animação precisa de pelo menos um quadro.');
  const i = frameIndex(s, id);
  const nextActive = st.frames[i + 1]?.id ?? st.frames[i - 1]!.id;
  s.apply(
    'Excluir quadro',
    (cur) => {
      const cels: Record<string, ImageId> = {};
      for (const [k, v] of Object.entries(cur.cels)) if (parseCelKey(k).frameId !== id) cels[k] = v;
      return { ...cur, frames: cur.frames.filter((f) => f.id !== id), cels };
    },
    { frameId: nextActive },
  );
}

/** Moves a frame to a new index (0-based, final position). */
export function moveFrame(s: EditorSession, id: FrameId, to: number): void {
  s.cancelDraft();
  const frames = [...s.state.frames];
  const from = frameIndex(s, id);
  const target = Math.max(0, Math.min(frames.length - 1, to));
  if (from === target) return;
  const [f] = frames.splice(from, 1);
  frames.splice(target, 0, f!);
  s.apply('Reordenar quadros', (st) => ({ ...st, frames }));
}

export function setFrameDuration(s: EditorSession, ids: FrameId[], ms: number): void {
  const d = clampDuration(ms);
  const set = new Set(ids);
  if (!s.state.frames.some((f) => set.has(f.id) && f.duration !== d)) return;
  s.apply(ids.length > 1 ? 'Duração dos quadros' : 'Duração do quadro', (st) => ({
    ...st,
    frames: st.frames.map((f) => (set.has(f.id) ? { ...f, duration: d } : f)),
  }));
}

/** Sets the FPS and makes every frame last 1000/fps ms. */
export function setFps(s: EditorSession, fps: number): void {
  const f = Math.max(1, Math.min(60, Math.round(fps)));
  const d = clampDuration(1000 / f);
  s.apply('Velocidade da animação', (st) => ({ ...st, animation: { ...st.animation, fps: f }, frames: st.frames.map((fr) => ({ ...fr, duration: d })) }));
}

export function setAnimation(s: EditorSession, patch: Partial<AnimationSettings>): void {
  const a = s.state.animation;
  if ((Object.keys(patch) as (keyof AnimationSettings)[]).every((k) => a[k] === patch[k])) return;
  s.apply('Configurar animação', (st) => ({ ...st, animation: { ...st.animation, ...patch } }));
}

export function setFrameTag(s: EditorSession, id: FrameId, tag: string | null): void {
  const t = tag?.trim().slice(0, 60) || undefined;
  s.apply(t ? 'Marcar quadro' : 'Remover marcador', (st) => ({
    ...st,
    frames: st.frames.map((f) => {
      if (f.id !== id) return f;
      const { tag: _old, ...rest } = f;
      return t ? { ...rest, tag: t } : rest;
    }),
  }));
}

export function reverseFrames(s: EditorSession): void {
  if (s.state.frames.length < 2) return;
  s.cancelDraft();
  s.apply('Inverter ordem dos quadros', (st) => ({ ...st, frames: [...st.frames].reverse() }));
}

/** True when the cel's image is also used by another cel. */
export function isCelLinked(s: EditorSession, layerId: LayerId, frameId: FrameId): boolean {
  const id = s.state.cels[celKey(layerId, frameId)];
  if (!id) return false;
  let n = 0;
  for (const v of Object.values(s.state.cels)) if (v === id && ++n > 1) return true;
  return false;
}

/** Gives a linked cel its own copy of the image. */
export function unlinkCel(s: EditorSession, layerId: LayerId = s.activeLayerId, frameId: FrameId = s.activeFrameId): void {
  if (!isCelLinked(s, layerId, frameId)) return;
  s.cancelDraft();
  const key = celKey(layerId, frameId);
  const img = s.image(s.state.cels[key]!)!;
  const nid = s.addImage(img.clone());
  s.commit('Desvincular célula', { ...s.state, cels: { ...s.state.cels, [key]: nid } }, [], [nid]);
}

/** Makes the cel show the same image as the previous frame (linked). */
export function linkCelToPrevious(s: EditorSession, layerId: LayerId = s.activeLayerId, frameId: FrameId = s.activeFrameId): void {
  const i = frameIndex(s, frameId);
  const prev = s.state.frames[i - 1];
  if (!prev) throw new EditorError('O primeiro quadro não tem quadro anterior para vincular.');
  if (!s.canEditLayer(layerId)) throw new EditorError('A camada está bloqueada.');
  s.cancelDraft();
  const src = s.state.cels[celKey(layerId, prev.id)];
  const key = celKey(layerId, frameId);
  s.apply('Vincular ao quadro anterior', (st) => {
    const cels = { ...st.cels };
    if (src) cels[key] = src;
    else delete cels[key];
    return { ...st, cels };
  });
}

export function goToFrame(s: EditorSession, delta: number, wrap = true): void {
  const n = s.state.frames.length;
  let i = frameIndex(s) + delta;
  if (wrap) i = ((i % n) + n) % n;
  else i = Math.max(0, Math.min(n - 1, i));
  s.setActiveFrame(s.state.frames[i]!.id);
}
