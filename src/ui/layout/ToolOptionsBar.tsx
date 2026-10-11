import { TOOL_COMMANDS, commands } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { useEffect, useState } from 'react';
import { Checkbox, IconButton, NumberField, Select, Slider } from '../controls';
import type { ToolHost } from '../../editor/tools';
import { transformTool } from '../../editor/tools/transform-tool';
import { TRANSFORM_ALGORITHM_LABELS, type TransformAlgorithm } from '../../raster/transform';
import { canvasToolHost } from '../canvas/CanvasView';
import type { ToolId } from '../../editor/tools';
import { DITHER_LABELS, type DitherMode } from '../../raster/gradient';
import { INK_LABELS, type InkMode } from '../../editor/painter';

const SIZED: ToolId[] = ['pencil', 'brush', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'spray', 'blur', 'jumble'];
const SHAPED: ToolId[] = ['pencil', 'eraser', 'line', 'curve', 'rect', 'ellipse', 'blur', 'jumble'];
const PAINTING: ToolId[] = ['pencil', 'brush', 'eraser', 'line', 'curve', 'rect', 'rect-filled', 'ellipse', 'ellipse-filled', 'contour', 'spray', 'bucket'];
/** Tools that paint through the ink (the eraser and the bucket always replace). */
const INKED: ToolId[] = ['pencil', 'brush', 'line', 'curve', 'rect', 'rect-filled', 'ellipse', 'ellipse-filled', 'contour', 'spray'];
const PIXEL_PERFECT: ToolId[] = ['pencil', 'brush', 'eraser'];
/** Tools whose tip can be replaced by a brush made from a selection. */
const CUSTOM_BRUSH: ToolId[] = ['pencil', 'brush', 'eraser', 'line', 'curve', 'rect', 'ellipse'];

const INK_HINTS: Record<InkMode, string> = {
  simple: 'Pinta a cor escolhida.',
  'lock-alpha': 'Só pinta onde já há pixels e mantém a transparência deles. Ótimo para sombrear dentro do contorno.',
  shading: 'Clareia ou escurece seguindo a ordem da paleta: botão esquerdo avança para a próxima cor, direito volta. Organize as cores da paleta em rampas.',
};

