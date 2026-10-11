import { useEffect, useRef, useState } from 'react';
import { screenToDoc, type ViewTransform } from '../../renderer-engine/viewport';
import { useEditor } from '../../renderer/state/editor-store';

export const RULER_SIZE = 18;

/** Step between labelled ticks so labels stay at least ~48 px apart. */
function tickStep(zoom: number): number {
  for (const s of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]) if (s * zoom >= 48) return s;
  return 5000;
}

function css(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function draw(canvas: HTMLCanvasElement, axis: 'x' | 'y', t: ViewTransform, size: number, hover: number | null): void {
  const dpr = window.devicePixelRatio || 1;
  const long = axis === 'x' ? canvas.clientWidth : canvas.clientHeight;
  canvas.width = Math.max(1, Math.round((axis === 'x' ? long : RULER_SIZE) * dpr));
  canvas.height = Math.max(1, Math.round((axis === 'x' ? RULER_SIZE : long) * dpr));
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css('--panel', '#24212d');
  ctx.fillRect(0, 0, axis === 'x' ? long : RULER_SIZE, axis === 'x' ? RULER_SIZE : long);
  const off = axis === 'x' ? t.offsetX : t.offsetY;
  // The document itself is highlighted so its edges are easy to find.
  ctx.fillStyle = css('--panel-2', '#302c3b');
  const a = off;
  const b = off + size * t.zoom;
  if (axis === 'x') ctx.fillRect(a, 0, b - a, RULER_SIZE);
  else ctx.fillRect(0, a, RULER_SIZE, b - a);
  const step = tickStep(t.zoom);
  const minor = step >= 10 ? step / 5 : step >= 2 ? 1 : 0;
  const first = Math.floor(-off / t.zoom / step) * step;
  const last = (long - off) / t.zoom;
  ctx.strokeStyle = css('--muted', '#8d88a0');
  ctx.fillStyle = css('--muted', '#8d88a0');
  ctx.font = '10px system-ui, sans-serif';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let v = first; v <= last; v += step) {
    const p = Math.round(off + v * t.zoom) + 0.5;
    if (axis === 'x') {
      ctx.moveTo(p, RULER_SIZE);
      ctx.lineTo(p, 4);
      ctx.fillText(String(v), p + 2, 10);
    } else {
      ctx.moveTo(RULER_SIZE, p);
      ctx.lineTo(4, p);
      ctx.save();
      ctx.translate(10, p + 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'right';
      ctx.fillText(String(v), 0, 0);
      ctx.restore();
    }
    if (minor && minor * t.zoom >= 6)
      for (let m = v + minor; m < v + step - 1e-9; m += minor) {
        const q = Math.round(off + m * t.zoom) + 0.5;
        if (axis === 'x') {
          ctx.moveTo(q, RULER_SIZE);
          ctx.lineTo(q, RULER_SIZE - 5);
        } else {
          ctx.moveTo(RULER_SIZE, q);
          ctx.lineTo(RULER_SIZE - 5, q);
        }
      }
  }
  ctx.stroke();
  if (hover !== null) {
    ctx.fillStyle = css('--accent', '#ffb454');
    const p = off + hover * t.zoom;
    const w = Math.max(1, t.zoom);
    if (axis === 'x') ctx.fillRect(p, RULER_SIZE - 4, w, 4);
    else ctx.fillRect(RULER_SIZE - 4, p, 4, w);
  }
}

/**
 * Rulers along the top and left edges of the canvas, in document pixels.
 * Dragging from a ruler onto the drawing creates a guide (top ruler →
 * horizontal guide, left ruler → vertical guide).
 */
export function Rulers({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const top = useRef<HTMLCanvasElement>(null);
  const left = useRef<HTMLCanvasElement>(null);
  const transform = useEditor((s) => s.transform);
  const hover = useEditor((s) => s.hover);
  const session = useEditor((s) => s.session);
  useEditor((s) => s.revision);
  const [drag, setDrag] = useState<{ axis: 'x' | 'y'; pos: number } | null>(null);

  useEffect(() => {
    if (!session) return;
    const redraw = (): void => {
      if (top.current) draw(top.current, 'x', transform, session.state.width, hover?.x ?? null);
      if (left.current) draw(left.current, 'y', transform, session.state.height, hover?.y ?? null);
    };
    redraw();
    const ro = new ResizeObserver(redraw);
    if (top.current) ro.observe(top.current);
    if (left.current) ro.observe(left.current);
    return () => ro.disconnect();
  }, [session, transform, hover, session?.state.width, session?.state.height]);

  if (!session) return null;

  /** Guide axis 'y' is a horizontal line (a y position); 'x' a vertical line. */
  const startDrag = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const posOf = (ev: PointerEvent | React.PointerEvent): number => {
      const d = screenToDoc(useEditor.getState().transform, ev.clientX - rect.left, ev.clientY - rect.top);
      return Math.round(axis === 'x' ? d.fx : d.fy);
    };
    setDrag({ axis, pos: posOf(e) });
    const move = (ev: PointerEvent): void => setDrag({ axis, pos: posOf(ev) });
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      const s = useEditor.getState().session;
      if (!s) return;
      const inside = axis === 'x' ? ev.clientY > rect.top + RULER_SIZE : ev.clientX > rect.left + RULER_SIZE;
      const pos = posOf(ev);
      const max = axis === 'x' ? s.state.width : s.state.height;
      if (!inside || pos <= 0 || pos >= max) return;
      if (s.state.guides.some((g) => g.axis === axis && g.position === pos)) return;
      s.apply('Adicionar guia', (st) => ({ ...st, guides: [...st.guides, { axis, position: pos }] }));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const t = transform;
  return (
    <>
      <canvas ref={top} className="ruler ruler-top" data-testid="ruler-top" onPointerDown={startDrag('y')} title="Arraste para baixo para criar uma guia horizontal" />
      <canvas ref={left} className="ruler ruler-left" data-testid="ruler-left" onPointerDown={startDrag('x')} title="Arraste para a direita para criar uma guia vertical" />
      <div className="ruler-corner" aria-hidden="true" />
      {drag && (
        <div
          className={`guide-drag guide-drag-${drag.axis}`}
          style={drag.axis === 'y' ? { top: t.offsetY + drag.pos * t.zoom } : { left: t.offsetX + drag.pos * t.zoom }}
          aria-hidden="true"
        />
      )}
    </>
  );
}
