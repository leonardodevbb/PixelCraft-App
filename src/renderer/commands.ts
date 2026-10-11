import { CommandRegistry, type Command } from '../shortcuts/registry';
import type { ToolId } from '../editor/tools';
import { api } from './api';
import { useEditor } from './state/editor-store';
import { usePrefs } from './state/preferences';
import { closeProject, openProjectDialog, save, saveAs } from './actions/documents';
import { moveSelected } from '../editor/selection-ops';
import { centerView, fitView, zoomStep, zoomTo } from './actions/view';
import { attempt, copy, cut, deleteSelection, nudge, paste, selectAll } from './actions/edit';
import { confirmDialog, promptDialog } from './state/editor-store';
import { stopPlayback, togglePlayback } from './actions/playback';
import {
  addFrame,
  deleteFrame,
  duplicateFrame,
  goToFrame,
  isCelLinked,
  linkCelToPrevious,
  moveFrame,
  reverseFrames,
  setAnimation,
  setFrameDuration,
  setFrameTag,
  unlinkCel,
} from '../editor/frame-ops';
import { borderSelection, clipSelection, colorSelection, contractSelection, expandSelection, invertSelection, opaqueSelection } from '../editor/selection';
import { PixelBuffer } from '../raster/pixel-buffer';
import { brushFromSelection, flipSelectedH, flipSelectedV, rotateSelected } from '../editor/selection-ops';
import { EditorError, type EditorSession } from '../editor/session';
import {
  centerContent,
  clearCels,
  cropToSelection,
  fillCels,
  flipDocument,
  invertCels,
  rotateDocument,
  trimDocument,
} from '../editor/doc-ops';
import {
  addGroup,
  addLayer,
  deleteLayer,
  duplicateLayer,
  groupLayer,
  layerBelow,
  layerFromSelection,
  mergeDown,
  mergeVisible,
  setLayerProps,
  stepLayer,
  ungroup,
} from '../editor/layer-ops';
import { findLayer } from '../project/model';
import { panelRows } from '../layers/tree';
import { exportPaletteFile, importPaletteFile } from '../ui/panels/PalettePanel';
import { importImageAsLayer, importSpritesheet } from './actions/import';

export const commands = new CommandRegistry();

const ed = () => useEditor.getState();
const hasDoc = (): boolean => !!ed().session;
const prefs = () => usePrefs.getState();
const hasSel = (): boolean => !!ed().session?.selection;
const activeLayer = () => {
  const s = ed().session;
  return s ? findLayer(s.state.layers, s.activeLayerId)?.layer : undefined;
};
const activeIsGroup = (): boolean => activeLayer()?.type === 'group';

function frameIdx(s: EditorSession): number {
  return s.state.frames.findIndex((f) => f.id === s.activeFrameId);
}

/** Frame navigation pauses playback first so the user sees the frame they asked for. */
function frameNav(fn: (s: EditorSession) => void): void {
  const s = ed().session;
  if (!s) return;
  if (ed().playing) stopPlayback();
  fn(s);
}

/** Moves the active-layer focus through the panel order (top-most first). */
function selectAdjacentLayer(dir: 1 | -1): void {
  const s = ed().session;
  if (!s) return;
  const rows = panelRows(s.state.layers);
  const i = rows.findIndex((r) => r.layer.id === s.activeLayerId);
  const next = rows[i + dir];
  if (next) s.setActiveLayer(next.layer.id);
}

