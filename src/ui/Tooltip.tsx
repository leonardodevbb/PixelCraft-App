import { useEffect, useState } from 'react';

interface TipState {
  label: string;
  hint?: string;
  shortcut?: string;
  x: number;
  y: number;
  below: boolean;
}

/**
 * One tooltip for the whole app: any element with data-tip shows its name,
 * optional data-tip-hint (purpose) and data-tip-key (shortcut) after a short
 * delay, both on hover and on keyboard focus.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: HTMLElement | null = null;
    const show = (el: HTMLElement, delay: number): void => {
      if (timer) clearTimeout(timer);
      current = el;
      timer = setTimeout(() => {
        if (current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 80;
        setTip({
          label: el.dataset.tip ?? '',
          hint: el.dataset.tipHint,
          shortcut: el.dataset.tipKey,
          x: Math.min(window.innerWidth - 140, Math.max(140, r.left + r.width / 2)),
          y: below ? r.bottom + 8 : r.top - 8,
          below,
        });
      }, delay);
    };
    const hide = (): void => {
      if (timer) clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const over = (e: Event): void => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (!el) {
        if (current) hide();
        return;
      }
      if (el !== current) show(el, 450);
    };
    const focus = (e: FocusEvent): void => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
      if (el && (e.target as HTMLElement).matches(':focus-visible')) show(el, 150);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);
  if (!tip) return null;
  return (
    <div
      className={`tooltip${tip.below ? ' below' : ''}`}
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      <div className="tooltip-title">
        <span>{tip.label}</span>
        {tip.shortcut && <kbd>{tip.shortcut}</kbd>}
      </div>
      {tip.hint && <div className="tooltip-hint">{tip.hint}</div>}
    </div>
  );
}
