import { History, patchBytes, type HistoryEntry, type PixelPatch } from '../history/history';
import { newId } from '../project/ids';
import {
  allLayers,
  celKey,
  findLayer,
  isEffectivelyLocked,
  type DocState,
  type FrameId,
  type ImageId,
  type LayerId,
  type ProjectDocument,
} from '../project/model';
import { PixelBuffer } from '../raster/pixel-buffer';
import type { Rect } from '../raster/rect';
import { unionRect } from '../raster/rect';
import type { Selection } from './selection';

/** Editor context saved with each history entry so undo also restores focus. */
export interface EditorContext {
  layerId: LayerId;
  frameId: FrameId;
  selection: Selection | null;
}

export type SessionEvent =
  | { type: 'doc' }
  | { type: 'draft'; rect: Rect | null }
  | { type: 'context' };

export type SessionListener = (e: SessionEvent) => void;

/** A working copy of one cel that a tool edits before committing. */
export interface Draft {
  layerId: LayerId;
  frameId: FrameId;
  key: string;
  original: PixelBuffer;
  buffer: PixelBuffer;
  dirty: Rect | null;
}

export class EditorError extends Error {}

/**
 * Owns one open document: its state, image store, history and the editor
 * context (active layer, frame, selection). Every modification goes through
 * `commit`, which records a single atomic history entry.
 */
export class EditorSession {
  readonly doc: ProjectDocument;
  readonly history: History<EditorContext>;
  private ctx: EditorContext;
  private listeners = new Set<SessionListener>();
  private savedMarker: HistoryEntry<EditorContext> | null | undefined = null;
  private _draft: Draft | null = null;
  /** Incremented on every visible change; cheap to compare from UI code. */
  revision = 0;
  filePath: string | null = null;

  constructor(doc: ProjectDocument, opts: { historyBytes?: number } = {}) {
    this.doc = doc;
    this.history = new History<EditorContext>(opts.historyBytes ? { maxBytes: opts.historyBytes } : {});
    const firstLayer = allLayers(doc.state.layers).find((l) => l.type === 'pixel') ?? doc.state.layers[0];
    const firstFrame = doc.state.frames[0];
    if (!firstLayer || !firstFrame) throw new EditorError('O documento precisa de pelo menos uma camada e um quadro.');
    this.ctx = { layerId: firstLayer.id, frameId: firstFrame.id, selection: null };
  }

  /* ---------- observation ---------- */

  subscribe(fn: SessionListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: SessionEvent): void {
    this.revision++;
    for (const fn of this.listeners) fn(e);
  }

  get state(): DocState {
    return this.doc.state;
  }
  get context(): Readonly<EditorContext> {
    return this.ctx;
  }
  get activeLayerId(): LayerId {
    return this.ctx.layerId;
  }
  get activeFrameId(): FrameId {
    return this.ctx.frameId;
  }
  get selection(): Selection | null {
    return this.ctx.selection;
  }
  get draft(): Draft | null {
    return this._draft;
  }

  get isDirty(): boolean {
    const top = this.history.entries.at(-1) ?? null;
    return top !== this.savedMarker;
  }

  markSaved(): void {
    this.savedMarker = this.history.entries.at(-1) ?? null;
    this.emit({ type: 'context' });
  }

  /** Forces the document to be considered modified (e.g. after recovery). */
  markUnsaved(): void {
    this.savedMarker = undefined;
    this.emit({ type: 'context' });
  }

  image(id: ImageId): PixelBuffer | undefined {
    return this.doc.images.get(id);
  }

  readonly lookup = (id: ImageId): PixelBuffer | undefined => this.doc.images.get(id);

  celImage(layerId: LayerId, frameId: FrameId): PixelBuffer | undefined {
    const id = this.doc.state.cels[celKey(layerId, frameId)];
    return id ? this.doc.images.get(id) : undefined;
  }

  /* ---------- context ---------- */

  setActiveLayer(id: LayerId): void {
    if (!findLayer(this.state.layers, id) || id === this.ctx.layerId) return;
    this.ctx = { ...this.ctx, layerId: id };
    this.emit({ type: 'context' });
  }

