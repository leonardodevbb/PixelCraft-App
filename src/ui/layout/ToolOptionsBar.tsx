import { TOOL_COMMANDS } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { Checkbox, NumberField, Select, Slider } from '../controls';
import type { ToolId } from '../../editor/tools';

const SIZED: ToolId[] = ['pencil', 'brush', 'eraser', 'line', 'rect', 'ellipse'];
const SHAPED: ToolId[] = ['pencil', 'eraser', 'line', 'rect', 'ellipse'];
const PAINTING: ToolId[] = ['pencil', 'brush', 'eraser', 'line', 'rect', 'rect-filled', 'ellipse', 'ellipse-filled', 'bucket'];

/** Context options for the active tool. */
export function ToolOptionsBar() {
  const tool = useEditor((s) => s.tool);
  const o = useEditor((s) => s.options);
  const symmetryOn = useEditor((s) => s.symmetryOn);
  const session = useEditor((s) => s.session);
  useEditor((s) => s.revision);
  const set = useEditor.getState().setOptions;
  const def = TOOL_COMMANDS.find((t) => t.tool === tool);
  const sym = session?.state.symmetry;

  const setSym = (patch: Partial<NonNullable<typeof sym>>): void => {
    if (!session) return;
    session.apply('Simetria', (s) => ({ ...s, symmetry: { ...s.symmetry, ...patch } }));
  };

  return (
    <div className="tool-options" role="toolbar" aria-label="Opções da ferramenta">
      <span className="tool-name">{def?.label ?? tool}</span>
      {SIZED.includes(tool) && (
        <NumberField label="Tamanho" value={o.size} min={1} max={64} onChange={(size) => set({ size })} suffix="px" data-testid="opt-size" />
      )}
      {SHAPED.includes(tool) && (
        <Select
          label="Ponta"
          value={o.shape}
          options={[
            { value: 'square', label: 'Quadrada' },
            { value: 'circle', label: 'Circular' },
          ]}
          onChange={(shape) => set({ shape })}
        />
      )}
      {tool === 'brush' && <Slider label="Opacidade" value={o.opacity} min={1} max={100} onChange={(opacity) => set({ opacity })} format={(v) => `${v}%`} />}
      {(tool === 'bucket' || tool === 'magic-wand') && (
        <>
          <NumberField label="Tolerância" value={o.tolerance} min={0} max={100} onChange={(tolerance) => set({ tolerance })} suffix="%" data-testid="opt-tolerance" />
          <Checkbox label="Contíguo" checked={o.contiguous} onChange={(contiguous) => set({ contiguous })} hint="Desmarcado: afeta todos os pixels de cor parecida no quadro, conectados ou não." />
          <Checkbox label="Amostrar composição visível" checked={o.sampleMerged} onChange={(sampleMerged) => set({ sampleMerged })} hint="Usa as cores de todas as camadas visíveis para decidir a área." />
        </>
      )}
      {tool === 'eyedropper' && (
        <Checkbox label="Amostrar composição visível" checked={o.sampleMerged} onChange={(sampleMerged) => set({ sampleMerged })} hint="Desmarcado: pega a cor apenas da camada ativa." />
      )}
      {session && sym && PAINTING.includes(tool) && (
        <div className="option-group" role="group" aria-label="Simetria">
          <Checkbox
            label="Espelhar ↔"
            checked={sym.vertical}
            onChange={(v) => setSym({ vertical: v })}
            hint="Espelha o desenho entre esquerda e direita, em torno do eixo vertical."
          />
          <Checkbox
            label="Espelhar ↕"
            checked={sym.horizontal}
            onChange={(v) => setSym({ horizontal: v })}
            hint="Espelha o desenho entre cima e baixo, em torno do eixo horizontal."
          />
          {(sym.vertical || sym.horizontal) && (
            <Checkbox
              label="Ativa"
              checked={symmetryOn}
              onChange={(v) => useEditor.setState({ symmetryOn: v })}
              hint="Desligue temporariamente sem perder a configuração dos eixos."
            />
          )}
        </div>
      )}
      {def && <span className="tool-hint">{def.hint}</span>}
    </div>
  );
}
