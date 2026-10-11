import { useEffect, useRef, useState } from 'react';
import { commands } from '../../renderer/commands';
import { displayChord } from '../../shortcuts/keys';
import { useEditor } from '../../renderer/state/editor-store';
import { usePrefs } from '../../renderer/state/preferences';

export type MenuItem = string | '-' | { label: string; items: MenuItem[] };

export interface MenuDef {
  label: string;
  items: MenuItem[];
}

/** Menu entries reference command ids; labels, shortcuts and state come from the registry. */
export function MenuBar({ menus }: { menus: MenuDef[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Re-render when state that affects enabled/checked flags changes.
  useEditor((s) => s.revision + (s.session ? 1 : 0));
  usePrefs((s) => s.prefs);

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: PointerEvent): void => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(null);
        (barRef.current?.querySelectorAll('.menu-title')[open] as HTMLElement | undefined)?.focus();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const focusItem = (menuIdx: number, which: 'first' | 'last' | 1 | -1): void => {
    requestAnimationFrame(() => {
      const list = barRef.current?.querySelectorAll<HTMLElement>(`[data-menu="${menuIdx}"] > li > [role^="menuitem"]:not([aria-disabled="true"])`);
      if (!list?.length) return;
      const items = [...list];
      const cur = items.indexOf(document.activeElement as HTMLElement);
      let i = which === 'first' ? 0 : which === 'last' ? items.length - 1 : (cur + which + items.length) % items.length;
      if (cur < 0 && typeof which === 'number') i = which > 0 ? 0 : items.length - 1;
      items[i]?.focus();
    });
  };

  const onTitleKey = (e: React.KeyboardEvent, i: number): void => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(i);
      focusItem(i, 'first');
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length;
      (barRef.current?.querySelectorAll<HTMLElement>('.menu-title')[n])?.focus();
      if (open !== null) setOpen(n);
    }
  };

  const onListKey = (e: React.KeyboardEvent, i: number): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(i, e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length;
      setOpen(n);
      focusItem(n, 'first');
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      focusItem(i, e.key === 'Home' ? 'first' : 'last');
    }
  };

  const run = (id: string): void => {
    setOpen(null);
    commands.execute(id);
  };

  const renderItems = (items: MenuItem[], menuIdx: number, depth = 0): React.ReactNode =>
    items.map((it, k) => {
      if (it === '-') return <li key={`s${k}`} role="separator" className="menu-sep" />;
      if (typeof it === 'object') {
        return (
          <li key={it.label} className="has-sub" role="none">
            <span role="menuitem" aria-haspopup="menu" tabIndex={-1} className="menu-item">
              <span className="menu-check" />
              <span className="menu-label">{it.label}</span>
              <span className="menu-key">›</span>
            </span>
            <ul role="menu" className="menu-list submenu" data-depth={depth + 1}>
              {renderItems(it.items, menuIdx, depth + 1)}
            </ul>
          </li>
        );
      }
      const c = commands.get(it);
      if (!c) return null;
      const enabled = commands.isEnabled(it);
      const checked = c.checked?.();
      const key = commands.keysFor(it)[0];
      return (
        <li key={it} role="none">
          <span
            role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={checked}
            aria-disabled={!enabled}
            tabIndex={-1}
            className={`menu-item${enabled ? '' : ' disabled'}`}
            data-command={it}
            onClick={() => enabled && run(it)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && enabled) {
                e.preventDefault();
                run(it);
              }
            }}
          >
            <span className="menu-check">{checked ? '✓' : ''}</span>
            <span className="menu-label">{c.label}</span>
            <span className="menu-key">{key ? displayChord(key) : ''}</span>
          </span>
        </li>
      );
    });

  return (
    <div className="menubar" role="menubar" aria-label="Menu principal" ref={barRef}>
      {menus.map((m, i) => (
        <div key={m.label} className={`menu${open === i ? ' open' : ''}`}>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === i}
            className="menu-title"
            onClick={() => setOpen(open === i ? null : i)}
            onMouseEnter={() => open !== null && setOpen(i)}
            onKeyDown={(e) => onTitleKey(e, i)}
          >
            {m.label}
          </button>
          {open === i && (
            <ul role="menu" className="menu-list" data-menu={i} aria-label={m.label} onKeyDown={(e) => onListKey(e, i)}>
              {renderItems(m.items, i)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
