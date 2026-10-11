import { useEffect, useRef, useState } from 'react';
import { alpha, blue, green, hslToRgb, hsvToRgb, parseHex, red, rgba, rgbToHsl, rgbToHsv, toHex, withAlpha, type RGBA } from '../../raster/color';

interface Props {
  color: RGBA;
  onChange: (c: RGBA) => void;
  /** Called when a drag ends or a field commits (for recent colors). */
  onCommit?: (c: RGBA) => void;
}

function useDrag(onPos: (fx: number, fy: number) => void, onEnd: () => void) {
  return (e: React.PointerEvent<HTMLDivElement>): void => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const update = (ev: PointerEvent | React.PointerEvent): void => {
      const r = el.getBoundingClientRect();
      onPos(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    update(e);
    const move = (ev: PointerEvent): void => update(ev);
    const up = (): void => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      onEnd();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
}

/**
 * Visual picker (saturation/value square, hue and alpha sliders) plus HEX,
 * RGBA and HSL fields. Hue is kept in local state so it survives passing
 * through grey/black, where RGB alone cannot represent it.
 */
export function ColorPicker({ color, onChange, onCommit }: Props) {
  const [hsv, setHsv] = useState(() => rgbToHsv(color));
  const last = useRef(color);
  useEffect(() => {
    if (color !== last.current) {
      last.current = color;
      const n = rgbToHsv(color);
      setHsv((h) => ({ ...n, h: n.s === 0 || n.v === 0 ? h.h : n.h }));
    }
  }, [color]);
  const emit = (c: RGBA): void => {
    last.current = c;
    onChange(c);
  };
  const a = alpha(color);
  const sv = useDrag(
    (fx, fy) => {
      const next = { h: hsv.h, s: fx, v: 1 - fy };
      setHsv(next);
      emit(hsvToRgb(next, a));
    },
    () => onCommit?.(last.current),
  );
  const hue = useDrag(
    (fx) => {
      const next = { ...hsv, h: fx * 360 };
      setHsv(next);
      emit(hsvToRgb(next, a));
    },
    () => onCommit?.(last.current),
  );
  const alphaDrag = useDrag(
    (fx) => emit(withAlpha(color, Math.round(fx * 255))),
    () => onCommit?.(last.current),
  );
  const pure = hsvToRgb({ h: hsv.h, s: 1, v: 1 });
  const opaque = withAlpha(color, 255);
  const hsl = rgbToHsl(color);

  const keyAdjust = (e: React.KeyboardEvent, kind: 'sv' | 'h' | 'a'): void => {
    const step = e.shiftKey ? 0.1 : 0.01;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = -step;
    else if (e.key === 'ArrowDown') dy = step;
    else return;
    e.preventDefault();
    if (kind === 'sv') {
      const next = { h: hsv.h, s: Math.min(1, Math.max(0, hsv.s + dx)), v: Math.min(1, Math.max(0, hsv.v - dy)) };
      setHsv(next);
      emit(hsvToRgb(next, a));
    } else if (kind === 'h') {
      const next = { ...hsv, h: (hsv.h + (dx - dy) * 360 + 360) % 360 };
      setHsv(next);
      emit(hsvToRgb(next, a));
    } else emit(withAlpha(color, Math.min(255, Math.max(0, a + Math.round((dx - dy) * 255)))));
  };

  return (
    <div className="color-picker">
      <div
        className="sv-square"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${toHex(pure)})` }}
        onPointerDown={sv}
        role="slider"
        tabIndex={0}
        aria-label="Saturação e brilho"
        aria-valuetext={`saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%`}
        onKeyDown={(e) => keyAdjust(e, 'sv')}
      >
        <span className="sv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: toHex(opaque) }} />
      </div>
      <div className="hue-bar" onPointerDown={hue} role="slider" tabIndex={0} aria-label="Matiz" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} onKeyDown={(e) => keyAdjust(e, 'h')}>
        <span className="bar-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
      <div
        className="alpha-bar checker"
        onPointerDown={alphaDrag}
        role="slider"
        tabIndex={0}
        aria-label="Opacidade"
        aria-valuemin={0}
        aria-valuemax={255}
        aria-valuenow={a}
        onKeyDown={(e) => keyAdjust(e, 'a')}
      >
        <span className="alpha-fill" style={{ background: `linear-gradient(to right, transparent, ${toHex(opaque)})` }} />
        <span className="bar-thumb" style={{ left: `${(a / 255) * 100}%` }} />
      </div>
      <ColorFields color={color} hsl={hsl} onChange={(c) => { emit(c); onCommit?.(c); }} />
    </div>
  );
}

function Channel({ label, value, max, onCommit }: { label: string; value: number; max: number; onCommit: (v: number) => void }) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  const commit = (): void => {
    const v = Math.round(Number(t));
    if (Number.isFinite(v)) onCommit(Math.min(max, Math.max(0, v)));
    else setT(String(value));
  };
  return (
    <label className="channel">
      <span>{label}</span>
      <input value={t} inputMode="numeric" aria-label={label} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>
  );
}

function ColorFields({ color, hsl, onChange }: { color: RGBA; hsl: { h: number; s: number; l: number }; onChange: (c: RGBA) => void }) {
  const [hex, setHex] = useState(toHex(color));
  useEffect(() => setHex(toHex(color)), [color]);
  const commitHex = (): void => {
    const c = parseHex(hex);
    if (c === null) setHex(toHex(color));
    else onChange(c);
  };
  const r = red(color);
  const g = green(color);
  const b = blue(color);
  const a = alpha(color);
  return (
    <div className="color-fields">
      <label className="hex-field">
        <span>HEX</span>
        <input
          value={hex}
          spellCheck={false}
          aria-label="Cor em hexadecimal"
          onChange={(e) => setHex(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => e.key === 'Enter' && commitHex()}
          data-testid="hex-input"
        />
      </label>
      <div className="channels" aria-label="RGBA">
        <Channel label="R" value={r} max={255} onCommit={(v) => onChange(rgba(v, g, b, a))} />
        <Channel label="G" value={g} max={255} onCommit={(v) => onChange(rgba(r, v, b, a))} />
        <Channel label="B" value={b} max={255} onCommit={(v) => onChange(rgba(r, g, v, a))} />
        <Channel label="A" value={a} max={255} onCommit={(v) => onChange(rgba(r, g, b, v))} />
      </div>
      <div className="channels" aria-label="HSL">
        <Channel label="H" value={Math.round(hsl.h)} max={360} onCommit={(v) => onChange(hslToRgb({ ...hsl, h: v }, a))} />
        <Channel label="S" value={Math.round(hsl.s)} max={100} onCommit={(v) => onChange(hslToRgb({ ...hsl, s: v }, a))} />
        <Channel label="L" value={Math.round(hsl.l)} max={100} onCommit={(v) => onChange(hslToRgb({ ...hsl, l: v }, a))} />
      </div>
    </div>
  );
}