  setActiveFrame(id: FrameId): void {
    if (!this.state.frames.some((f) => f.id === id) || id === this.ctx.frameId) return;
    this.cancelDraft();
    this.ctx = { ...this.ctx, frameId: id };
    this.emit({ type: 'context' });
  }

  /** Selection changes are undoable, like in most editors. */
  setSelection(sel: Selection | null, label = sel ? 'Selecionar' : 'Desselecionar'): void {
    if (sel === this.ctx.selection) return;
    this.commit(label, this.state, [], [], { ...this.ctx, selection: sel });
  }

  /* ---------- commits ---------- */

  /**
   * Records and applies an operation. `next` must already reference any new
   * images (added to the store via `addImage`). Patches must already be
   * applied to the images when this is called.
   */
  commit(
    label: string,
    next: DocState,
    patches: PixelPatch[] = [],
    newImages: ImageId[] = [],
    ctxAfter?: EditorContext,
  ): void {
    const before = this.doc.state;
    const ctxBefore = this.ctx;
    const after = ctxAfter ?? this.fixContext(next, this.ctx);
    let bytes = patchBytes(patches) + 256;
    for (const id of newImages) bytes += this.doc.images.get(id)?.data.length ?? 0;
    this.history.push({ label, before, after: next, patches, newImages, ctxBefore, ctxAfter: after, bytes, time: Date.now() });
    this.doc.state = next;
    this.ctx = this.fixContext(next, after);
    this.collectGarbage();
    this.emit({ type: 'doc' });
  }

  /** Applies a pure state transformation as one history entry. */
  apply(label: string, fn: (s: DocState) => DocState, ctxAfter?: Partial<EditorContext>): void {
    const next = fn(this.state);
    if (next === this.state && !ctxAfter) return;
    this.commit(label, next, [], [], ctxAfter ? { ...this.ctx, ...ctxAfter } : undefined);
  }

  addImage(buf: PixelBuffer): ImageId {
    const id = newId('I');
    this.doc.images.set(id, buf);
    return id;
  }

  undo(): boolean {
    this.cancelDraft();
    const e = this.history.popUndo();
    if (!e) return false;
    for (let i = e.patches.length - 1; i >= 0; i--) {
      const p = e.patches[i]!;
      this.doc.images.get(p.imageId)?.paste(p.before, p.rect.x, p.rect.y);
    }
    this.doc.state = e.before;
    this.ctx = this.fixContext(e.before, e.ctxBefore ?? this.ctx);
    this.emit({ type: 'doc' });
    return true;
  }

  redo(): boolean {
    this.cancelDraft();
    const e = this.history.popRedo();
    if (!e) return false;
    this.doc.state = e.after;
    for (const p of e.patches) this.doc.images.get(p.imageId)?.paste(p.after, p.rect.x, p.rect.y);
    this.ctx = this.fixContext(e.after, e.ctxAfter ?? this.ctx);
    this.emit({ type: 'doc' });
    return true;
  }

  /** Keeps the active layer/frame pointing at things that exist. */
  private fixContext(state: DocState, ctx: EditorContext): EditorContext {
    let { layerId, frameId } = ctx;
    if (!findLayer(state.layers, layerId)) {
      const layers = allLayers(state.layers);
      layerId = (layers.find((l) => l.type === 'pixel') ?? layers[0])?.id ?? layerId;
    }
    if (!state.frames.some((f) => f.id === frameId)) frameId = state.frames[0]?.id ?? frameId;
    if (layerId === ctx.layerId && frameId === ctx.frameId) return ctx;
    return { ...ctx, layerId, frameId };
  }

  /** Drops images no longer reachable from the document or its history. */
  collectGarbage(): void {
    const keep = this.history.referencedImages();
    for (const id of Object.values(this.doc.state.cels)) keep.add(id);
    if (this._draft) {
      const id = this.doc.state.cels[this._draft.key];
      if (id) keep.add(id);
    }
    for (const id of [...this.doc.images.keys()]) if (!keep.has(id)) this.doc.images.delete(id);
  }

