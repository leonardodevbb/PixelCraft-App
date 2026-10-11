import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { RecentEntry } from '../shared/ipc';
import { readJson, writeFileAtomic, writeJson } from '../platform/fs-atomic';

const MAX_RECENT = 15;

const stored = z.array(z.object({ path: z.string(), name: z.string(), openedAt: z.string() }));

export class RecentStore {
  constructor(
    private readonly file: string,
    private readonly thumbDir: string,
  ) {}

  private thumbPath(path: string): string {
    return join(this.thumbDir, `${createHash('sha1').update(path).digest('hex')}.png`);
  }

  private async read(): Promise<z.infer<typeof stored>> {
    const parsed = stored.safeParse(await readJson(this.file));
    return parsed.success ? parsed.data : [];
  }

  async paths(): Promise<string[]> {
    return (await this.read()).map((e) => e.path);
  }

  async list(): Promise<RecentEntry[]> {
    const entries = await this.read();
    return Promise.all(
      entries.map(async (e) => {
        let thumbnail: string | null = null;
        try {
          const data = await fs.readFile(this.thumbPath(e.path));
          thumbnail = `data:image/png;base64,${data.toString('base64')}`;
        } catch {
          /* no thumbnail */
        }
        return { ...e, exists: existsSync(e.path), thumbnail };
      }),
    );
  }

  async add(path: string, name: string, thumbnail: Uint8Array | null): Promise<void> {
    const entries = (await this.read()).filter((e) => e.path !== path);
    entries.unshift({ path, name: name || basename(path), openedAt: new Date().toISOString() });
    const removed = entries.splice(MAX_RECENT);
    await writeJson(this.file, entries);
    if (thumbnail && thumbnail.length < 2 * 1024 * 1024) {
      await fs.mkdir(this.thumbDir, { recursive: true });
      await writeFileAtomic(this.thumbPath(path), thumbnail).catch(() => undefined);
    }
    for (const r of removed) await fs.rm(this.thumbPath(r.path), { force: true }).catch(() => undefined);
  }

  async remove(path: string): Promise<void> {
    const entries = (await this.read()).filter((e) => e.path !== path);
    await writeJson(this.file, entries);
    await fs.rm(this.thumbPath(path), { force: true }).catch(() => undefined);
  }

  async clear(): Promise<void> {
    for (const e of await this.read()) await fs.rm(this.thumbPath(e.path), { force: true }).catch(() => undefined);
    await writeJson(this.file, []);
  }
}
