import type { DialogState } from '../../renderer/state/editor-store';
import { Button } from '../controls';
import { Dialog } from './Dialog';

export function ConfirmDialog({ d }: { d: Extract<DialogState, { type: 'confirm' }> }) {
  return (
    <Dialog
      title={d.title}
      onClose={() => d.resolve('cancel')}
      testId="confirm-dialog"
      footer={
        <>
          <Button onClick={() => d.resolve('cancel')}>{d.cancelLabel ?? 'Cancelar'}</Button>
          {d.altLabel && (
            <Button variant="danger" onClick={() => d.resolve('alt')} data-testid="confirm-alt">
              {d.altLabel}
            </Button>
          )}
          <Button variant={d.danger ? 'danger' : 'primary'} onClick={() => d.resolve('confirm')} autoFocus data-testid="confirm-ok">
            {d.confirmLabel}
          </Button>
        </>
      }
    >
      <p>{d.message}</p>
    </Dialog>
  );
}
