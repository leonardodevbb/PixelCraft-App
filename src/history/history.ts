import type { DocState, ImageId } from '../project/model';
import type { PixelBuffer } from '../raster/pixel-buffer';
import type { Rect } from '../raster/rect';

/** Pixels of one image region before and after an operation. */
export interface PixelPatch {
  imageId: ImageId;
  rect: Rect;
  before: PixelBuffer;
  after: PixelBuffer;
}

/**
 * One undoable operation. Every edit is described the same way: the document
 * state (immutable, shared by reference) before and after, plus the pixel
 * regions it changed in place. Applying an entry is therefore all-or-nothing,
 * and memory use is proportional to what changed, not to the document size.
 */
export interface HistoryEntry<Ctx = unknown> {
  label: string;
  before: DocState;
  after: DocState;
  patches: PixelPatch[];
  /** Images this entry introduced (counted against the memory budget). */
  newImages: ImageId[];
  /** Editor context (active layer/frame, selection) to restore with the entry. */
  ctxBefore?: Ctx;
  ctxAfter?: Ctx;
  bytes: number;
  time: number;
}

export interface HistoryOptions {
  /** Upper bound of memory retained by undo data, in bytes. */
  maxBytes: number;
  maxEntries: number;
}

export const DEFAULT_HISTORY_OPTIONS: HistoryOptions = { maxBytes: 256 * 1024 * 1024, maxEntries: 500 };

export class History<Ctx = unknown> {
  private undoStack: HistoryEntry<Ctx>[] = [];
  private redoStack: HistoryEntry<Ctx>[] = [];
  private bytes = 0;
  options: HistoryOptions;

  constructor(options: Partial<HistoryOptions> = {}) {
    this.options = { ...DEFAULT_HISTORY_OPTIONS, ...options };
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }
  get usedBytes(): number {
    return this.bytes;
  }
  /** Oldest first. */
  get entries(): readonly HistoryEntry<Ctx>[] {
    return this.undoStack;
  }
  get redoEntries(): readonly HistoryEntry<Ctx>[] {
    return this.redoStack;
  }

  push(entry: HistoryEntry<Ctx>): void {
    for (const e of this.redoStack) this.bytes -= e.bytes;
    this.redoStack = [];
    this.undoStack.push(entry);
    this.bytes += entry.bytes;
    this.trim();
  }

  /** Pops the entry to undo; the caller applies it. */
  popUndo(): HistoryEntry<Ctx> | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push(e);
    return e;
  }

  popRedo(): HistoryEntry<Ctx> | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push(e);
    return e;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }

  setOptions(opts: Partial<HistoryOptions>): void {
    this.options = { ...this.options, ...opts };
    this.trim();
  }

  private trim(): void {
    while (
      this.undoStack.length > 1 &&
      (this.bytes > this.options.maxBytes || this.undoStack.length > this.options.maxEntries)
    ) {
      const e = this.undoStack.shift()!;
      this.bytes -= e.bytes;
    }
  }

  /** Every image id referenced by retained history, used for garbage collection. */
  referencedImages(): Set<ImageId> {
    const out = new Set<ImageId>();
    const add = (e: HistoryEntry<Ctx>): void => {
      for (const id of Object.values(e.before.cels)) out.add(id);
      for (const id of Object.values(e.after.cels)) out.add(id);
      for (const p of e.patches) out.add(p.imageId);
    };
    this.undoStack.forEach(add);
    this.redoStack.forEach(add);
    return out;
  }
}

export function patchBytes(patches: PixelPatch[]): number {
  return patches.reduce((n, p) => n + p.before.data.length + p.after.data.length, 0);
}
