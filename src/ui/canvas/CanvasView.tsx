import { useEffect, useRef } from 'react';
import { getTool, type ColorSlot, type Tool, type ToolHost, type ToolId, type ToolPointer } from '../../editor/tools';
import { sampleColor } from '../../editor/tools/eyedropper';
import { brushFootprint } from '../../raster/shapes';
import { toHex } from '../../raster/color';
import { CanvasRenderer, type RenderSettings } from '../../renderer-engine/canvas-renderer';
import { nextZoom, screenToDoc, zoomAround } from '../../renderer-engine/viewport';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs, type Preferences } from '../../renderer/state/preferences';
import { fitView, viewportSize } from '../../renderer/actions/view';

const PAINT_TOOLS: ToolId[] = ['pencil', 'brush', 'eraser', 'line', 'rect', 'rect-filled', 'ellipse', 'ellipse-filled'];
const SIZED_TOOLS: ToolId[] = ['pencil', 'brush', 'eraser', 'line', 'rect', 'ellipse'];

function renderSettings(p: Preferences): RenderSettings {
  return {
    pixelGrid: p.pixelGrid,
    pixelGridMinZoom: p.pixelGridMinZoom,
    gridColor: p.gridColor,
    tileGrid: p.tileGrid,
    tileGridColor: p.tileGridColor,
    checkerA: p.checkerA,
    checkerB: p.checkerB,
    checkerSize: p.checkerSize,
    workspace: getComputedStyle(document.documentElement).getPropertyValue('--workspace').trim() || '#100e16',
    canvasBackground: null,
    showSymmetryAxes: p.showSymmetryAxes,
    showGuides: true,
    onion: { ...p.onion, beforeColor: '#ff4f81', afterColor: '#2ec4b6' },
  };
}

/** Builds the bridge tools use to read colors/options and report problems. */
function makeHost(): ToolHost {
  const st = useEditor.getState();
  return {
    session: st.session!,
    options: st.options,
    color: (slot: ColorSlot) => (slot === 'primary' ? useEditor.getState().primary : useEditor.getState().secondary),
    setColor: (slot, c) => useEditor.getState().setColor(slot, c),
    notify: (m) => useEditor.getState().toast('error', m),
    symmetryActive: st.symmetryOn,
  };
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
    r.transform = useEditor.getState().transform;
    const unsubEditor = useEditor.subscribe((s, prev) => {
      if (s.transform !== prev.transform) {
        r.transform = s.transform;
        r.request();
      }
      if (s.revision !== prev.revision) r.request();
    });
    const unsubPrefs = usePrefs.subscribe((s) => {
      r.settings = renderSettings(s.prefs);
      r.invalidateOnion();
    });
    const ro = new ResizeObserver(() => {
      viewportSize.width = canvas.clientWidth;
      viewportSize.height = canvas.clientHeight;
      r.request();
    });
    ro.observe(canvas);
    return () => {
      unsubEditor();
      unsubPrefs();
      ro.disconnect();
      r.dispose();
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
    let altDown = false;
    let lastHover: { x: number; y: number } | null = null;

    const local = (e: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    };

    const toPointer = (e: PointerEvent, slot: ColorSlot): ToolPointer => {
      const { sx, sy } = local(e);
      const d = screenToDoc(useEditor.getState().transform, sx, sy);
      return { ...d, slot, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
    };

    const effectiveTool = (): ToolId => {
      const { tool } = useEditor.getState();
      if (altDown && PAINT_TOOLS.includes(tool) && !['line', 'rect', 'rect-filled', 'ellipse', 'ellipse-filled'].includes(tool)) return 'eyedropper';
      return tool;
    };

    const updateCursor = () => {
      const t = effectiveTool();
      canvas.style.cursor = active?.kind === 'pan' ? 'grabbing' : spaceDown || t === 'pan' ? 'grab' : getTool(t)?.cursor ?? 'crosshair';
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
        r.overlay.cursorPixels = brushFootprint(size, t === 'brush' ? 'circle' : st.options.shape).map((o) => ({ x: x + o.x, y: y + o.y }));
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
      const host = makeHost();
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
      updateHover(p.x, p.y);
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
      if (e.key === ' ' && !spaceDown && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceDown = true;
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
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        spaceDown = false;
        updateCursor();
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
