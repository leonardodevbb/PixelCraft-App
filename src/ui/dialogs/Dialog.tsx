import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../Icon';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Escape/backdrop close disabled (for blocking confirmations). */
  modal?: boolean;
  testId?: string;
  /** 'side': docked at the right without dimming, so the canvas preview stays visible. */
  placement?: 'center' | 'side';
}

/** Modal dialog with focus trapping, Escape to close and focus restore. */
export function Dialog({ title, onClose, children, footer, width = 460, modal, testId, placement = 'center' }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current!;
    const first = el.querySelector<HTMLElement>('[autofocus], input, select, button.btn-primary, button, [tabindex="0"]');
    first?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !modal) {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab') {
        const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"]')];
        if (!items.length) return;
        const firstEl = items[0]!;
        const lastEl = items.at(-1)!;
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose, modal]);
  const id = `dlg-${title.replace(/\W+/g, '-')}`;
  return (
    <div className={`dialog-backdrop${placement === 'side' ? ' is-side' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && !modal && placement !== 'side' && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={id} style={{ width }} ref={ref} data-testid={testId}>
        <header className="dialog-header">
          <h1 id={id}>{title}</h1>
          {!modal && (
            <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}>
              <Icon name="close" />
            </button>
          )}
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </div>
    </div>
  );
}
