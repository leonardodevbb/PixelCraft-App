import { canonical, chordFromEvent, formatChord } from './keys';

export type CommandCategory =
  | 'Arquivo'
  | 'Editar'
  | 'Imagem'
  | 'Camada'
  | 'Animação'
  | 'Visualizar'
  | 'Ferramentas'
  | 'Cores'
  | 'Ajuda'
  | 'Seleção'
  | 'Paleta';

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  /** Default shortcuts (first one is shown in menus). */
  keys?: string[];
  run: () => unknown;
  enabled?: () => boolean;
  checked?: () => boolean;
  /** Fires on key repeat too (zoom, frame stepping). */
  repeat?: boolean;
  /** Hidden from the command palette. */
  hidden?: boolean;
}

/**
 * Central list of every user action. Menus, toolbar tooltips, the shortcut
 * editor and the command palette all read from here, so each action is
 * implemented once.
 */
export class CommandRegistry {
  private commands = new Map<string, Command>();
  private overrides: Record<string, string[]> = {};
  private keymap = new Map<string, string>();

  register(cmds: Command[]): void {
    for (const c of cmds) this.commands.set(c.id, c);
    this.rebuild();
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }

  all(): Command[] {
    return [...this.commands.values()];
  }

  setOverrides(o: Record<string, string[]>): void {
    this.overrides = o;
    this.rebuild();
  }

  keysFor(id: string): string[] {
    return this.overrides[id] ?? this.commands.get(id)?.keys ?? [];
  }

  bindings(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const id of this.commands.keys()) out[id] = this.keysFor(id);
    return out;
  }

  private rebuild(): void {
    this.keymap.clear();
    for (const id of this.commands.keys()) {
      for (const k of this.keysFor(id)) {
        const c = canonical(k);
        if (c && !this.keymap.has(c)) this.keymap.set(c, id);
      }
    }
  }

  isEnabled(id: string): boolean {
    const c = this.commands.get(id);
    return !!c && (c.enabled ? c.enabled() : true);
  }

  execute(id: string): boolean {
    const c = this.commands.get(id);
    if (!c || (c.enabled && !c.enabled())) return false;
    void Promise.resolve(c.run()).catch((e) => console.error(`Comando ${id} falhou`, e));
    return true;
  }

  /** Looks up and runs the command bound to a key event. Returns true if handled. */
  handleKey(e: KeyboardEvent): boolean {
    const chord = chordFromEvent(e);
    if (!chord) return false;
    const id = this.keymap.get(formatChord(chord));
    if (!id) return false;
    const c = this.commands.get(id)!;
    if (e.repeat && !c.repeat) return true;
    e.preventDefault();
    this.execute(id);
    return true;
  }
}
