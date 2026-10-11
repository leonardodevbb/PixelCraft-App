import { useRef, useState, type DragEvent } from 'react';
import {
  addGroup,
  addLayer,
  deleteLayer,
  duplicateLayer,
  layerBelow,
  mergeDown,
  moveLayerTo,
  setGroupExpanded,
  setLayerProps,
  stepLayer,
} from '../../editor/layer-ops';
import { panelRows, slotOf } from '../../layers/tree';
import { findLayer, mapLayer, type DocState, type LayerNode } from '../../project/model';
import { BLEND_MODE_LABELS, BLEND_MODES, type BlendMode } from '../../raster/blend';
import { attempt } from '../../renderer/actions/edit';
import { commands } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { IconButton, Section, Select } from '../controls';
import { Icon } from '../Icon';

type DropPos = 'above' | 'below' | 'inside';

function LayerName({ layer, onDone }: { layer: LayerNode; onDone: () => void }) {
  const [v, setV] = useState(layer.name);
  const commit = (): void => {
    onDone();
    if (v.trim() && v !== layer.name) attempt((s) => setLayerProps(s, layer.id, { name: v }, 'Renomear camada'));
  };
  return (
    <input
      className="layer-rename"
      value={v}
      autoFocus
      aria-label="Nome da camada"
      maxLength={200}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onDone();
      }}
      onFocus={(e) => e.target.select()}
    />
  );
}

/**
 * Opacity previews live while dragging (without history) and records a
 * single undo step when the slider is released.
 */