/** Tool shortcuts and labels; shared by the toolbar and menus. */
export const TOOL_COMMANDS: { tool: ToolId; label: string; keys: string[]; hint: string }[] = [
  { tool: 'pencil', label: 'Lápis', keys: ['B'], hint: 'Desenha pixels sólidos. Botão direito usa a cor secundária.' },
  { tool: 'brush', label: 'Pincel', keys: ['Shift+B'], hint: 'Desenha com opacidade e ponta redonda.' },
  { tool: 'eraser', label: 'Borracha', keys: ['E'], hint: 'Apaga para transparência na camada ativa.' },
  { tool: 'bucket', label: 'Balde de preenchimento', keys: ['G'], hint: 'Preenche área de cor parecida. Respeita a seleção e a tolerância.' },
  { tool: 'line', label: 'Linha', keys: ['L'], hint: 'Arraste para traçar. Shift trava em 0°, 45° e 90°.' },
  { tool: 'rect', label: 'Retângulo', keys: ['U'], hint: 'Contorno. Shift: quadrado. Alt: a partir do centro.' },
  { tool: 'rect-filled', label: 'Retângulo preenchido', keys: ['Shift+U'], hint: 'Shift: quadrado. Alt: a partir do centro.' },
  { tool: 'ellipse', label: 'Elipse', keys: ['O'], hint: 'Contorno. Shift: círculo. Alt: a partir do centro.' },
  { tool: 'ellipse-filled', label: 'Elipse preenchida', keys: ['Shift+O'], hint: 'Shift: círculo. Alt: a partir do centro.' },
  { tool: 'select-rect', label: 'Seleção retangular', keys: ['M'], hint: 'Shift adiciona, Alt subtrai, Shift+Alt intersecta. Clique simples desseleciona.' },
  { tool: 'select-lasso', label: 'Laço', keys: ['Q'], hint: 'Desenhe o contorno à mão livre. Shift adiciona, Alt subtrai.' },
  { tool: 'magic-wand', label: 'Varinha mágica', keys: ['W'], hint: 'Seleciona cores parecidas. Shift adiciona, Alt subtrai.' },
  { tool: 'move', label: 'Mover', keys: ['V'], hint: 'Move a seleção (ou a camada). Alt duplica, Ctrl move só o contorno. Setas: 1 px.' },
  { tool: 'text', label: 'Texto', keys: ['T'], hint: 'Clique onde o texto começa. Fonte bitmap PixelCraft Sans 5×7 com acentos.' },
  { tool: 'gradient', label: 'Degradê', keys: ['Shift+G'], hint: 'Arraste da cor primária para a secundária. Preenche a seleção ou a camada. Shift trava o ângulo.' },
  { tool: 'eyedropper', label: 'Conta-gotas', keys: ['I'], hint: 'Clique para pegar a cor. Alt com outra ferramenta também funciona.' },
  { tool: 'pan', label: 'Mão (mover vista)', keys: ['H'], hint: 'Arraste para mover a vista. Espaço também funciona.' },
  { tool: 'spray', label: 'Spray', keys: ['A'], hint: 'Borrifa pixels soltos ao redor do cursor. O tamanho define o diâmetro.' },
  { tool: 'contour', label: 'Contorno preenchido', keys: ['Shift+Q'], hint: 'Desenhe o contorno à mão livre; ao soltar, a área é preenchida.' },
  { tool: 'curve', label: 'Curva', keys: ['Shift+L'], hint: 'Arraste a linha, depois arraste duas vezes para dobrar a curva. Esc cancela.' },
  { tool: 'blur', label: 'Desfocar', keys: ['R'], hint: 'Suaviza os pixels sob o pincel. Passe de novo para desfocar mais.' },
  { tool: 'jumble', label: 'Embaralhar', keys: ['J'], hint: 'Troca pixels de lugar com os vizinhos, bom para texturas como grama e areia.' },
  { tool: 'transform', label: 'Transformar', keys: ['Ctrl+T'], hint: 'Arraste dentro para mover, nas alças para redimensionar e perto dos cantos para girar. Enter aplica, Esc cancela.' },
  { tool: 'select-ellipse', label: 'Seleção elíptica', keys: ['Shift+M'], hint: 'Shift adiciona, Alt subtrai, Shift+Alt intersecta.' },
];

