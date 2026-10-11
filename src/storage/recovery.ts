import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { RecoveryEntry } from '../shared/ipc';
import { writeFileAtomic, writeJson } from '../platform/fs-atomic';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Recovery copies older than this are deleted at startup. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 20;

const meta = z.object({ id: z.string(), name: z.string(), originalPath: z.string().nullable(), savedAt: z.string() });

/**
 * Autosave copies live in their own directory ($XDG_DATA_HOME/pixelcraft/
 * recovery), never next to or on top of the user's file. Each write is
 * atomic and keeps the previous copy as `.prev` so a crash in the middle of
 * an autosave still leaves one valid version.
 */
export class RecoveryStore {
  constructor(private readonly dir: string) {}

  private file(id: string): string {
    if (!ID.test(id)) throw new Error('Identificador de recuperação inválido.');
    return join(this.dir, `${id}.pixelcraft`);
  }

  async write(id: string, info: { name: string; originalPath: string | null }, data: Uint8Array): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const f = this.file(id);
    await fs.copyFile(f, `${f}.prev`).catch(() => undefined);
    await writeFileAtomic(f, data);
    await writeJson(join(this.dir, `${id}.json`), { id, ...info, savedAt: new Date().toISOString() });
  }

  async list(): Promise<RecoveryEntry[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const out: RecoveryEntry[] = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        const m = meta.parse(JSON.parse(await fs.readFile(join(this.dir, n), 'utf8')));
        const st = await fs.stat(this.file(m.id));
        out.push({ id: m.id, name: m.name, originalPath: m.originalPath, savedAt: m.savedAt, size: st.size });
      } catch {
        /* skip broken entries */
      }
    }
    return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async read(id: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(this.file(id)));
  }

  /** The previous autosave, used when the latest one turns out to be unreadable. */
  async readPrevious(id: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(`${this.file(id)}.prev`));
  }

  async remove(id: string): Promise<void> {
    const f = this.file(id);
    await Promise.all([f, `${f}.prev`, join(this.dir, `${id}.json`)].map((p) => fs.rm(p, { force: true })));
  }

  /** Controlled clean-up of stale copies and stray temporary files. */
  async prune(): Promise<void> {
    const entries = await this.list();
    const now = Date.now();
    for (const [i, e] of entries.entries()) {
      if (i >= MAX_ENTRIES || now - Date.parse(e.savedAt) > MAX_AGE_MS) await this.remove(e.id);
    }
    try {
      for (const n of await fs.readdir(this.dir)) if (n.endsWith('.tmp')) await fs.rm(join(this.dir, n), { force: true });
    } catch {
      /* directory missing */
    }
  }
}
