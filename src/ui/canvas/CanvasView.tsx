import { useEffect, useRef } from 'react';
import { getTool, type ColorSlot, type Tool, type ToolHost, type ToolId, type ToolPointer } from '../../editor/tools';
import { sampleColor } from '../../editor/tools/eyedropper';
import { transformTool } from '../../editor/tools/transform-tool';
import { brushFootprint } from '../../raster/shapes';
import { toHex } from '../../raster/color';
import { CanvasRenderer, type RenderSettings } from '../../renderer-engine/canvas-renderer';
import { nextZoom, screenToDoc, zoomAround } from '../../renderer-engine/viewport';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs, type Preferences } from '../../renderer/state/preferences';
import { fitView, viewportSize } from '../../renderer/actions/view';
import { stopPlayback, togglePlayback } from '../../renderer/actions/playback';

function isTyping(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
}

const PAINT_TOOLS: ToolId[] = ['pencil', 'brush', 'eraser', 'line', 'curve', 'rect', 'rect-filled', 'ellipse', 'ellipse-filled', 'contour', 'spray', 'blur', 'jumble'];
const SIZED_TOOLS: ToolId[] = ['pencil', 'brush', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'blur', 'jumble'];
/** Tools whose tip follows a custom brush when one is set. */
const BRUSH_TOOLS: ToolId[] = ['pencil', 'brush', 'eraser', 'line', 'curve', 'rect', 'ellipse'];
/** Two-point tools keep Alt for "from the centre" instead of the eyedropper. */
const ALT_IS_MODIFIER: ToolId[] = ['line', 'curve', 'rect', 'rect-filled', 'ellipse', 'ellipse-filled'];

function renderSettings(p: Preferences): RenderSettings {
  return {
    pixelGrid: p.pixelGrid,
    pixelGridMinZoom: p.pixelGridMinZoom,
    gridColor: p.gridColor,
    tileGrid: p.tileGrid,
    tileGridColor: p.tileGridColor,
    tiledPreview: p.tiledPreview,
    checkerA: p.checkerA,
    checkerB: p.checkerB,
    checkerSize: p.checkerSize,
    workspace: getComputedStyle(document.documentElement).getPropertyValue('--workspace').trim() || '#100e16',
    canvasBackground: null,
    showSymmetryAxes: p.showSymmetryAxes,
    showGuides: p.showGuides,
    onion: { ...p.onion, beforeColor: '#ff4f81', afterColor: '#2ec4b6' },
  };
}

/** Builds the bridge tools use to read colors/options and report problems. */
function makeHost(r: CanvasRenderer): ToolHost {
  const st = useEditor.getState();
  return {
    session: st.session!,
    options: st.options,
    color: (slot: ColorSlot) => (slot === 'primary' ? useEditor.getState().primary : useEditor.getState().secondary),
    setColor: (slot, c) => useEditor.getState().setColor(slot, c),
    notify: (m) => useEditor.getState().toast('error', m),
    symmetryActive: st.symmetryOn,
    preview: (p) => {
      if (p.marquee !== undefined) r.overlay.marquee = p.marquee;
      if (p.lasso !== undefined) r.overlay.lasso = p.lasso;
      if (p.selectionOffset !== undefined) r.overlay.selectionOffset = p.selectionOffset;
      if (p.ellipse !== undefined) r.overlay.ellipse = p.ellipse;
      if (p.handles !== undefined) r.overlay.handles = p.handles;
      if (p.transformBox !== undefined) r.overlay.transformBox = p.transformBox;
      r.request();
    },
    requestText: (at) => useEditor.getState().openDialog({ type: 'text', x: at.x, y: at.y }),
    zoom: st.transform.zoom,
  };
}

let currentRenderer: CanvasRenderer | null = null;

/** A tool host bound to the visible canvas, for UI outside it (options bar, commands). */
export function canvasToolHost(): ToolHost | null {
  return currentRenderer && useEditor.getState().session ? makeHost(currentRenderer) : null;
}

interface Interaction {
  kind: 'tool' | 'pan';
  tool?: Tool;
  host?: ToolHost;
  pointerId: number;
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
  slot: ColorSlot;
}

