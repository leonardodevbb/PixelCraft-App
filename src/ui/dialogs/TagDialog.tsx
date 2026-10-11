import { useState } from 'react';
import { TAG_COLORS, TAG_DIRECTION_LABELS, tagRange } from '../../animation/tags';
import { addTag, removeTag, updateTag } from '../../editor/frame-ops';
import type { TagDirection } from '../../project/model';
import { attempt } from '../../renderer/actions/edit';
import { useEditor } from '../../renderer/state/editor-store';
import { Button, NumberField, Select } from '../controls';
import { Dialog } from './Dialog';

/**
 * Creates or edits an animation tag: name, colour, frames, playback direction
 * and repetitions. Frame numbers are shown 1-based like on the timeline.
 */
export function TagDialog({ tagId, from, to }: { tagId?: string; from?: number; to?: number }) {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const st = session.state;
  const tag = tagId ? st.tags.find((t) => t.id === tagId) : undefined;
  const range = tag ? tagRange(st, tag) : null;
  const active = st.frames.findIndex((f) => f.id === session.activeFrameId);
  const [name, setName] = useState(tag?.name ?? `Tag ${st.tags.length + 1}`);
  const [color, setColor] = useState(tag?.color ?? TAG_COLORS[st.tags.length % TAG_COLORS.length]!);
  const [direction, setDirection] = useState<TagDirection>(tag?.direction ?? 'forward');
  const [repeat, setRepeat] = useState(tag?.repeat ?? 0);
  const [first, setFirst] = useState((range?.from ?? from ?? active) + 1);
  const [last, setLast] = useState((range?.to ?? to ?? active) + 1);
  const n = st.frames.length;
  const apply = (): void => {
    if (!name.trim()) return;
    close();
    attempt((s) => {
      if (tag) {
        const a = s.state.frames[Math.min(first, last) - 1]!;
        const b = s.state.frames[Math.max(first, last) - 1]!;
        updateTag(s, tag.id, { name, color, direction, repeat, from: a.id, to: b.id });
      } else addTag(s, first - 1, last - 1, { name, color, direction, repeat });
    });
  };
  return (
    <Dialog
      title={tag ? 'Editar tag' : 'Nova tag de animação'}
      onClose={close}
      testId="tag-dialog"
      footer={
        <>
          {tag && (
            <Button
              variant="danger"
              onClick={() => {
                close();
                attempt((s) => removeTag(s, tag.id));
              }}
              data-testid="tag-delete"
            >
              Excluir tag
            </Button>
          )}
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={apply} disabled={!name.trim()} data-testid="tag-apply">
            {tag ? 'Aplicar' : 'Criar tag'}
          </Button>
        </>
      }
    >
      <p className="dialog-note">Uma tag dá nome a um trecho da animação (andar, pular, atacar). Ela pode ser tocada e exportada sozinha.</p>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <label className="field">
          <span className="field-label">Nome</span>
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus data-testid="tag-name" />
        </label>
        <div className="row">
          <NumberField label="Do quadro" value={first} min={1} max={n} onChange={setFirst} data-testid="tag-from" />
          <NumberField label="Até o quadro" value={last} min={1} max={n} onChange={setLast} data-testid="tag-to" />
        </div>
        <Select<TagDirection>
          label="Direção"
          value={direction}
          options={(Object.keys(TAG_DIRECTION_LABELS) as TagDirection[]).map((value) => ({ value, label: TAG_DIRECTION_LABELS[value] }))}
          onChange={setDirection}
        />
        <NumberField label="Repetições (0 = sempre)" value={repeat} min={0} max={1000} onChange={setRepeat} />
        <div className="field">
          <span className="field-label">Cor</span>
          <div className="tag-row" role="radiogroup" aria-label="Cor da tag">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                className={`tag-swatch${color === c ? ' is-active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
