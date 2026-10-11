import { useState } from 'react';
import { setLayerProps } from '../../editor/layer-ops';
import { findLayer } from '../../project/model';
import { BLEND_MODE_LABELS, BLEND_MODES, type BlendMode } from '../../raster/blend';
import { attempt } from '../../renderer/actions/edit';
import { useEditor } from '../../renderer/state/editor-store';
import { Button, Checkbox, Select, Slider } from '../controls';
import { Dialog } from './Dialog';

export const TAG_COLORS = ['#ff4f81', '#ff7a3d', '#ffd23f', '#73b73e', '#2ec4b6', '#4f9cff', '#7b5cff', '#8e8aa6'];

export function LayerPropertiesDialog({ layerId }: { layerId: string }) {
  const close = useEditor((s) => s.closeDialog);
  const session = useEditor((s) => s.session)!;
  const layer = findLayer(session.state.layers, layerId)?.layer;
  const [name, setName] = useState(layer?.name ?? '');
  const [opacity, setOpacity] = useState(layer?.opacity ?? 100);
  const [blendMode, setBlend] = useState<BlendMode>(layer?.blendMode ?? 'normal');
  const [colorTag, setTag] = useState<string | null>(layer?.colorTag ?? null);
  const [exportable, setExportable] = useState(layer?.exportable ?? true);
  if (!layer) return null;
  const apply = (): void => {
    close();
    attempt((s) => setLayerProps(s, layerId, { name, opacity, blendMode, colorTag, exportable }, layer.type === 'group' ? 'Propriedades do grupo' : 'Propriedades da camada'));
  };
  return (
    <Dialog
      title={layer.type === 'group' ? 'Propriedades do grupo' : 'Propriedades da camada'}
      onClose={close}
      testId="layer-properties-dialog"
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={apply} disabled={!name.trim()} data-testid="layer-props-apply">
            Aplicar
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        className="form-grid"
      >
        <label className="field">
          <span className="field-label">Nome</span>
          <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus data-testid="layer-props-name" />
        </label>
        <Slider label="Opacidade" value={opacity} min={0} max={100} onChange={setOpacity} format={(v) => `${v}%`} />
        <Select<BlendMode> label="Modo de mesclagem" value={blendMode} options={BLEND_MODES.map((m) => ({ value: m, label: BLEND_MODE_LABELS[m] }))} onChange={setBlend} />
        <div className="field">
          <span className="field-label">Cor de identificação</span>
          <div className="tag-row" role="radiogroup" aria-label="Cor de identificação">
            <button type="button" role="radio" aria-checked={colorTag === null} className={`tag-swatch none${colorTag === null ? ' is-active' : ''}`} aria-label="Nenhuma" onClick={() => setTag(null)} />
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={colorTag === c}
                aria-label={c}
                className={`tag-swatch${colorTag === c ? ' is-active' : ''}`}
                style={{ background: c }}
                onClick={() => setTag(c)}
              />
            ))}
          </div>
        </div>
        <Checkbox
          label="Incluir nas exportações"
          checked={exportable}
          onChange={setExportable}
          hint="Desmarque para usar como camada de referência ou guia: ela aparece no editor, mas não em PNG, GIF ou spritesheet."
        />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
