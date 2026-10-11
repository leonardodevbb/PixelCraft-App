import { CommandRegistry, type Command } from '../shortcuts/registry';
import type { ToolId } from '../editor/tools';
import { api } from './api';
import { useEditor } from './state/editor-store';
import { usePrefs } from './state/preferences';
import { closeProject, openProjectDialog, save, saveAs } from './actions/documents';
import { centerView, fitView, zoomStep, zoomTo } from './actions/view';

export const commands = new CommandRegistry();

const ed = () => useEditor.getState();
const hasDoc = (): boolean => !!ed().session;
const prefs = () => usePrefs.getState();

/** Tool shortcuts and labels; shared by the toolbar and menus. */
export const TOOL_COMMANDS: { tool: ToolId; label: string; keys: string[]; hint: string }[] = [
  { tool: 'pencil', label: 'Lápis', keys: ['B'], hint: 'Desenha pixels sólidos. Botão direito usa a cor secundária.' },
  { tool: 'brush', label: 'Pincel', keys: ['Shift+B'], hint: 'Desenha com opacidade e ponta redonda.' },
  { tool: 'eraser', label: 'Borracha', keys: ['E'], hint: 'Apaga para transparência na camada ativa.' },
  { tool: 'line', label: 'Linha', keys: ['L'], hint: 'Arraste para traçar. Shift trava em 0°, 45° e 90°.' },
  { tool: 'rect', label: 'Retângulo', keys: ['U'], hint: 'Contorno. Shift: quadrado. Alt: a partir do centro.' },
  { tool: 'rect-filled', label: 'Retângulo preenchido', keys: ['Shift+U'], hint: 'Shift: quadrado. Alt: a partir do centro.' },
  { tool: 'ellipse', label: 'Elipse', keys: ['O'], hint: 'Contorno. Shift: círculo. Alt: a partir do centro.' },
  { tool: 'ellipse-filled', label: 'Elipse preenchida', keys: ['Shift+O'], hint: 'Shift: círculo. Alt: a partir do centro.' },
  { tool: 'eyedropper', label: 'Conta-gotas', keys: ['I'], hint: 'Clique para pegar a cor. Alt com outra ferramenta também funciona.' },
  { tool: 'pan', label: 'Mão (mover vista)', keys: ['H'], hint: 'Arraste para mover a vista. Espaço também funciona.' },
];

export function registerCommands(): void {
  const list: Command[] = [
    // File
    { id: 'file.new', label: 'Novo projeto…', category: 'Arquivo', keys: ['Ctrl+N'], run: () => ed().openDialog({ type: 'new-project' }) },
    { id: 'file.open', label: 'Abrir…', category: 'Arquivo', keys: ['Ctrl+O'], run: () => openProjectDialog() },
    { id: 'file.save', label: 'Salvar', category: 'Arquivo', keys: ['Ctrl+S'], run: () => void save(), enabled: hasDoc },
    { id: 'file.saveAs', label: 'Salvar como…', category: 'Arquivo', keys: ['Ctrl+Shift+S'], run: () => void saveAs(), enabled: hasDoc },
    { id: 'file.exportPng', label: 'Exportar PNG…', category: 'Arquivo', keys: ['Ctrl+Shift+E'], run: () => ed().openDialog({ type: 'export-png' }), enabled: hasDoc },
    { id: 'file.close', label: 'Fechar projeto', category: 'Arquivo', keys: ['Ctrl+W'], run: () => closeProject(), enabled: hasDoc },
    { id: 'file.newWindow', label: 'Nova janela', category: 'Arquivo', keys: ['Ctrl+Shift+N'], run: () => api.app.newWindow() },

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

    // View
    { id: 'view.zoomIn', label: 'Aumentar zoom', category: 'Visualizar', keys: ['Plus', 'Ctrl+Plus'], repeat: true, run: () => zoomStep(1), enabled: hasDoc },
    { id: 'view.zoomOut', label: 'Diminuir zoom', category: 'Visualizar', keys: ['Minus', 'Ctrl+Minus'], repeat: true, run: () => zoomStep(-1), enabled: hasDoc },
    { id: 'view.fit', label: 'Ajustar à tela', category: 'Visualizar', keys: ['Ctrl+0'], run: () => fitView('fit'), enabled: hasDoc },
    { id: 'view.fitWidth', label: 'Ajustar à largura', category: 'Visualizar', run: () => fitView('width'), enabled: hasDoc },
    { id: 'view.fitHeight', label: 'Ajustar à altura', category: 'Visualizar', run: () => fitView('height'), enabled: hasDoc },
    { id: 'view.actualSize', label: 'Tamanho real (100%)', category: 'Visualizar', keys: ['Ctrl+1'], run: () => zoomTo(1), enabled: hasDoc },
    { id: 'view.center', label: 'Centralizar documento', category: 'Visualizar', keys: ['Ctrl+Shift+C'], run: () => centerView(), enabled: hasDoc },
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
      keys: ['Ctrl+Shift+G'],
      run: () => prefs().set({ tileGrid: !prefs().prefs.tileGrid }),
      checked: () => prefs().prefs.tileGrid,
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
    { id: 'help.shortcuts', label: 'Atalhos de teclado', category: 'Ajuda', keys: ['F1'], run: () => ed().openDialog({ type: 'shortcuts' }) },
    { id: 'help.docs', label: 'Documentação online', category: 'Ajuda', run: () => api.app.openDocs('readme') },
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
