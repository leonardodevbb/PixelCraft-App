import { create } from 'zustand';
import type { EditorSession } from '../../editor/session';
import { DEFAULT_TOOL_OPTIONS, type ColorSlot, type ToolId, type ToolOptions } from '../../editor/tools';
import { rgba, type RGBA } from '../../raster/color';
import type { ViewTransform } from '../../renderer-engine/viewport';

export interface HoverInfo {
  x: number;
  y: number;
  color: RGBA | null;
}

export type DialogState =
  | { type: 'new-project' }
  | { type: 'export-png' }
  | { type: 'about' }
  | { type: 'shortcuts' }
  | { type: 'preferences' }
  | { type: 'resize-canvas' }
  | { type: 'resize-content' }
  | { type: 'document-properties' }
  | { type: 'export-gif' }
  | { type: 'export-spritesheet' }
  | { type: 'export-sequence' }
  | { type: 'import-image'; file: { name: string; data: Uint8Array } }
  | { type: 'import-spritesheet'; file?: { name: string; data: Uint8Array } }
  | { type: 'layer-properties'; layerId: string }
  | { type: 'frame-duration' }
  | { type: 'palette-tools' }
  | { type: 'command-palette' }
  | { type: 'tutorial' }
  | { type: 'diagnostics' }
  | { type: 'text'; x: number; y: number }
  | { type: 'tileset' }
  | { type: 'offset' }
  | { type: 'replace-color' }
  | { type: 'scale-selection' }
  | { type: 'history' }
  | {
      type: 'prompt';
      title: string;
      label: string;
      initial: string;
      confirmLabel?: string;
      resolve: (value: string | null) => void;
    }
  | {
      type: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      cancelLabel?: string;
      /** Optional third choice (e.g. "Salvar"). */
      altLabel?: string;
      danger?: boolean;
      resolve: (choice: 'confirm' | 'alt' | 'cancel') => void;
    };

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
  action?: { label: string; run: () => void };
}

interface EditorStore {
  session: EditorSession | null;
  /** Bumped on document/context changes (not on every draft stroke). */
  revision: number;
  tool: ToolId;
  /** Tool used before a temporary switch (e.g. holding Alt for the eyedropper). */
  options: ToolOptions;
  /** Brush size remembered per tool. */
  sizes: Partial<Record<ToolId, number>>;
  primary: RGBA;
  secondary: RGBA;
  transform: ViewTransform;
  hover: HoverInfo | null;
  symmetryOn: boolean;
  playing: boolean;
  /** Frame shown while the animation plays (the edited frame stays active). */
  playFrameId: string | null;
  dialog: DialogState | null;
  toasts: Toast[];
  busy: string | null;

  setSession(s: EditorSession | null): void;
  bump(): void;
  setTool(t: ToolId): void;
  setOptions(p: Partial<ToolOptions>): void;
  setColor(slot: ColorSlot, c: RGBA): void;
  swapColors(): void;
  resetColors(): void;
  setTransform(t: ViewTransform): void;
  setHover(h: HoverInfo | null): void;
  openDialog(d: DialogState): void;
  closeDialog(): void;
  toast(kind: Toast['kind'], message: string, action?: Toast['action']): void;
  dismissToast(id: number): void;
  setBusy(msg: string | null): void;
}

let toastId = 0;
let unsubscribe: (() => void) | null = null;

export const DEFAULT_PRIMARY = rgba(27, 23, 38);
export const DEFAULT_SECONDARY = rgba(255, 255, 255);

export const useEditor = create<EditorStore>((set, get) => ({
  session: null,
  revision: 0,
  tool: 'pencil',
  options: { ...DEFAULT_TOOL_OPTIONS },
  sizes: {},
  primary: DEFAULT_PRIMARY,
  secondary: DEFAULT_SECONDARY,
  transform: { zoom: 8, offsetX: 0, offsetY: 0 },
  hover: null,
  symmetryOn: true,
  playing: false,
  playFrameId: null,
  dialog: null,
  toasts: [],
  busy: null,

  setSession(s) {
    unsubscribe?.();
    unsubscribe = s
      ? s.subscribe((e) => {
          if (e.type !== 'draft') set((st) => ({ revision: st.revision + 1 }));
        })
      : null;
    set((st) => ({ session: s, revision: st.revision + 1, hover: null, playing: false, playFrameId: null }));
  },
  bump: () => set((st) => ({ revision: st.revision + 1 })),
  setTool(t) {
    const { tool, options, sizes } = get();
    if (t === tool) return;
    const nextSizes = { ...sizes, [tool]: options.size };
    set({ tool: t, sizes: nextSizes, options: { ...options, size: nextSizes[t] ?? options.size } });
  },
  setOptions: (p) => set((st) => ({ options: { ...st.options, ...p } })),
  setColor: (slot, c) => set(slot === 'primary' ? { primary: c } : { secondary: c }),
  swapColors: () => set((st) => ({ primary: st.secondary, secondary: st.primary })),
  resetColors: () => set({ primary: DEFAULT_PRIMARY, secondary: DEFAULT_SECONDARY }),
  setTransform: (t) => set({ transform: t }),
  setHover: (h) => set({ hover: h }),
  openDialog: (d) => set({ dialog: d }),
  closeDialog: () => set({ dialog: null }),
  toast(kind, message, action) {
    const id = ++toastId;
    set((st) => ({ toasts: [...st.toasts.slice(-3), { id, kind, message, action }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000);
  },
  dismissToast: (id) => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })),
  setBusy: (busy) => set({ busy }),
}));

/** Asks the user to confirm; resolves with the chosen button. */
export function confirmDialog(opts: Omit<Extract<DialogState, { type: 'confirm' }>, 'type' | 'resolve'>): Promise<'confirm' | 'alt' | 'cancel'> {
  return new Promise((resolve) => {
    useEditor.getState().openDialog({
      type: 'confirm',
      ...opts,
      resolve: (c) => {
        useEditor.getState().closeDialog();
        resolve(c);
      },
    });
  });
}

/** Asks for a short text (Electron has no window.prompt). Resolves null on cancel. */
export function promptDialog(opts: { title: string; label: string; initial?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    useEditor.getState().openDialog({
      type: 'prompt',
      initial: '',
      ...opts,
      resolve: (v) => {
        useEditor.getState().closeDialog();
        resolve(v);
      },
    });
  });
}
