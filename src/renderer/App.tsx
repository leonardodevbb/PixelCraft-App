import { useEffect, useState } from 'react';
import { CanvasView } from '../ui/canvas/CanvasView';
import { DialogHost } from '../ui/dialogs/DialogHost';
import { ColorPanel } from '../ui/panels/ColorPanel';
import { HistoryPanel } from '../ui/panels/HistoryPanel';
import { LayersPanel } from '../ui/panels/LayersPanel';
import { PalettePanel } from '../ui/panels/PalettePanel';
import { PreviewPanel } from '../ui/panels/PreviewPanel';
import { Timeline } from '../ui/timeline/Timeline';
import { StartScreen } from '../ui/StartScreen';
import { StatusBar } from '../ui/layout/StatusBar';
import { ToolBar } from '../ui/layout/ToolBar';
import { ToolOptionsBar } from '../ui/layout/ToolOptionsBar';
import { TopBar } from '../ui/layout/TopBar';
import { Toasts } from '../ui/Toasts';
import { TooltipLayer } from '../ui/Tooltip';
import { api } from './api';
import { composeFrame } from '../layers/compose';
import { allLayers, findLayer } from '../project/model';
import { commands, registerCommands } from './commands';
import { autosave, handleCloseRequest, openPath } from './actions/documents';
import { useEditor } from './state/editor-store';
import { usePrefs } from './state/preferences';

registerCommands();

function isTextInput(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLInputElement) return !['checkbox', 'radio', 'range', 'button', 'color'].includes(t.type);
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable;
}

function useTheme(): void {
  const theme = usePrefs((s) => s.prefs.theme);
  const accent = usePrefs((s) => s.prefs.accent);
  const density = usePrefs((s) => s.prefs.density);
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      root.dataset.theme = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
    };
    apply();
    root.style.setProperty('--accent', accent);
    root.dataset.density = density;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, accent, density]);
}

export function App() {
  const session = useEditor((s) => s.session);
  const dialog = useEditor((s) => s.dialog);
  const right = usePrefs((s) => s.prefs.panels.right);
  const timeline = usePrefs((s) => s.prefs.panels.timeline);
  const rightWidth = usePrefs((s) => s.prefs.panels.rightWidth);
  const shortcutOverrides = usePrefs((s) => s.prefs.shortcuts);
  const autosaveSeconds = usePrefs((s) => s.prefs.autosaveSeconds);
  useTheme();
  useEditor((s) => s.revision);

  useEffect(() => {
    void usePrefs.getState().load();
    const offClose = api.app.onCloseRequest(() => void handleCloseRequest());
    const offOpen = api.app.onOpenFile((p) => void openPath(p));
    void api.app.takeStartupFiles().then((files) => {
      if (files[0]) void openPath(files[0]);
    });
    return () => {
      offClose();
      offOpen();
    };
  }, []);

  useEffect(() => commands.setOverrides(shortcutOverrides), [shortcutOverrides]);

  // Window title reflects document and unsaved state.
  useEffect(() => {
    const title = session ? `${session.isDirty ? '• ' : ''}${session.doc.name} — PixelCraft` : 'PixelCraft';
    api.app.setTitle(title);
  });

  // Global shortcuts (ignored while typing or while a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useEditor.getState().dialog) return;
      if (isTextInput(e.target)) return;
      if ((e.target as HTMLElement | null)?.closest?.('[role="menu"]')) return;
      // Enter activates focused controls; it only plays the animation from the canvas/background.
      if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest?.('button, a, [role="option"], [role="tab"]')) return;
      commands.handleKey(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Autosave to the recovery area while there are unsaved changes.
  useEffect(() => {
    if (!autosaveSeconds) return;
    const t = setInterval(() => void autosave(), autosaveSeconds * 1000);
    return () => clearInterval(t);
  }, [autosaveSeconds]);

  return (
    <div className="app" data-has-doc={!!session} aria-hidden={dialog ? undefined : undefined}>
      <TopBar />
      {session ? (
        <div className="workspace">
          <ToolBar />
          <div className="center">
            <ToolOptionsBar />
            <CanvasView />
            {timeline && <Timeline />}
          </div>
          {right && (
            <aside className="side-panel" style={{ width: rightWidth }} aria-label="Painéis">
              <PreviewPanel />
              <ColorPanel />
              <PalettePanel />
              <SideTabs />
            </aside>
          )}
        </div>
      ) : (
        <StartScreen />
      )}
      <StatusBar />
      <DialogHost />
      <Toasts />
      <TooltipLayer />
    </div>
  );
}

/** Layers and history share the lower part of the side panel. */
function SideTabs() {
  const [tab, setTab] = useState<'layers' | 'history'>('layers');
  return (
    <div className="side-tabs">
      <div className="tabs" role="tablist" aria-label="Painéis inferiores">
        <button type="button" role="tab" aria-selected={tab === 'layers'} className={tab === 'layers' ? 'is-active' : ''} onClick={() => setTab('layers')} data-testid="tab-layers">
          Camadas
        </button>
        <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')} data-testid="tab-history">
          Histórico
        </button>
      </div>
      {tab === 'layers' ? <LayersPanel /> : <HistoryPanel />}
    </div>
  );
}

/** Read-only inspection hook used by automated UI tests and diagnostics. */
(window as unknown as { __pixelcraft: unknown }).__pixelcraft = {
  transform: () => useEditor.getState().transform,
  pixel: (x: number, y: number) => {
    const s = useEditor.getState().session;
    return s ? (s.celImage(s.activeLayerId, s.activeFrameId)?.get(x, y) ?? 0) : null;
  },
  state: () => {
    const s = useEditor.getState().session;
    if (!s) return null;
    const layers = allLayers(s.state.layers);
    return {
      width: s.state.width,
      height: s.state.height,
      layers: s.state.layers.length,
      layerNames: layers.map((l) => l.name),
      activeLayer: findLayer(s.state.layers, s.activeLayerId)?.layer.name ?? null,
      frames: s.state.frames.length,
      dirty: s.isDirty,
      path: s.filePath,
      selection: s.selection ? { ...s.selection.bounds, area: s.selection.mask.reduce((a, b) => a + b, 0) } : null,
      palette: s.state.palette.colors.length,
      history: s.history.entries.map((e) => e.label),
      tool: useEditor.getState().tool,
      activeFrame: s.state.frames.findIndex((f) => f.id === s.activeFrameId),
      durations: s.state.frames.map((f) => f.duration),
      playing: useEditor.getState().playing,
    };
  },
  /** Pixel of the visible composite of the active frame. */
  composite: (x: number, y: number) => {
    const s = useEditor.getState().session;
    return s ? composeFrame(s.state, s.lookup, s.activeFrameId).get(x, y) : null;
  },
};
