import { describe, expect, it } from 'vitest';
import { findConflicts } from '../../src/shortcuts/keys';
import type { MenuDef } from '../../src/ui/layout/MenuBar';

// The command module expects a browser window; a bare object is enough here.
(globalThis as { window?: unknown }).window ??= {};
const { commands, registerCommands } = await import('../../src/renderer/commands');
const { buildMenus } = await import('../../src/ui/layout/menus');

describe('command registry', () => {
  registerCommands();
  it('has no conflicting default shortcuts', () => {
    expect(findConflicts(commands.bindings())).toEqual([]);
  });
  it('menus only reference registered commands', () => {
    const missing: string[] = [];
    const walk = (items: MenuDef['items']): void => {
      for (const it of items) {
        if (typeof it === 'string') {
          if (it !== '-' && !commands.get(it)) missing.push(it);
        } else walk(it.items);
      }
    };
    for (const m of buildMenus()) walk(m.items);
    expect(missing).toEqual([]);
  });
});
