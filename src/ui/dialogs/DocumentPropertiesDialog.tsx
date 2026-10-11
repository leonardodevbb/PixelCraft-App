import { useState } from 'react';
import { setAnimation, setFps } from '../../editor/frame-ops';
import { allLayers, type Guide, type LoopMode, type PlayDirection } from '../../project/model';
import { saveAs } from '../../renderer/actions/documents';
import { useEditor } from '../../renderer/state/editor-store';
import { Button, NumberField, Select } from '../controls';
import { Icon } from '../Icon';
import { Dialog } from './Dialog';

/**
 * Arquivo › Propriedades do projeto: document facts plus the settings that
 * travel with the file (animation, guides, symmetry axes, tiles). Every
 * change is one undoable step.
 */
export function DocumentPropertiesDialog() {
  const close = useEditor((s) => s.closeDialog);
  const openDialog = useEditor((s) => s.openDialog);
  const session = useEditor((s) => s.session)!;
  useEditor((s) => s.revision);
  const st = session.state;
  const [axis, setAxis] = useState<Guide['axis']>('x');
  const [pos, setPos] = useState(Math.floor(st.width / 2));

  const setGuides = (guides: Guide[], label: string): void => session.apply(label, (s) => ({ ...s, guides }));
  const max = axis === 'x' ? st.width : st.height;

  return (
    <Dialog title="Propriedades do projeto" onClose={close} width={560} testId="document-properties-dialog" footer={<Button onClick={close}>Fechar</Button>}>
      <dl className="about-info">
        <dt>Nome</dt>
        <dd>
          {session.doc.name}{' '}
          <button type="button" className="link-btn" onClick={() => void saveAs()}>
            Salvar com outro nome…
          </button>
        </dd>
        <dt>Arquivo</dt>
        <dd className="mono">{session.filePath ?? 'ainda não salvo'}</dd>
        <dt>Tamanho</dt>
        <dd>
          {st.width}×{st.height} px{' '}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              close();
              openDialog({ type: 'resize-canvas' });
            }}
          >
            Alterar…
          </button>
        </dd>
        <dt>Conteúdo</dt>
        <dd>
          {allLayers(st.layers).length} camadas, {st.frames.length} quadros, {st.palette.colors.length} cores na paleta
        </dd>
      </dl>

      <h3 className="dialog-subtitle">Animação</h3>
      <div className="grid-2">
        <NumberField label="FPS (todos os quadros)" value={st.animation.fps} min={1} max={60} onChange={(fps) => setFps(session, fps)} />
        <Select<LoopMode>
          label="Repetição"
          value={st.animation.loop}
          options={[
            { value: 'loop', label: 'Repetir sempre' },
            { value: 'once', label: 'Tocar uma vez' },
            { value: 'pingpong', label: 'Vai e volta' },
          ]}
          onChange={(loop) => setAnimation(session, { loop })}
        />
        <Select<PlayDirection>
          label="Sentido"
          value={st.animation.direction}
          options={[
            { value: 'forward', label: 'Para frente' },
            { value: 'reverse', label: 'Ao contrário' },
          ]}
          onChange={(direction) => setAnimation(session, { direction })}
        />
      </div>

      <h3 className="dialog-subtitle">Guias</h3>
      <p className="muted small">Linhas de referência que aparecem só na tela de desenho, nunca nas exportações.</p>
      {st.guides.length > 0 && (
        <ul className="guide-list" data-testid="guide-list">
          {st.guides.map((g, i) => (
            <li key={`${g.axis}-${g.position}-${i}`}>
              {g.axis === 'x' ? 'Vertical' : 'Horizontal'} em {g.position} px
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remover guia ${g.axis === 'x' ? 'vertical' : 'horizontal'} em ${g.position}`}
                onClick={() => setGuides(st.guides.filter((_, n) => n !== i), 'Remover guia')}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <Select<Guide['axis']>
          label="Nova guia"
          value={axis}
          options={[
            { value: 'x', label: 'Vertical' },
            { value: 'y', label: 'Horizontal' },
          ]}
          onChange={(a) => {
            setAxis(a);
            setPos(Math.floor((a === 'x' ? st.width : st.height) / 2));
          }}
        />
        <NumberField label="Posição" value={pos} min={0} max={max} onChange={setPos} suffix="px" />
        <Button onClick={() => setGuides([...st.guides, { axis, position: Math.max(0, Math.min(max, pos)) }], 'Adicionar guia')} data-testid="guide-add">
          Adicionar
        </Button>
        {st.guides.length > 0 && (
          <Button variant="ghost" onClick={() => setGuides([], 'Remover guias')}>
            Remover todas
          </Button>
        )}
      </div>

      <h3 className="dialog-subtitle">Eixos de simetria</h3>
      <div className="grid-2">
        <NumberField
          label="Eixo vertical (X)"
          value={st.symmetry.axisX}
          min={0}
          max={st.width}
          step={0.5}
          integer={false}
          onChange={(axisX) => session.apply('Eixo de simetria', (s) => ({ ...s, symmetry: { ...s.symmetry, axisX } }))}
        />
        <NumberField
          label="Eixo horizontal (Y)"
          value={st.symmetry.axisY}
          min={0}
          max={st.height}
          step={0.5}
          integer={false}
          onChange={(axisY) => session.apply('Eixo de simetria', (s) => ({ ...s, symmetry: { ...s.symmetry, axisY } }))}
        />
      </div>
      <p className="muted small">
        Tiles: {st.tiles.width}×{st.tiles.height} px.{' '}
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            close();
            openDialog({ type: 'tileset' });
          }}
        >
          Configurar tiles…
        </button>
      </p>
    </Dialog>
  );
}
