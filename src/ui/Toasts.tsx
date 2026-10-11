import { useEditor } from '../renderer/state/editor-store';
import { Icon } from './Icon';

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} data-testid={`toast-${t.kind}`}>
          <span className="toast-icon" aria-hidden="true">
            {t.kind === 'error' ? '!' : t.kind === 'success' ? '✓' : 'i'}
          </span>
          <span className="toast-msg">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Dispensar" onClick={() => dismiss(t.id)}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
