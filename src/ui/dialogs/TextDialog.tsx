import { useEffect, useRef, useState } from 'react';
import { addLayerWithImage } from '../../editor/layer-ops';
import { drawTextIntoDraft, textBounds, textImage } from '../../editor/text-ops';
import { attempt } from '../../renderer/actions/edit';
import { EditorError } from '../../editor/session';
import { useEditor } from '../../renderer/state/editor-store';
import { Button, Checkbox, NumberField, Select } from '../controls';
import { Dialog } from './Dialog';

/**
 * Text editor docked at the side: the text is drawn into a draft on the
 * active cel as you type (live preview on the canvas) and committed as one
 * history entry on "Aplicar".
 */
export function TextDialog({ x: x0, y: y0 }: { x: number; y: number }) {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session);
  const options = useEditor((s) => s.options);
  const color = useEditor((s) => s.primary);
  const set = useEditor.getState().setOptions;
  const [text, setText] = useState('');
  const [pos, setPos] = useState({ x: x0, y: y0 });
  const [error, setError] = useState<string | null>(null);
  const [newLayer, setNewLayer] = useState(false);
  const committed = useRef(false);

  const layout = { scale: options.textScale, letterSpacing: options.letterSpacing, lineSpacing: options.lineSpacing, align: options.textAlign };

  // Open a draft for the lifetime of the dialog; cancel it unless applied.
  useEffect(() => {
    if (!session) return;
    try {
      session.beginDraft();
    } catch (e) {
      setError(e instanceof EditorError ? e.message : String(e));
    }
    return () => {
      if (!committed.current) session.cancelDraft();
    };
  }, [session]);

  useEffect(() => {
    if (!session?.draft) return;
    drawTextIntoDraft(session, text, pos.x, pos.y, { ...layout, color });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, text, pos.x, pos.y, color, options.textScale, options.letterSpacing, options.lineSpacing, options.textAlign]);

  const apply = (): void => {
    if (!session || !text) return;
    if (newLayer) {
      session.cancelDraft();
      const img = textImage(session.state.width, session.state.height, text, pos.x, pos.y, { ...layout, color });
      attempt((s) => addLayerWithImage(s, text.split('\n')[0]!.slice(0, 40) || 'Texto', img, 0, 0, 'Texto em nova camada'));
    } else {
      committed.current = true;
      session.commitDraft('Texto');
    }
    close();
  };
  const b = textBounds(text || ' ', pos.x, pos.y, layout);

  return (
    <Dialog
      title="Texto"
      onClose={close}
      width={340}
      placement="side"
      testId="text-dialog"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={apply} disabled={!text || (!!error && !newLayer)} data-testid="text-apply">
            Aplicar
          </Button>
        </>
      }
    >
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <label className="field">
        <span className="field-label">Texto</span>
        <textarea
          autoFocus
          rows={3}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              apply();
            }
          }}
          data-testid="text-input"
          aria-describedby="text-help"
        />
      </label>
      <p id="text-help" className="muted small">
        Enter quebra a linha; Ctrl+Enter aplica. Usa a cor primária e respeita a seleção.
      </p>
      <div className="row">
        <NumberField label="X" value={pos.x} min={-4096} max={4096} onChange={(x) => setPos((p) => ({ ...p, x }))} />
        <NumberField label="Y" value={pos.y} min={-4096} max={4096} onChange={(y) => setPos((p) => ({ ...p, y }))} />
        <NumberField label="Escala" value={options.textScale} min={1} max={16} onChange={(textScale) => set({ textScale })} suffix="×" data-testid="text-scale" />
      </div>
      <div className="row">
        <NumberField label="Espaço entre letras" value={options.letterSpacing} min={0} max={16} onChange={(letterSpacing) => set({ letterSpacing })} />
        <NumberField label="Entre linhas" value={options.lineSpacing} min={0} max={32} onChange={(lineSpacing) => set({ lineSpacing })} />
      </div>
      <Select
        label="Alinhamento"
        value={options.textAlign}
        options={[
          { value: 'left', label: 'Esquerda' },
          { value: 'center', label: 'Centro' },
          { value: 'right', label: 'Direita' },
        ]}
        onChange={(textAlign) => set({ textAlign })}
      />
      <Checkbox label="Criar em uma nova camada" checked={newLayer} onChange={setNewLayer} hint="Deixa o texto separado do desenho, fácil de mover ou apagar depois." />
      <p className="muted small" data-testid="text-size">
        Bloco de {b.w}×{b.h} px em ({pos.x}, {pos.y}).
      </p>
    </Dialog>
  );
}