  /* ---------- drafts (live tool edits) ---------- */

  canEditLayer(layerId: LayerId = this.ctx.layerId): boolean {
    const loc = findLayer(this.state.layers, layerId);
    return !!loc && loc.layer.type === 'pixel' && !isEffectivelyLocked(this.state.layers, layerId);
  }

  /** Starts editing a cel. Throws if the layer cannot be edited. */
  beginDraft(layerId: LayerId = this.ctx.layerId, frameId: FrameId = this.ctx.frameId): Draft {
    if (!this.canEditLayer(layerId)) {
      const loc = findLayer(this.state.layers, layerId);
      throw new EditorError(
        loc?.layer.type === 'group'
          ? 'Selecione uma camada de pixels para desenhar (grupos não recebem pixels).'
          : 'A camada está bloqueada. Desbloqueie-a para editar.',
      );
    }
    this.cancelDraft();
    const key = celKey(layerId, frameId);
    const existing = this.celImage(layerId, frameId);
    const original = existing ? existing.clone() : new PixelBuffer(this.state.width, this.state.height);
    this._draft = { layerId, frameId, key, original, buffer: original.clone(), dirty: null };
    return this._draft;
  }

  /** Notifies listeners that the draft changed in `rect`. */
  touchDraft(rect: Rect | null): void {
    const d = this._draft;
    if (!d) return;
    if (rect) d.dirty = unionRect(d.dirty, rect);
    this.emit({ type: 'draft', rect });
  }

  /** Restores the draft buffer to the cel's original pixels (for shape previews). */
  resetDraft(): void {
    const d = this._draft;
    if (!d) return;
    if (d.dirty) {
      d.buffer.paste(d.original.extract(d.dirty), d.dirty.x, d.dirty.y);
      const r = d.dirty;
      d.dirty = null;
      this.emit({ type: 'draft', rect: r });
    }
  }

  cancelDraft(): void {
    const d = this._draft;
    if (!d) return;
    this._draft = null;
    this.emit({ type: 'draft', rect: d.dirty });
  }

  /** Commits the draft as one history entry. Returns false when nothing changed. */
  commitDraft(label: string): boolean {
    const d = this._draft;
    if (!d) return false;
    this._draft = null;
    const rect = d.original.diffBounds(d.buffer);
    if (!rect) {
      this.emit({ type: 'draft', rect: d.dirty });
      return false;
    }
    this.writeCel(label, d.layerId, d.frameId, [{ rect, pixels: d.buffer.extract(rect) }]);
    return true;
  }

  /**
   * Writes pixel regions into a cel as a single history entry, creating the
   * cel or un-sharing a linked image first (copy-on-write).
   */
  writeCel(
    label: string,
    layerId: LayerId,
    frameId: FrameId,
    regions: { rect: Rect; pixels: PixelBuffer }[],
    ctxAfter?: EditorContext,
  ): void {
    const key = celKey(layerId, frameId);
    let state = this.state;
    const newImages: ImageId[] = [];
    let imageId = state.cels[key];
    let img = imageId ? this.doc.images.get(imageId) : undefined;
    if (!imageId || !img || this.isShared(imageId)) {
      img = img ? img.clone() : new PixelBuffer(state.width, state.height);
      imageId = this.addImage(img);
      newImages.push(imageId);
      state = { ...state, cels: { ...state.cels, [key]: imageId } };
    }
    const patches: PixelPatch[] = [];
    for (const { rect, pixels } of regions) {
      const before = img.extract(rect);
      img.paste(pixels, rect.x, rect.y);
      patches.push({ imageId, rect, before, after: img.extract(rect) });
    }
    this.commit(label, state, patches, newImages, ctxAfter);
  }

  private isShared(imageId: ImageId): boolean {
    let n = 0;
    for (const id of Object.values(this.state.cels)) if (id === imageId && ++n > 1) return true;
    return false;
  }
}
