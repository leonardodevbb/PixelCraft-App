import { useState } from 'react';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs } from '../../renderer/state/preferences';
import { toCss, toHex, type RGBA } from '../../raster/color';
import { Section } from '../controls';
import { ColorPicker } from './ColorPicker';

export function pushRecentColor(c: RGBA): void {
  const p = usePrefs.getState();
  const list = [c, ...p.prefs.recentColors.filter((x) => x !== c)].slice(0, 16);
  p.set({ recentColors: list });
}

function Swatch({ color, label, onPick, testId, selected }: { color: RGBA; label?: string; onPick: (slot: 'primary' | 'secondary') => void; testId?: string; selected?: boolean }) {
  return (
    <button
      type="button"
      className={`palette-swatch${selected ? ' is-selected' : ''}`}
      style={{ '--swatch': toCss(color) } as React.CSSProperties}
      aria-label={label ?? toHex(color)}
      data-tip={label ?? toHex(color)}
      data-tip-hint="Clique: cor primária. Botão direito: secundária."
      onClick={() => onPick('primary')}
      onContextMenu={(e) => {
        e.preventDefault();
        onPick('secondary');
      }}
      data-testid={testId}
    />
  );
}

export function ColorPanel() {
  const primary = useEditor((s) => s.primary);
  const secondary = useEditor((s) => s.secondary);
  const recent = usePrefs((s) => s.prefs.recentColors);
  const [editing, setEditing] = useState<'primary' | 'secondary'>('primary');
  const setColor = useEditor.getState().setColor;
  const current = editing === 'primary' ? primary : secondary;
  const pick = (c: RGBA) => (slot: 'primary' | 'secondary') => {
    setColor(slot, c);
    pushRecentColor(c);
  };

  return (
    <Section title="Cores">
      <div className="color-slots" role="radiogroup" aria-label="Cor em edição">
        {(['primary', 'secondary'] as const).map((slot) => (
          <button
            key={slot}
            type="button"
            role="radio"
            aria-checked={editing === slot}
            className={`slot${editing === slot ? ' is-active' : ''}`}
            onClick={() => setEditing(slot)}
            data-testid={`slot-${slot}`}
          >
            <span className="slot-swatch checker">
              <span style={{ background: toCss(slot === 'primary' ? primary : secondary) }} />
            </span>
            <span className="slot-label">{slot === 'primary' ? 'Primária' : 'Secundária'}</span>
            <span className="slot-hex">{toHex(slot === 'primary' ? primary : secondary)}</span>
          </button>
        ))}
      </div>
      <ColorPicker color={current} onChange={(c) => setColor(editing, c)} onCommit={pushRecentColor} />
      {recent.length > 0 && (
        <div className="recent-colors">
          <span className="mini-title">Recentes</span>
          <div className="swatch-row">
            {recent.map((c) => (
              <Swatch key={c} color={c} onPick={pick(c)} />
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
