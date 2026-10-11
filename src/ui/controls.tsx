import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { displayChord } from '../shortcuts/keys';
import { Icon } from './Icon';
import type { IconName } from './icon-data';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  /** Extra line in the tooltip describing what the control does. */
  hint?: string;
  shortcut?: string;
  active?: boolean;
  size?: number;
}

/** Square icon button with an accessible name and a rich tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, hint, shortcut, active, size = 16, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`icon-btn${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      data-tip={label}
      data-tip-hint={hint}
      data-tip-key={shortcut ? displayChord(shortcut) : undefined}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
});

export function Button({
  children,
  variant = 'default',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost' }) {
  return (
    <button type="button" className={`btn btn-${variant}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
  id?: string;
  hideLabel?: boolean;
  integer?: boolean;
  'data-testid'?: string;
}

/** Numeric input that only commits valid values (on blur/Enter), clamped to range. */
export function NumberField({ label, value, min, max, step = 1, onChange, suffix, id, hideLabel, integer = true, ...rest }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (): void => {
    let v = Number(text.replace(',', '.'));
    if (!Number.isFinite(v)) {
      setText(String(value));
      return;
    }
    if (integer) v = Math.round(v);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setText(String(v));
    if (v !== value) onChange(v);
  };
  const fid = id ?? `nf-${label.replace(/\W+/g, '-')}`;
  return (
    <label className={`field number-field${hideLabel ? ' label-hidden' : ''}`} htmlFor={fid}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          id={fid}
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
              let v = value + d;
              if (min !== undefined) v = Math.max(min, v);
              if (max !== undefined) v = Math.min(max, v);
              onChange(v);
            }
          }}
          data-testid={rest['data-testid']}
        />
        {suffix && <span className="field-suffix">{suffix}</span>}
      </span>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="field slider-field">
      <span className="field-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={format?.(value)} />
      <span className="slider-value">{format ? format(value) : value}</span>
    </label>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="field checkbox-field" data-tip={hint ? label : undefined} data-tip-hint={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  return (
    <label className={`field select-field${hideLabel ? ' label-hidden' : ''}`}>
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} aria-label={label}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel-section" aria-label={title}>
      <header className="panel-header">
        <h2>{title}</h2>
        {actions && <div className="panel-actions">{actions}</div>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
