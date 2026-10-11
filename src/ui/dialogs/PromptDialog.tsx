import { useState } from 'react';
import type { DialogState } from '../../renderer/state/editor-store';
import { Button } from '../controls';
import { Dialog } from './Dialog';

export function PromptDialog({ d }: { d: Extract<DialogState, { type: 'prompt' }> }) {
  const [v, setV] = useState(d.initial);
  const ok = (): void => {
    if (v.trim()) d.resolve(v.trim());
  };
  return (
    <Dialog
      title={d.title}
      onClose={() => d.resolve(null)}
      testId="prompt-dialog"
      footer={
        <>
          <Button onClick={() => d.resolve(null)}>Cancelar</Button>
          <Button variant="primary" onClick={ok} disabled={!v.trim()} data-testid="prompt-ok">
            {d.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ok();
        }}
      >
        <label className="field">
          <span className="field-label">{d.label}</span>
          <input value={v} maxLength={200} autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)} data-testid="prompt-input" />
        </label>
      </form>
    </Dialog>
  );
}