function OpacitySlider({ layer }: { layer: LayerNode }) {
  const session = useEditor((s) => s.session)!;
  const orig = useRef<DocState | null>(null);
  const live = (opacity: number): void => {
    orig.current ??= session.state;
    session.replaceStateSilently({ ...session.state, layers: mapLayer(session.state.layers, layer.id, (l) => ({ ...l, opacity })) });
  };
  const commit = (): void => {
    const base = orig.current;
    if (!base) return;
    const value = findLayer(session.state.layers, layer.id)?.layer.opacity ?? layer.opacity;
    orig.current = null;
    session.replaceStateSilently(base);
    attempt((s) => setLayerProps(s, layer.id, { opacity: value }, 'Opacidade da camada'));
  };
  return (
    <label className="field slider-field">
      <span className="field-label">Opacidade</span>
      <input
        type="range"
        min={0}
        max={100}
        value={layer.opacity}
        onChange={(e) => live(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-valuetext={`${layer.opacity}%`}
        data-testid="layer-opacity"
      />
      <span className="slider-value">{layer.opacity}%</span>
    </label>
  );
}

export function LayersPanel() {
  const session = useEditor((s) => s.session);
  useEditor((s) => s.revision);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null; pos: DropPos } | null>(null);
  if (!session) return null;
  const st = session.state;
  const rows = panelRows(st.layers);
  const activeId = session.activeLayerId;
  const active = findLayer(st.layers, activeId)?.layer;

  const onDragOver = (e: DragEvent, layer: LayerNode): void => {
    if (!drag) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    const pos: DropPos = layer.type === 'group' && f > 0.3 && f < 0.7 ? 'inside' : f < 0.5 ? 'above' : 'below';
    if (drag.over !== layer.id || drag.pos !== pos) setDrag({ ...drag, over: layer.id, pos });
  };
  const onDrop = (e: DragEvent, target: LayerNode): void => {
    e.preventDefault();
    if (!drag || drag.id === target.id) return setDrag(null);
    const slot = slotOf(st.layers, target.id)!;
    const to =
      drag.pos === 'inside' && target.type === 'group'
        ? { parentId: target.id, index: target.children.length }
        : { parentId: slot.parentId, index: drag.pos === 'above' ? slot.index + 1 : slot.index };
    attempt((s) => moveLayerTo(s, drag.id, to));
    setDrag(null);
  };

  return (
    <Section
      title="Camadas"
      actions={
        <>
          <IconButton icon="plus" label="Nova camada" shortcut={commands.keysFor('layer.new')[0]} onClick={() => attempt((s) => addLayer(s))} data-testid="layer-add" />
          <IconButton icon="group" label="Novo grupo" shortcut={commands.keysFor('layer.newGroup')[0]} onClick={() => attempt((s) => addGroup(s))} data-testid="layer-add-group" />
          <IconButton icon="duplicate" label="Duplicar camada" shortcut={commands.keysFor('layer.duplicate')[0]} onClick={() => attempt((s) => duplicateLayer(s))} data-testid="layer-duplicate" />
          <IconButton
            icon="merge"
            label="Mesclar para baixo"
            shortcut={commands.keysFor('layer.mergeDown')[0]}
            disabled={!layerBelow(session) || active?.type !== 'pixel'}
            onClick={() => attempt((s) => mergeDown(s))}
            data-testid="layer-merge"
          />
          <IconButton icon="arrow-up" label="Subir camada" shortcut={commands.keysFor('layer.up')[0]} onClick={() => attempt((s) => stepLayer(s, s.activeLayerId, 1))} data-testid="layer-up" />
          <IconButton icon="arrow-down" label="Descer camada" shortcut={commands.keysFor('layer.down')[0]} onClick={() => attempt((s) => stepLayer(s, s.activeLayerId, -1))} data-testid="layer-down" />
          <IconButton icon="trash" label="Excluir camada" onClick={() => attempt((s) => deleteLayer(s))} data-testid="layer-delete" />
        </>
      }
    >
      {active && (
        <div className="layer-props">
          <OpacitySlider layer={active} />
          <Select<BlendMode>
            label="Mesclagem"
            value={active.blendMode}
            options={BLEND_MODES.map((m) => ({ value: m, label: BLEND_MODE_LABELS[m] }))}
            onChange={(blendMode) => attempt((s) => setLayerProps(s, active.id, { blendMode }, 'Modo de mesclagem'))}
          />
        </div>
      )}
      <ul className="layer-list" role="listbox" aria-label="Camadas (do topo para a base)" data-testid="layer-list">
        {rows.map(({ layer, depth }) => {
          const isActive = layer.id === activeId;
          const dropCls = drag?.over === layer.id ? ` drop-${drag.pos}` : '';
          return (
            <li
              key={layer.id}
              role="option"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`layer-row${isActive ? ' is-active' : ''}${layer.visible ? '' : ' is-hidden'}${dropCls}`}
              style={{ paddingLeft: 4 + depth * 14 }}
              draggable={renaming !== layer.id}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', layer.id);
                setDrag({ id: layer.id, over: null, pos: 'above' });
              }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => onDragOver(e, layer)}
              onDrop={(e) => onDrop(e, layer)}
              onClick={() => session.setActiveLayer(layer.id)}
              onDoubleClick={() => setRenaming(layer.id)}
              onKeyDown={(e) => {
                if (e.key === 'F2' || e.key === 'Enter') {
                  e.preventDefault();
                  setRenaming(layer.id);
                }
              }}
              data-testid="layer-row"
              data-layer-name={layer.name}
            >
              {layer.type === 'group' ? (
                <button
                  type="button"
                  className="layer-toggle"
                  aria-label={layer.expanded ? 'Recolher grupo' : 'Expandir grupo'}
                  aria-expanded={layer.expanded}
                  onClick={(e) => {
                    e.stopPropagation();
                    setGroupExpanded(session, layer.id, !layer.expanded);
                  }}
                >
                  <Icon name={layer.expanded ? 'chevron-down' : 'chevron-right'} size={12} />
                </button>
              ) : (
                <span className="layer-toggle" />
              )}
              <button
                type="button"
                className="layer-toggle"
                aria-label={layer.visible ? 'Ocultar camada' : 'Mostrar camada'}
                aria-pressed={layer.visible}
                data-tip={layer.visible ? 'Ocultar' : 'Mostrar'}
                onClick={(e) => {
                  e.stopPropagation();
                  attempt((s) => setLayerProps(s, layer.id, { visible: !layer.visible }, layer.visible ? 'Ocultar camada' : 'Mostrar camada'));
                }}
                data-testid="layer-visibility"
              >
                <Icon name={layer.visible ? 'eye' : 'eye-off'} size={14} />
              </button>
              <button
                type="button"
                className="layer-toggle"
                aria-label={layer.locked ? 'Desbloquear camada' : 'Bloquear camada'}
                aria-pressed={layer.locked}
                data-tip={layer.locked ? 'Desbloquear' : 'Bloquear edição'}
                onClick={(e) => {
                  e.stopPropagation();
                  attempt((s) => setLayerProps(s, layer.id, { locked: !layer.locked }, layer.locked ? 'Desbloquear camada' : 'Bloquear camada'));
                }}
                data-testid="layer-lock"
              >
                <Icon name={layer.locked ? 'lock' : 'unlock'} size={14} />
              </button>
              {layer.colorTag && <span className="layer-tag" style={{ background: layer.colorTag }} aria-hidden />}
              {layer.type === 'group' && <Icon name="group" size={12} />}
              {renaming === layer.id ? (
                <LayerName layer={layer} onDone={() => setRenaming(null)} />
              ) : (
                <span className="layer-name" title={layer.name}>
                  {layer.name}
                </span>
              )}
              {!layer.exportable && (
                <span className="layer-badge" data-tip="Não exportável" data-tip-hint="Camada de referência: fica fora das exportações.">
                  ref
                </span>
              )}
              {layer.opacity < 100 && <span className="layer-badge">{layer.opacity}%</span>}
              {layer.blendMode !== 'normal' && <span className="layer-badge">{BLEND_MODE_LABELS[layer.blendMode]}</span>}
              <button
                type="button"
                className="layer-toggle layer-more"
                aria-label="Propriedades da camada"
                data-tip="Propriedades"
                onClick={(e) => {
                  e.stopPropagation();
                  useEditor.getState().openDialog({ type: 'layer-properties', layerId: layer.id });
                }}
              >
                <Icon name="settings" size={12} />
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