export function CanvasView() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const session = useEditor((s) => s.session);

  // Renderer lifetime
  useEffect(() => {
    const canvas = canvasRef.current!;
    const r = new CanvasRenderer(canvas, renderSettings(usePrefs.getState().prefs));
    rendererRef.current = r;
    currentRenderer = r;
    r.transform = useEditor.getState().transform;
    const unsubEditor = useEditor.subscribe((s, prev) => {
      if (s.transform !== prev.transform) {
        r.transform = s.transform;
        r.request();
      }
      if (s.revision !== prev.revision) r.request();
      if (s.playFrameId !== prev.playFrameId) {
        r.frameOverride = s.playFrameId;
        r.invalidate();
      }
    });
    const unsubPrefs = usePrefs.subscribe((s) => {
      // Wait a frame so theme variables (read from CSS) are already applied.
      requestAnimationFrame(() => {
        r.settings = renderSettings(s.prefs);
        r.invalidateOnion();
      });
    });
    const ro = new ResizeObserver(() => {
      viewportSize.width = canvas.clientWidth;
      viewportSize.height = canvas.clientHeight;
      r.request();
    });
    ro.observe(canvas);
    // Marching ants: only animate while something is selected.
    const ants = window.setInterval(() => {
      if (r.hasAnts && document.visibilityState === 'visible') r.tickAnts();
    }, 120);
    return () => {
      window.clearInterval(ants);
      unsubEditor();
      unsubPrefs();
      ro.disconnect();
      r.dispose();
      if (currentRenderer === r) currentRenderer = null;
    };
  }, []);

  // Session wiring
  useEffect(() => {
    const r = rendererRef.current!;
    r.session = session;
    r.invalidate();
    if (!session) return;
    // A newly opened document starts fitted and centred in the viewport.
    const canvas = canvasRef.current!;
    viewportSize.width = canvas.clientWidth;
    viewportSize.height = canvas.clientHeight;
    fitView();
    return session.subscribe((e) => {
      if (e.type === 'draft') r.invalidate(e.rect);
      else r.invalidate();
    });
  }, [session]);

  // Pointer & wheel handling
  useEffect(() => {
    const canvas = canvasRef.current!;
    let active: Interaction | null = null;
    let spaceDown = false;
    /** A quick Space tap (without panning) toggles playback; holding it pans. */
    let spaceAt = 0;
    let spaceUsed = false;
    let altDown = false;
    let lastHover: { x: number; y: number } | null = null;
    let lastHoverF = { x: 0, y: 0 };

    const local = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    };

    const toPointer = (e: PointerEvent, slot: ColorSlot): ToolPointer => {
      const { sx, sy } = local(e);
      const d = screenToDoc(useEditor.getState().transform, sx, sy);
      return { ...d, slot, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, pressure: e.pressure };
    };

    const effectiveTool = (): ToolId => {
      const { tool } = useEditor.getState();
      if (altDown && PAINT_TOOLS.includes(tool) && !ALT_IS_MODIFIER.includes(tool)) return 'eyedropper';
      return tool;
    };

    const updateCursor = () => {
      const t = effectiveTool();
      let toolCursor = getTool(t)?.cursor ?? 'crosshair';
      if (t === 'transform' && lastHover && !active) {
        const kind = transformTool.hit({ x: lastHoverF.x, y: lastHoverF.y }, useEditor.getState().transform.zoom);
        toolCursor = kind === 'scale-handle' ? 'nwse-resize' : kind === 'rotate' ? 'alias' : kind === 'move' ? 'move' : 'default';
      }
      canvas.style.cursor = active?.kind === 'pan' ? 'grabbing' : spaceDown || t === 'pan' ? 'grab' : toolCursor;
    };

    const updateHover = (x: number, y: number) => {
      const st = useEditor.getState();
      const s = st.session;
      const r = rendererRef.current!;
      if (!s) return;
      const inside = x >= 0 && y >= 0 && x < s.state.width && y < s.state.height;
      const t = effectiveTool();
      if (inside && PAINT_TOOLS.includes(t)) {
        const size = SIZED_TOOLS.includes(t) ? st.options.size : 1;
        const custom = BRUSH_TOOLS.includes(t) ? st.options.customBrush : null;
        const fp = custom ? custom.pixels : t === 'spray' ? brushFootprint(Math.max(5, st.options.size), 'circle') : brushFootprint(size, t === 'brush' ? 'circle' : st.options.shape);
        r.overlay.cursorPixels = fp.map((o) => ({ x: x + o.x, y: y + o.y }));
        r.overlay.cursorColor = t === 'eraser' ? '#ffffff' : toHex(st.primary).slice(0, 7);
      } else r.overlay.cursorPixels = null;
      r.request();
      if (!lastHover || lastHover.x !== x || lastHover.y !== y) {
        lastHover = { x, y };
        st.setHover(inside ? { x, y, color: sampleColor(s, x, y, true) } : { x, y, color: null });
      }
    };

    const onDown = (e: PointerEvent) => {
      const st = useEditor.getState();
      if (!st.session || active) return;
      canvas.focus();
      if (st.playing) stopPlayback();
      spaceUsed = true;
      const isPan = e.button === 1 || spaceDown || (e.button === 0 && effectiveTool() === 'pan');
      if (e.button !== 0 && e.button !== 2 && !isPan) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const { sx, sy } = local(e);
      const slot: ColorSlot = e.button === 2 ? 'secondary' : 'primary';
      if (isPan) {
        active = { kind: 'pan', pointerId: e.pointerId, startX: sx, startY: sy, startOffsetX: st.transform.offsetX, startOffsetY: st.transform.offsetY, slot };
        updateCursor();
        return;
      }
      const tool = getTool(effectiveTool());
      if (!tool) return;
      const host = makeHost(rendererRef.current!);
      active = { kind: 'tool', tool, host, pointerId: e.pointerId, startX: sx, startY: sy, startOffsetX: 0, startOffsetY: 0, slot };
      tool.onDown(toPointer(e, slot), host);
    };

    const onMove = (e: PointerEvent) => {
      const st = useEditor.getState();
      if (!st.session) return;
      const p = toPointer(e, active?.slot ?? 'primary');
      if (active && e.pointerId === active.pointerId) {
        if (active.kind === 'pan') {
          const { sx, sy } = local(e);
          st.setTransform({ ...st.transform, offsetX: Math.round(active.startOffsetX + sx - active.startX), offsetY: Math.round(active.startOffsetY + sy - active.startY) });
          return;
        }
        // Coalesced events give every sample the OS reported between frames.
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        for (const ce of events.length ? events : [e]) active.tool!.onMove(toPointer(ce, active.slot), active.host!);
      }
      lastHoverF = { x: p.fx, y: p.fy };
      updateHover(p.x, p.y);
      if (!active && useEditor.getState().tool === 'transform') updateCursor();
    };

    const finish = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointerId) return;
      const a = active;
      active = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (a.kind === 'tool') a.tool!.onUp(toPointer(e, a.slot), a.host!);
      updateCursor();
    };

    const onCancel = (e: PointerEvent) => {
      if (!active || e.pointerId !== active.pointerId) return;
      const a = active;
      active = null;
      if (a.kind === 'tool') a.tool!.cancel(a.host!);
      updateCursor();
    };

    const onLeave = () => {
      const r = rendererRef.current!;
      r.overlay.cursorPixels = null;
      r.request();
      lastHover = null;
      useEditor.getState().setHover(null);
    };

    const onWheel = (e: WheelEvent) => {
      const st = useEditor.getState();
      if (!st.session) return;
      e.preventDefault();
      const { sx, sy } = local(e);
      if (e.shiftKey && !e.ctrlKey) {
        st.setTransform({ ...st.transform, offsetX: st.transform.offsetX - (e.deltaY || e.deltaX) });
        return;
      }
      // Trackpad two-finger scroll pans; mouse wheel (or pinch with ctrl) zooms.
      const isTrackpadPan = !e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0;
      if (isTrackpadPan) {
        st.setTransform({ ...st.transform, offsetX: st.transform.offsetX - e.deltaX, offsetY: st.transform.offsetY - e.deltaY });
        return;
      }
      if (e.deltaY === 0) return;
      const dir = e.deltaY < 0 ? 1 : -1;
      st.setTransform(zoomAround(st.transform, nextZoom(st.transform.zoom, dir), sx, sy));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ' ' && !spaceDown && !isTyping(e.target)) {
        spaceDown = true;
        spaceAt = performance.now();
        spaceUsed = false;
        e.preventDefault();
        updateCursor();
      }
      if (e.key === 'Alt') {
        altDown = true;
        e.preventDefault();
        updateCursor();
      }
      if (e.key === 'Escape' && active?.kind === 'tool') {
        active.tool!.cancel(active.host!);
        active = null;
      } else if (e.key === 'Escape' && !active && useEditor.getState().session && !isTyping(e.target)) {
        // A curve waiting for its control points is cancelled too.
        getTool(useEditor.getState().tool)?.deactivate?.(makeHost(rendererRef.current!));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && spaceDown) {
        spaceDown = false;
        updateCursor();
        const st = useEditor.getState();
        if (!spaceUsed && performance.now() - spaceAt < 300 && st.session && !st.dialog && !isTyping(e.target)) togglePlayback();
      }
      if (e.key === 'Alt') {
        altDown = false;
        updateCursor();
      }
    };
    const onBlur = () => {
      spaceDown = false;
      altDown = false;
      if (active?.kind === 'tool') active.tool!.cancel(active.host!);
      active = null;
      updateCursor();
    };
    const unsubTool = useEditor.subscribe((s, prev) => {
      // Tools that keep state between gestures (the curve) drop it when left.
      if (s.tool !== prev.tool && s.session) {
        getTool(prev.tool)?.deactivate?.(makeHost(rendererRef.current!));
        getTool(s.tool)?.activate?.(makeHost(rendererRef.current!));
      }
      if (s.tool !== prev.tool || s.options !== prev.options || s.primary !== prev.primary) {
        updateCursor();
        if (lastHover) updateHover(lastHover.x, lastHover.y);
      }
    });

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Enter applies a pending transform before it can reach the global shortcuts (play).
    const onEnterCapture = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || isTyping(e.target) || useEditor.getState().dialog) return;
      const t = getTool(useEditor.getState().tool);
      if (!t?.isPending?.() || !t.apply) return;
      e.preventDefault();
      e.stopPropagation();
      t.apply(makeHost(rendererRef.current!));
    };
    window.addEventListener('keydown', onEnterCapture, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    updateCursor();
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', finish);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onEnterCapture, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      unsubTool();
    };
  }, []);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="editor-canvas"
        tabIndex={0}
        aria-label="Área de desenho"
        data-testid="editor-canvas"
      />
    </div>
  );
}
