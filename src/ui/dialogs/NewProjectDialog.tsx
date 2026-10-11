import { useState } from 'react';
import { newProject } from '../../renderer/actions/documents';
import { useEditor } from '../../renderer/state/editor-store';
import { checkDimensions, LIMITS } from '../../project/limits';
import { rgba } from '../../raster/color';
import { Button, Checkbox, NumberField } from '../controls';
import { Dialog } from './Dialog';
import { BUILTIN_PRESETS } from './presets';

export function NewProjectDialog() {
  const close = useEditor((s) => s.closeDialog);
  const [name, setName] = useState('Sem título');
  const [width, setWidth] = useState(32);
  const [height, setHeight] = useState(32);
  const [whiteBg, setWhiteBg] = useState(false);
  const [lock, setLock] = useState(false);
  const error = checkDimensions(width, height);
  const categories = [...new Set(BUILTIN_PRESETS.map((p) => p.category))];

  const setW = (w: number): void => {
    if (lock) setHeight(Math.max(1, Math.min(LIMITS.maxDimension, Math.round((w * height) / width))));
    setWidth(w);
  };
  const setH = (h: number): void => {
    if (lock) setWidth(Math.max(1, Math.min(LIMITS.maxDimension, Math.round((h * width) / height))));
    setHeight(h);
  };
  const create = (): void => {
    if (error) return;
    close();
    void newProject({ name, width, height, background: whiteBg ? rgba(255, 255, 255) : null });
  };

  return (
    <Dialog
      title="Novo projeto"
      onClose={close}
      width={560}
      testId="new-project-dialog"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={create} disabled={!!error} data-testid="create-project">
            Criar
          </Button>
        </>
      }
    >
      <form
        className="new-project"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <label className="field">
          <span className="field-label">Nome</span>
          <input value={name} maxLength={LIMITS.maxNameLength} onChange={(e) => setName(e.target.value)} autoFocus data-testid="project-name" />
        </label>
        <div className="row">
          <NumberField label="Largura" value={width} min={1} max={LIMITS.maxDimension} onChange={setW} suffix="px" data-testid="project-width" />
          <NumberField label="Altura" value={height} min={1} max={LIMITS.maxDimension} onChange={setH} suffix="px" data-testid="project-height" />
          <Checkbox label="Manter proporção" checked={lock} onChange={setLock} />
        </div>
        <Checkbox label="Fundo branco (em vez de transparente)" checked={whiteBg} onChange={setWhiteBg} />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="presets" aria-label="Predefinições">
          {categories.map((cat) => (
            <div key={cat} className="preset-group">
              <span className="mini-title">{cat}</span>
              <div className="preset-list">
                {BUILTIN_PRESETS.filter((p) => p.category === cat).map((p) => (
                  <button
                    type="button"
                    key={p.name}
                    className={`preset${p.width === width && p.height === height ? ' is-active' : ''}`}
                    onClick={() => {
                      setWidth(p.width);
                      setHeight(p.height);
                    }}
                  >
                    <span>{p.name}</span>
                    <small>
                      {p.width}×{p.height}
                    </small>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