export function registerCommands(): void {
  const list: Command[] = [
    // File
    { id: 'file.new', label: 'Novo projeto…', category: 'Arquivo', keys: ['Ctrl+N'], run: () => ed().openDialog({ type: 'new-project' }) },
    { id: 'file.open', label: 'Abrir…', category: 'Arquivo', keys: ['Ctrl+O'], run: () => openProjectDialog() },
    { id: 'file.save', label: 'Salvar', category: 'Arquivo', keys: ['Ctrl+S'], run: () => void save(), enabled: hasDoc },
    { id: 'file.saveAs', label: 'Salvar como…', category: 'Arquivo', keys: ['Ctrl+Shift+S'], run: () => void saveAs(), enabled: hasDoc },
    { id: 'file.exportPng', label: 'Exportar imagem (PNG, JPEG, WebP, BMP)…', category: 'Arquivo', keys: ['Ctrl+Shift+E'], run: () => ed().openDialog({ type: 'export-png' }), enabled: hasDoc },
    { id: 'file.importLayer', label: 'Importar imagem como camada…', category: 'Arquivo', keys: ['Ctrl+Shift+O'], run: () => void importImageAsLayer(), enabled: hasDoc },
    { id: 'file.importSheet', label: 'Importar spritesheet…', category: 'Arquivo', run: () => void importSpritesheet() },
    { id: 'file.exportGif', label: 'Exportar GIF animado…', category: 'Arquivo', keys: ['Ctrl+Alt+G'], run: () => ed().openDialog({ type: 'export-gif' }), enabled: hasDoc },
    { id: 'file.exportSheet', label: 'Exportar spritesheet…', category: 'Arquivo', keys: ['Ctrl+Alt+S'], run: () => ed().openDialog({ type: 'export-spritesheet' }), enabled: hasDoc },
    { id: 'file.exportTileset', label: 'Exportar tileset…', category: 'Arquivo', run: () => ed().openDialog({ type: 'tileset' }), enabled: hasDoc },
    { id: 'file.exportSequence', label: 'Exportar sequência de PNG…', category: 'Arquivo', run: () => ed().openDialog({ type: 'export-sequence' }), enabled: hasDoc },
    { id: 'file.recent', label: 'Abrir recentes…', category: 'Arquivo', keys: ['Ctrl+Shift+R'], run: () => ed().openDialog({ type: 'recent' }) },
    { id: 'file.properties', label: 'Propriedades do projeto…', category: 'Arquivo', keys: ['Ctrl+Alt+P'], run: () => ed().openDialog({ type: 'document-properties' }), enabled: hasDoc },
    { id: 'file.close', label: 'Fechar projeto', category: 'Arquivo', keys: ['Ctrl+W'], run: () => closeProject(), enabled: hasDoc },
    { id: 'file.newWindow', label: 'Nova janela', category: 'Arquivo', run: () => api.app.newWindow() },

    // Edit
    {
      id: 'edit.undo',
      label: 'Desfazer',
      category: 'Editar',
      keys: ['Ctrl+Z'],
      repeat: true,
      run: () => void ed().session?.undo(),
      enabled: () => !!ed().session?.history.canUndo,
    },
    {
      id: 'edit.redo',
      label: 'Refazer',
      category: 'Editar',
      keys: ['Ctrl+Y', 'Ctrl+Shift+Z'],
      repeat: true,
      run: () => void ed().session?.redo(),
      enabled: () => !!ed().session?.history.canRedo,
    },

    {
      id: 'edit.cut',
      label: 'Recortar',
      category: 'Editar',
      keys: ['Ctrl+X'],
      run: () => void cut(),
      enabled: hasDoc,
    },
    { id: 'edit.copy', label: 'Copiar', category: 'Editar', keys: ['Ctrl+C'], run: () => void copy(false), enabled: hasDoc },
    { id: 'edit.copyMerged', label: 'Copiar mesclado', category: 'Editar', keys: ['Ctrl+Shift+C'], run: () => void copy(true), enabled: hasDoc },
    { id: 'edit.duplicate', label: 'Duplicar seleção', category: 'Editar', keys: ['Ctrl+Shift+D'], run: () => attempt((s) => moveSelected(s, 1, 1, true)), enabled: hasSel },
    { id: 'edit.paste', label: 'Colar', category: 'Editar', keys: ['Ctrl+V'], run: () => void paste(false), enabled: hasDoc },
    { id: 'edit.pasteNewLayer', label: 'Colar em nova camada', category: 'Editar', keys: ['Ctrl+Shift+V'], run: () => void paste(true), enabled: hasDoc },
    { id: 'edit.delete', label: 'Apagar seleção', category: 'Editar', keys: ['Delete', 'Backspace'], run: () => deleteSelection(), enabled: hasDoc },
    {
      id: 'edit.fill',
      label: 'Preencher seleção com a cor primária',
      category: 'Editar',
      keys: ['Alt+Backspace'],
      run: () => attempt((s) => fillCels(s, ed().primary, 'cel')),
      enabled: hasDoc,
    },
    { id: 'select.all', label: 'Selecionar tudo', category: 'Seleção', keys: ['Ctrl+A'], run: () => selectAll(), enabled: hasDoc },
    { id: 'select.none', label: 'Desselecionar', category: 'Seleção', keys: ['Ctrl+D'], run: () => attempt((s) => s.setSelection(null)), enabled: hasSel },
    {
      id: 'select.invert',
      label: 'Inverter seleção',
      category: 'Seleção',
      keys: ['Ctrl+Shift+I'],
      run: () => attempt((s) => s.setSelection(invertSelection(s.selection, s.state.width, s.state.height), 'Inverter seleção')),
      enabled: hasDoc,
    },
    {
      id: 'select.fromLayer',
      label: 'Selecionar conteúdo da camada',
      category: 'Seleção',
      run: () =>
        attempt((s) => {
          const img = s.celImage(s.activeLayerId, s.activeFrameId);
          const sel = img ? opaqueSelection(img) : null;
          if (!sel) throw new EditorError('A camada está vazia neste quadro.');
          s.setSelection(sel, 'Selecionar conteúdo');
        }),
      enabled: hasDoc,
    },
    { id: 'select.flipH', label: 'Espelhar seleção horizontalmente', category: 'Seleção', run: () => attempt((s) => flipSelectedH(s)), enabled: hasDoc },
    { id: 'select.flipV', label: 'Espelhar seleção verticalmente', category: 'Seleção', run: () => attempt((s) => flipSelectedV(s)), enabled: hasDoc },
    { id: 'select.rotateCw', label: 'Girar seleção 90° horário', category: 'Seleção', run: () => attempt((s) => rotateSelected(s, 90)), enabled: hasDoc },
    { id: 'select.rotateCcw', label: 'Girar seleção 90° anti-horário', category: 'Seleção', run: () => attempt((s) => rotateSelected(s, 270)), enabled: hasDoc },
    { id: 'select.rotate180', label: 'Girar seleção 180°', category: 'Seleção', run: () => attempt((s) => rotateSelected(s, 180)), enabled: hasDoc },
    {
      id: 'brush.fromSelection',
      label: 'Criar pincel a partir da seleção',
      category: 'Ferramentas',
      keys: ['Ctrl+B'],
      run: () =>
        attempt((s) => {
          const brush = brushFromSelection(s);
          ed().setOptions({ customBrush: brush });
          const st = ed();
          if (!['pencil', 'brush', 'eraser', 'line', 'rect', 'ellipse', 'curve'].includes(st.tool)) st.setTool('pencil');
          st.toast('success', 'Pincel criado. Use "Pincel padrão" para voltar à ponta normal.');
        }),
      enabled: hasSel,
    },
    {
      id: 'brush.reset',
      label: 'Pincel padrão',
      category: 'Ferramentas',
      keys: ['Ctrl+Shift+B'],
      run: () => ed().setOptions({ customBrush: null }),
      enabled: () => !!ed().options.customBrush,
    },
    ...(
      [
        ['expand', 'Expandir seleção…', 'Expandir em quantos pixels?', expandSelection],
        ['contract', 'Contrair seleção…', 'Contrair em quantos pixels?', contractSelection],
        ['border', 'Borda da seleção…', 'Largura da borda em pixels', borderSelection],
      ] as const
    ).map(
      ([key, label, question, fn]): Command => ({
        id: `select.${key}`,
        label,
        category: 'Seleção',
        run: async () => {
          const v = await promptDialog({ title: label.replace('…', ''), label: question, initial: '1', confirmLabel: 'Aplicar' });
          const n = Math.round(Number(v));
          if (v === null || !Number.isFinite(n) || n < 1 || n > 100) return;
          attempt((s) => {
            if (!s.selection) throw new EditorError('Não há seleção.');
            const next = fn(s.selection, n);
            s.setSelection(next && clipSelection(next, s.state.width, s.state.height), label.replace('…', ''));
          });
        },
        enabled: hasSel,
      }),
    ),
    {
      id: 'select.byColor',
      label: 'Selecionar a cor primária na camada',
      category: 'Seleção',
      keys: ['Ctrl+Shift+A'],
      run: () =>
        attempt((s) => {
          const img = s.celImage(s.activeLayerId, s.activeFrameId) ?? new PixelBuffer(s.state.width, s.state.height);
          const sel = colorSelection(img, ed().primary, ed().options.tolerance);
          if (!sel) throw new EditorError('A cor primária não aparece nesta camada.');
          s.setSelection(sel, 'Selecionar por cor');
        }),
      enabled: hasDoc,
    },
    { id: 'select.scale', label: 'Redimensionar seleção…', category: 'Seleção', keys: ['Ctrl+Alt+T'], run: () => ed().openDialog({ type: 'scale-selection' }), enabled: hasDoc },
    ...(
      [
        ['Left', -1, 0, 'esquerda'],
        ['Right', 1, 0, 'direita'],
        ['Up', 0, -1, 'cima'],
        ['Down', 0, 1, 'baixo'],
      ] as const
    ).flatMap(([key, dx, dy, name]): Command[] => [
      { id: `select.nudge${key}`, label: `Mover 1 px para ${name}`, category: 'Seleção', keys: [key], repeat: true, hidden: true, run: () => nudge(dx, dy), enabled: hasDoc },
      { id: `select.nudge${key}10`, label: `Mover 10 px para ${name}`, category: 'Seleção', keys: [`Shift+${key}`], repeat: true, hidden: true, run: () => nudge(dx * 10, dy * 10), enabled: hasDoc },
    ]),
    { id: 'edit.preferences', label: 'Preferências…', category: 'Editar', keys: ['Ctrl+,'], run: () => ed().openDialog({ type: 'preferences' }) },

    // Image
    { id: 'image.resizeCanvas', label: 'Tamanho da tela…', category: 'Imagem', keys: ['Ctrl+Alt+C'], run: () => ed().openDialog({ type: 'resize-canvas' }), enabled: hasDoc },
    { id: 'image.resize', label: 'Redimensionar imagem…', category: 'Imagem', keys: ['Ctrl+Alt+I'], run: () => ed().openDialog({ type: 'resize-content' }), enabled: hasDoc },
    { id: 'image.crop', label: 'Recortar para a seleção', category: 'Imagem', run: () => attempt((s) => cropToSelection(s)), enabled: hasSel },
    { id: 'image.trim', label: 'Aparar bordas transparentes', category: 'Imagem', run: () => attempt((s) => trimDocument(s)), enabled: hasDoc },
    { id: 'image.rotateCw', label: 'Girar 90° horário', category: 'Imagem', run: () => attempt((s) => rotateDocument(s, 90)), enabled: hasDoc },
    { id: 'image.rotateCcw', label: 'Girar 90° anti-horário', category: 'Imagem', run: () => attempt((s) => rotateDocument(s, 270)), enabled: hasDoc },
    { id: 'image.rotate180', label: 'Girar 180°', category: 'Imagem', run: () => attempt((s) => rotateDocument(s, 180)), enabled: hasDoc },
    { id: 'image.flipH', label: 'Espelhar horizontalmente', category: 'Imagem', run: () => attempt((s) => flipDocument(s, 'h')), enabled: hasDoc },
    { id: 'image.flipV', label: 'Espelhar verticalmente', category: 'Imagem', run: () => attempt((s) => flipDocument(s, 'v')), enabled: hasDoc },
    { id: 'image.offset', label: 'Deslocar…', category: 'Imagem', keys: ['Shift+X'], run: () => ed().openDialog({ type: 'offset' }), enabled: hasDoc },
    { id: 'image.center', label: 'Centralizar conteúdo da camada', category: 'Imagem', run: () => attempt((s) => centerContent(s, 'cel')), enabled: hasDoc },
    { id: 'image.invert', label: 'Inverter cores', category: 'Imagem', keys: ['Ctrl+I'], run: () => attempt((s) => invertCels(s, 'cel')), enabled: hasDoc },
    { id: 'image.replaceColor', label: 'Substituir cor…', category: 'Imagem', keys: ['Shift+R'], run: () => ed().openDialog({ type: 'replace-color' }), enabled: hasDoc },
    { id: 'image.clearLayer', label: 'Limpar camada', category: 'Imagem', run: () => attempt((s) => clearCels(s, 'cel')), enabled: hasDoc },
    { id: 'image.clearFrame', label: 'Limpar quadro (todas as camadas)', category: 'Imagem', run: () => attempt((s) => clearCels(s, 'frame')), enabled: hasDoc },
    {
      id: 'image.clearAll',
      label: 'Limpar documento inteiro…',
      category: 'Imagem',
      run: async () => {
        const c = await confirmDialog({
          title: 'Limpar documento',
          message: 'Apagar os pixels de todas as camadas desbloqueadas em todos os quadros? É possível desfazer com Ctrl+Z.',
          confirmLabel: 'Limpar tudo',
          danger: true,
        });
        if (c === 'confirm') attempt((s) => clearCels(s, 'all'));
      },
      enabled: hasDoc,
    },

    // Layer
    { id: 'layer.new', label: 'Nova camada', category: 'Camada', keys: ['Ctrl+Shift+N'], run: () => attempt((s) => addLayer(s)), enabled: hasDoc },
    { id: 'layer.newGroup', label: 'Novo grupo', category: 'Camada', run: () => attempt((s) => addGroup(s)), enabled: hasDoc },
    { id: 'layer.group', label: 'Agrupar camada', category: 'Camada', keys: ['Ctrl+G'], run: () => attempt((s) => groupLayer(s)), enabled: hasDoc },
    { id: 'layer.ungroup', label: 'Desagrupar', category: 'Camada', keys: ['Ctrl+Shift+G'], run: () => attempt((s) => ungroup(s)), enabled: activeIsGroup },
    { id: 'layer.duplicate', label: 'Duplicar camada', category: 'Camada', keys: ['Ctrl+J'], run: () => attempt((s) => duplicateLayer(s)), enabled: hasDoc },
    { id: 'layer.delete', label: 'Excluir camada', category: 'Camada', keys: ['Ctrl+Shift+Delete'], run: () => attempt((s) => deleteLayer(s)), enabled: hasDoc },
    { id: 'layer.rename', label: 'Propriedades da camada…', category: 'Camada', keys: ['F2'], run: () => attempt((s) => ed().openDialog({ type: 'layer-properties', layerId: s.activeLayerId })), enabled: hasDoc },
    { id: 'layer.mergeDown', label: 'Mesclar para baixo', category: 'Camada', keys: ['Ctrl+E'], run: () => attempt((s) => mergeDown(s)), enabled: () => !!ed().session && !!layerBelow(ed().session!) },
    { id: 'layer.mergeVisible', label: 'Mesclar visíveis', category: 'Camada', keys: ['Ctrl+Alt+E'], run: () => attempt((s) => mergeVisible(s)), enabled: hasDoc },
    { id: 'layer.up', label: 'Subir camada', category: 'Camada', keys: ['Ctrl+]'], run: () => attempt((s) => stepLayer(s, s.activeLayerId, 1)), enabled: hasDoc },
    { id: 'layer.down', label: 'Descer camada', category: 'Camada', keys: ['Ctrl+['], run: () => attempt((s) => stepLayer(s, s.activeLayerId, -1)), enabled: hasDoc },
    { id: 'layer.selectAbove', label: 'Selecionar camada acima', category: 'Camada', keys: ['Alt+]'], run: () => selectAdjacentLayer(-1), enabled: hasDoc },
    { id: 'layer.selectBelow', label: 'Selecionar camada abaixo', category: 'Camada', keys: ['Alt+['], run: () => selectAdjacentLayer(1), enabled: hasDoc },
    {
      id: 'layer.toggleVisible',
      label: 'Mostrar/ocultar camada',
      category: 'Camada',
      run: () => attempt((s) => setLayerProps(s, s.activeLayerId, { visible: !activeLayer()!.visible }, 'Visibilidade da camada')),
      enabled: hasDoc,
      checked: () => !!activeLayer()?.visible,
    },
    {
      id: 'layer.toggleLock',
      label: 'Bloquear camada',
      category: 'Camada',
      run: () => attempt((s) => setLayerProps(s, s.activeLayerId, { locked: !activeLayer()!.locked }, 'Bloqueio da camada')),
      enabled: hasDoc,
      checked: () => !!activeLayer()?.locked,
    },
    {
      id: 'layer.toggleExport',
      label: 'Incluir nas exportações',
      category: 'Camada',
      run: () => attempt((s) => setLayerProps(s, s.activeLayerId, { exportable: !activeLayer()!.exportable }, 'Exportação da camada')),
      enabled: hasDoc,
      checked: () => !!activeLayer()?.exportable,
    },
    { id: 'layer.fromSelectionCopy', label: 'Nova camada por cópia da seleção', category: 'Camada', keys: ['Ctrl+Alt+J'], run: () => attempt((s) => layerFromSelection(s, false)), enabled: hasSel },
    { id: 'layer.fromSelectionCut', label: 'Nova camada por recorte da seleção', category: 'Camada', keys: ['Ctrl+Shift+J'], run: () => attempt((s) => layerFromSelection(s, true)), enabled: hasSel },

    // Animation
    { id: 'anim.play', label: 'Reproduzir / pausar', category: 'Animação', keys: ['Enter'], run: () => togglePlayback(), enabled: () => (ed().session?.state.frames.length ?? 0) > 1, checked: () => ed().playing },
    {
      id: 'anim.stop',
      label: 'Parar (voltar ao primeiro quadro)',
      category: 'Animação',
      run: () => {
        stopPlayback();
        const s = ed().session;
        if (s) s.setActiveFrame(s.state.frames[0]!.id);
      },
      enabled: hasDoc,
    },
    ...(['loop', 'once', 'pingpong'] as const).map(
      (loop): Command => ({
        id: `anim.loop.${loop}`,
        label: { loop: 'Repetir sempre', once: 'Tocar uma vez', pingpong: 'Vai e volta' }[loop],
        category: 'Animação',
        run: () => attempt((s) => setAnimation(s, { loop })),
        checked: () => ed().session?.state.animation.loop === loop,
        enabled: hasDoc,
      }),
    ),
    {
      id: 'anim.direction',
      label: 'Tocar ao contrário',
      category: 'Animação',
      run: () => attempt((s) => setAnimation(s, { direction: s.state.animation.direction === 'reverse' ? 'forward' : 'reverse' })),
      checked: () => ed().session?.state.animation.direction === 'reverse',
      enabled: hasDoc,
    },
    { id: 'anim.prev', label: 'Quadro anterior', category: 'Animação', keys: [','], repeat: true, run: () => frameNav((s) => goToFrame(s, -1)), enabled: hasDoc },
    { id: 'anim.next', label: 'Próximo quadro', category: 'Animação', keys: ['.'], repeat: true, run: () => frameNav((s) => goToFrame(s, 1)), enabled: hasDoc },
    { id: 'anim.first', label: 'Primeiro quadro', category: 'Animação', keys: ['Home'], run: () => frameNav((s) => s.setActiveFrame(s.state.frames[0]!.id)), enabled: hasDoc },
    { id: 'anim.last', label: 'Último quadro', category: 'Animação', keys: ['End'], run: () => frameNav((s) => s.setActiveFrame(s.state.frames.at(-1)!.id)), enabled: hasDoc },
    { id: 'anim.newFrame', label: 'Novo quadro', category: 'Animação', keys: ['Alt+N'], run: () => attempt((s) => addFrame(s)), enabled: hasDoc },
    { id: 'anim.duplicateFrame', label: 'Duplicar quadro', category: 'Animação', keys: ['Alt+D'], run: () => attempt((s) => duplicateFrame(s)), enabled: hasDoc },
    { id: 'anim.duplicateLinked', label: 'Duplicar quadro com células vinculadas', category: 'Animação', keys: ['Alt+Shift+D'], run: () => attempt((s) => duplicateFrame(s, true)), enabled: hasDoc },
    { id: 'anim.deleteFrame', label: 'Excluir quadro', category: 'Animação', keys: ['Alt+Delete'], run: () => attempt((s) => deleteFrame(s)), enabled: () => (ed().session?.state.frames.length ?? 0) > 1 },
    { id: 'anim.moveLeft', label: 'Mover quadro para a esquerda', category: 'Animação', keys: ['Alt+Left'], run: () => attempt((s) => moveFrame(s, s.activeFrameId, frameIdx(s) - 1)), enabled: hasDoc },
    { id: 'anim.moveRight', label: 'Mover quadro para a direita', category: 'Animação', keys: ['Alt+Right'], run: () => attempt((s) => moveFrame(s, s.activeFrameId, frameIdx(s) + 1)), enabled: hasDoc },
    { id: 'anim.reverse', label: 'Inverter ordem dos quadros', category: 'Animação', run: () => attempt((s) => reverseFrames(s)), enabled: hasDoc },
    {
      id: 'anim.duration',
      label: 'Duração do quadro…',
      category: 'Animação',
      run: async () => {
        const s = ed().session;
        if (!s) return;
        const f = s.state.frames.find((x) => x.id === s.activeFrameId)!;
        const v = await promptDialog({ title: 'Duração do quadro', label: 'Milissegundos', initial: String(f.duration), confirmLabel: 'Aplicar' });
        if (v !== null && Number.isFinite(Number(v))) attempt((x) => setFrameDuration(x, [x.activeFrameId], Number(v)));
      },
      enabled: hasDoc,
    },
    {
      id: 'anim.durationAll',
      label: 'Aplicar duração a todos os quadros…',
      category: 'Animação',
      run: async () => {
        const s = ed().session;
        if (!s) return;
        const f = s.state.frames.find((x) => x.id === s.activeFrameId)!;
        const v = await promptDialog({ title: 'Duração de todos os quadros', label: 'Milissegundos', initial: String(f.duration), confirmLabel: 'Aplicar a todos' });
        if (v !== null && Number.isFinite(Number(v))) attempt((x) => setFrameDuration(x, x.state.frames.map((fr) => fr.id), Number(v)));
      },
      enabled: hasDoc,
    },
    {
      id: 'anim.tag',
      label: 'Marcador do quadro…',
      category: 'Animação',
      run: async () => {
        const s = ed().session;
        if (!s) return;
        const f = s.state.frames.find((x) => x.id === s.activeFrameId)!;
        const v = await promptDialog({ title: 'Marcador do quadro', label: 'Nome (ex.: andar, pular). O marcador vale até o próximo.', initial: f.tag ?? '', confirmLabel: 'Aplicar' });
        if (v !== null) attempt((x) => setFrameTag(x, f.id, v));
      },
      enabled: hasDoc,
    },
    { id: 'anim.clearTag', label: 'Remover marcador do quadro', category: 'Animação', run: () => attempt((s) => setFrameTag(s, s.activeFrameId, null)), enabled: () => !!ed().session?.state.frames.find((f) => f.id === ed().session?.activeFrameId)?.tag },
    { id: 'anim.linkPrev', label: 'Vincular célula ao quadro anterior', category: 'Animação', run: () => attempt((s) => linkCelToPrevious(s)), enabled: hasDoc },
    { id: 'anim.unlink', label: 'Desvincular célula', category: 'Animação', run: () => attempt((s) => unlinkCel(s)), enabled: () => !!ed().session && isCelLinked(ed().session!, ed().session!.activeLayerId, ed().session!.activeFrameId) },
    {
      id: 'anim.onion',
      label: 'Onion skin',
      category: 'Animação',
      keys: ['F3'],
      run: () => prefs().set({ onion: { ...prefs().prefs.onion, enabled: !prefs().prefs.onion.enabled } }),
      checked: () => prefs().prefs.onion.enabled,
    },
    {
      id: 'view.timeline',
      label: 'Linha do tempo',
      category: 'Visualizar',
      keys: ['Shift+Tab'],
      run: () => prefs().set({ panels: { ...prefs().prefs.panels, timeline: !prefs().prefs.panels.timeline } }),
      checked: () => prefs().prefs.panels.timeline,
    },

    // Palette
    { id: 'palette.import', label: 'Importar paleta…', category: 'Paleta', run: () => void importPaletteFile(), enabled: hasDoc },
    { id: 'palette.export', label: 'Exportar paleta…', category: 'Paleta', run: () => void exportPaletteFile(), enabled: hasDoc },
    { id: 'palette.tools', label: 'Ferramentas de paleta…', category: 'Paleta', run: () => ed().openDialog({ type: 'palette-tools' }), enabled: hasDoc },

    // View
    { id: 'view.zoomIn', label: 'Aumentar zoom', category: 'Visualizar', keys: ['Plus', 'Ctrl+Plus'], repeat: true, run: () => zoomStep(1), enabled: hasDoc },
    { id: 'view.zoomOut', label: 'Diminuir zoom', category: 'Visualizar', keys: ['Minus', 'Ctrl+Minus'], repeat: true, run: () => zoomStep(-1), enabled: hasDoc },
    { id: 'view.fit', label: 'Ajustar à tela', category: 'Visualizar', keys: ['Ctrl+0'], run: () => fitView('fit'), enabled: hasDoc },
    { id: 'view.fitWidth', label: 'Ajustar à largura', category: 'Visualizar', run: () => fitView('width'), enabled: hasDoc },
    { id: 'view.fitHeight', label: 'Ajustar à altura', category: 'Visualizar', run: () => fitView('height'), enabled: hasDoc },
    { id: 'view.actualSize', label: 'Tamanho real (100%)', category: 'Visualizar', keys: ['Ctrl+1'], run: () => zoomTo(1), enabled: hasDoc },
    { id: 'view.center', label: 'Centralizar documento', category: 'Visualizar', keys: ['Ctrl+Shift+0'], run: () => centerView(), enabled: hasDoc },
    {
      id: 'view.pixelGrid',
      label: 'Grade de pixels',
      category: 'Visualizar',
      keys: ["Ctrl+'"],
      run: () => prefs().set({ pixelGrid: !prefs().prefs.pixelGrid }),
      checked: () => prefs().prefs.pixelGrid,
    },
    {
      id: 'view.tileGrid',
      label: 'Grade de tiles',
      category: 'Visualizar',
      keys: ["Ctrl+Shift+'"],
      run: () => prefs().set({ tileGrid: !prefs().prefs.tileGrid }),
      checked: () => prefs().prefs.tileGrid,
    },
    {
      id: 'view.guides',
      label: 'Mostrar guias',
      category: 'Visualizar',
      keys: ['Ctrl+;'],
      run: () => prefs().set({ showGuides: !prefs().prefs.showGuides }),
      checked: () => prefs().prefs.showGuides,
    },
    { id: 'view.editGuides', label: 'Guias e eixos de simetria…', category: 'Visualizar', run: () => ed().openDialog({ type: 'document-properties' }), enabled: hasDoc },
    {
      id: 'view.tiledPreview',
      label: 'Mosaico (repetir a imagem ao redor)',
      category: 'Visualizar',
      keys: ['Ctrl+Shift+T'],
      run: () => prefs().set({ tiledPreview: !prefs().prefs.tiledPreview }),
      checked: () => prefs().prefs.tiledPreview,
    },
    {
      id: 'image.tiles',
      label: 'Tiles e tileset…',
      category: 'Imagem',
      run: () => ed().openDialog({ type: 'tileset' }),
      enabled: hasDoc,
    },
    {
      id: 'view.rightPanel',
      label: 'Painel lateral',
      category: 'Visualizar',
      keys: ['Tab'],
      run: () => prefs().set({ panels: { ...prefs().prefs.panels, right: !prefs().prefs.panels.right } }),
      checked: () => prefs().prefs.panels.right,
    },
    { id: 'view.fullscreen', label: 'Tela cheia', category: 'Visualizar', keys: ['F11'], run: () => void api.app.toggleFullscreen() },
    {
      id: 'view.theme.dark',
      label: 'Tema escuro',
      category: 'Visualizar',
      run: () => prefs().set({ theme: 'dark' }),
      checked: () => prefs().prefs.theme === 'dark',
    },
    {
      id: 'view.theme.light',
      label: 'Tema claro',
      category: 'Visualizar',
      run: () => prefs().set({ theme: 'light' }),
      checked: () => prefs().prefs.theme === 'light',
    },
    {
      id: 'view.theme.system',
      label: 'Tema do sistema',
      category: 'Visualizar',
      run: () => prefs().set({ theme: 'system' }),
      checked: () => prefs().prefs.theme === 'system',
    },

    // Colors
    { id: 'color.swap', label: 'Trocar cores primária e secundária', category: 'Cores', keys: ['X'], run: () => ed().swapColors() },
    { id: 'color.reset', label: 'Restaurar cores padrão', category: 'Cores', keys: ['D'], run: () => ed().resetColors() },

    // Help
    { id: 'help.commandPalette', label: 'Paleta de comandos…', category: 'Ajuda', keys: ['Ctrl+K', 'Ctrl+Shift+P'], run: () => ed().openDialog({ type: 'command-palette' }) },
    { id: 'help.shortcuts', label: 'Atalhos de teclado', category: 'Ajuda', keys: ['F1'], run: () => ed().openDialog({ type: 'shortcuts' }) },
    { id: 'help.docs', label: 'Documentação online', category: 'Ajuda', run: () => api.app.openDocs('readme') },
    { id: 'help.tutorial', label: 'Primeiros passos', category: 'Ajuda', run: () => ed().openDialog({ type: 'tutorial' }) },
    { id: 'help.diagnostics', label: 'Informações de diagnóstico', category: 'Ajuda', run: () => ed().openDialog({ type: 'diagnostics' }) },
    { id: 'help.about', label: 'Sobre o PixelCraft', category: 'Ajuda', run: () => ed().openDialog({ type: 'about' }) },

    // Tools
    ...TOOL_COMMANDS.map(
      (t): Command => ({
        id: `tool.${t.tool}`,
        label: t.label,
        category: 'Ferramentas',
        keys: t.keys,
        run: () => ed().setTool(t.tool),
        checked: () => ed().tool === t.tool,
      }),
    ),
    {
      id: 'tool.sizeUp',
      label: 'Aumentar tamanho da ponta',
      category: 'Ferramentas',
      keys: [']'],
      repeat: true,
      run: () => ed().setOptions({ size: Math.min(64, ed().options.size + 1) }),
    },
    {
      id: 'tool.sizeDown',
      label: 'Diminuir tamanho da ponta',
      category: 'Ferramentas',
      keys: ['['],
      repeat: true,
      run: () => ed().setOptions({ size: Math.max(1, ed().options.size - 1) }),
    },
  ];
  commands.register(list);
}
