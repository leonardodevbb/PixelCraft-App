import { TOOL_COMMANDS, commands } from '../../renderer/commands';
import { useEditor } from '../../renderer/state/editor-store';
import { toCss } from '../../raster/color';
import { IconButton } from '../controls';
import type { IconName } from '../icon-data';
import { Icon } from '../Icon';

const ICON_FOR: Record<string, IconName> = {
  pencil: 'pencil',
  brush: 'brush',
  eraser: 'eraser',
  line: 'line',
  rect: 'rect',
  'rect-filled': 'rect-filled',
  ellipse: 'ellipse',
  'ellipse-filled': 'ellipse-filled',
  bucket: 'bucket',
  eyedropper: 'eyedropper',
  'select-rect': 'select-rect',
  'select-lasso': 'select-lasso',
  'magic-wand': 'magic-wand',
  move: 'move',
  text: 'text',
  gradient: 'gradient',
  pan: 'pan',
  spray: 'spray',
  contour: 'contour',
  curve: 'curve',
  blur: 'blur',
  jumble: 'jumble',
  'select-ellipse': 'select-ellipse',
};

/** Groups shown in the toolbar, separated by dividers. */
export const TOOL_GROUPS: string[][] = [
  ['pencil', 'brush', 'spray', 'eraser', 'bucket'],
  ['line', 'curve', 'rect', 'rect-filled', 'ellipse', 'ellipse-filled', 'contour', 'gradient'],
  ['blur', 'jumble'],
  ['select-rect', 'select-ellipse', 'select-lasso', 'magic-wand', 'move'],
  ['eyedropper', 'text', 'pan'],
];

export function ToolBar() {
  const tool = useEditor((s) => s.tool);
  const primary = useEditor((s) => s.primary);
  const secondary = useEditor((s) => s.secondary);
  const available = new Set(TOOL_COMMANDS.map((t) => t.tool as string));
  return (
    <nav className="toolbar" aria-label="Ferramentas">
      {TOOL_GROUPS.map((g, i) => {
        const items = g.filter((t) => available.has(t));
        if (!items.length) return null;
        return (
          <div className="tool-group" key={i} role="group">
            {items.map((t) => {
              const def = TOOL_COMMANDS.find((d) => d.tool === t)!;
              return (
                <IconButton
                  key={t}
                  icon={ICON_FOR[t] ?? 'pencil'}
                  label={def.label}
                  hint={def.hint}
                  shortcut={commands.keysFor(`tool.${t}`)[0]}
                  active={tool === t}
                  size={18}
                  onClick={() => useEditor.getState().setTool(def.tool)}
                  data-testid={`tool-${t}`}
                />
              );
            })}
          </div>
        );
      })}
      <div className="toolbar-colors">
        <button
          type="button"
          className="swatch swatch-secondary"
          style={{ '--swatch': toCss(secondary) } as React.CSSProperties}
          aria-label="Cor secundária"
          data-tip="Cor secundária"
          data-tip-hint="Usada com o botão direito do mouse."
          onClick={() => useEditor.getState().swapColors()}
        />
        <button
          type="button"
          className="swatch swatch-primary"
          style={{ '--swatch': toCss(primary) } as React.CSSProperties}
          aria-label="Cor primária"
          data-tip="Cor primária"
          data-tip-hint="Usada com o botão esquerdo do mouse."
        />
        <button type="button" className="swap-btn" aria-label="Trocar cores" data-tip="Trocar cores" data-tip-key="X" onClick={() => useEditor.getState().swapColors()}>
          <Icon name="swap" size={12} />
        </button>
      </div>
    </nav>
  );
}