function TransformOptions() {
  const [, force] = useState(0);
  useEffect(() => transformTool.subscribe(() => force((n) => n + 1)), []);
  const algorithm = useEditor((s) => s.options.transformAlgorithm);
  const info = transformTool.info;
  const host = (): ToolHost | null => canvasToolHost();
  return (
    <>
      <Select<TransformAlgorithm>
        label="Rotação"
        value={algorithm}
        options={(Object.keys(TRANSFORM_ALGORITHM_LABELS) as TransformAlgorithm[]).map((value) => ({ value, label: TRANSFORM_ALGORITHM_LABELS[value] }))}
        onChange={(transformAlgorithm) => {
          useEditor.getState().setOptions({ transformAlgorithm });
          const h = host();
          if (h) transformTool.refresh(h);
        }}
      />
      {info ? (
        <>
          <NumberField label="Ângulo" value={info.angle} min={-180} max={180} integer={false} suffix="°" onChange={(angle) => host() && transformTool.setParams(host()!, { angle })} data-testid="transform-angle" />
          <NumberField label="Largura" value={info.scaleX} min={-1000} max={1000} integer={false} suffix="%" onChange={(v) => host() && transformTool.setParams(host()!, { sx: v / 100 })} data-testid="transform-sx" />
          <NumberField label="Altura" value={info.scaleY} min={-1000} max={1000} integer={false} suffix="%" onChange={(v) => host() && transformTool.setParams(host()!, { sy: v / 100 })} data-testid="transform-sy" />
          <span className="muted">
            {info.width}×{info.height} px
          </span>
          <IconButton icon="flip" label="Espelhar na horizontal" onClick={() => host() && transformTool.flip(host()!, 'h')} />
          <button type="button" className="btn btn-primary" onClick={() => host() && transformTool.apply(host()!)} data-testid="transform-apply">
            Aplicar
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => host() && transformTool.cancel(host()!)}>
            Cancelar
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-ghost" onClick={() => host() && transformTool.begin(host()!)} data-testid="transform-begin">
          Começar
        </button>
      )}
    </>
  );
}

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
      {CUSTOM_BRUSH.includes(tool) && o.customBrush && (
        <span className="option-group" role="group" aria-label="Pincel personalizado">
          <span className="tool-badge" data-tip="Pincel personalizado" data-tip-hint="Criado a partir de uma seleção. Substitui o tamanho e a ponta.">
            Pincel personalizado · {o.customBrush.pixels.length} px
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => commands.execute('brush.reset')} data-testid="brush-reset">
            Pincel padrão
          </button>
        </span>
      )}
      {SIZED.includes(tool) && !(CUSTOM_BRUSH.includes(tool) && o.customBrush) && (
        <NumberField label="Tamanho" value={o.size} min={1} max={64} onChange={(size) => set({ size })} suffix="px" data-testid="opt-size" />
      )}
      {SHAPED.includes(tool) && !(CUSTOM_BRUSH.includes(tool) && o.customBrush) && (
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
      {INKED.includes(tool) && (
        <span className="ink-field" data-tip="Tinta" data-tip-hint={INK_HINTS[o.ink]}>
          <Select<InkMode>
            label="Tinta"
            value={o.ink}
            options={(Object.keys(INK_LABELS) as InkMode[]).map((value) => ({ value, label: INK_LABELS[value] }))}
            onChange={(ink) => set({ ink })}
          />
        </span>
      )}
      {PIXEL_PERFECT.includes(tool) && (
        <Checkbox
          label="Pixel perfeito"
          checked={o.pixelPerfect}
          onChange={(pixelPerfect) => set({ pixelPerfect })}
          hint="Remove os cantos em L do traço com ponta de 1 px, deixando linhas e curvas limpas."
        />
      )}
      {tool === 'spray' && (
        <Slider label="Densidade" value={o.sprayDensity} min={1} max={100} onChange={(sprayDensity) => set({ sprayDensity })} format={(v) => `${v}%`} />
      )}
      {(tool === 'brush' || tool === 'spray') && <Slider label="Opacidade" value={o.opacity} min={1} max={100} onChange={(opacity) => set({ opacity })} format={(v) => `${v}%`} />}
      {(tool === 'bucket' || tool === 'magic-wand') && (
        <>
          <NumberField label="Tolerância" value={o.tolerance} min={0} max={100} onChange={(tolerance) => set({ tolerance })} suffix="%" data-testid="opt-tolerance" />
          <Checkbox label="Contíguo" checked={o.contiguous} onChange={(contiguous) => set({ contiguous })} hint="Desmarcado: afeta todos os pixels de cor parecida no quadro, conectados ou não." />
          <Checkbox label="Amostrar composição visível" checked={o.sampleMerged} onChange={(sampleMerged) => set({ sampleMerged })} hint="Usa as cores de todas as camadas visíveis para decidir a área." />
        </>
      )}
      {tool === 'gradient' && (
        <>
          <Select
            label="Forma"
            value={o.gradientShape}
            options={[
              { value: 'linear', label: 'Linear' },
              { value: 'radial', label: 'Radial' },
            ]}
            onChange={(gradientShape) => set({ gradientShape })}
          />
          <Select
            label="Pontilhado"
            value={o.dither}
            options={(Object.keys(DITHER_LABELS) as DitherMode[]).map((value) => ({ value, label: DITHER_LABELS[value] }))}
            onChange={(dither) => set({ dither })}
          />
        </>
      )}
      {tool === 'text' && (
        <>
          <NumberField label="Escala" value={o.textScale} min={1} max={16} onChange={(textScale) => set({ textScale })} suffix="×" />
          <NumberField label="Espaçamento" value={o.letterSpacing} min={0} max={16} onChange={(letterSpacing) => set({ letterSpacing })} suffix="px" />
        </>
      )}
      {tool === 'transform' && <TransformOptions />}
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
