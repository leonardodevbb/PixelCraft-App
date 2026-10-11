import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Writes a file so that readers only ever see the old or the new complete
 * content: data goes to a temporary file in the same directory, is flushed to
 * disk, and then renamed over the target (atomic on POSIX file systems). If
 * anything fails the original file is left untouched and the temp is removed.
 */
export async function writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
  const dir = dirname(path);
  const tmp = join(dir, `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(tmp, 'wx', 0o644);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    // Preserve permissions of an existing file.
    try {
      const st = await fs.stat(path);
      await fs.chmod(tmp, st.mode & 0o7777);
    } catch {
      /* new file */
    }
    await fs.rename(tmp, path);
    // Persist the rename itself.
    try {
      const dh = await fs.open(dir, 'r');
      await dh.sync().catch(() => undefined);
      await dh.close();
    } catch {
      /* some file systems do not allow opening directories */
    }
  } catch (err) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    // Corrupted settings must not prevent startup: keep a copy and start fresh.
    await fs.rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined);
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await writeFileAtomic(path, new TextEncoder().encode(JSON.stringify(value, null, 2)));
}

/** Human readable error for file system failures. */
export function describeFsError(e: unknown, path: string): string {
  const code = (e as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return `Sem permissão para acessar "${path}". Escolha outro local ou verifique as permissões.`;
    case 'ENOSPC':
      return 'Não há espaço livre suficiente no disco. Libere espaço e tente novamente.';
    case 'ENOENT':
      return `O arquivo ou pasta "${path}" não existe mais.`;
    case 'EROFS':
      return `"${path}" está em um sistema de arquivos somente leitura.`;
    case 'EISDIR':
      return `"${path}" é uma pasta, não um arquivo.`;
    default:
      return `Falha ao acessar "${path}": ${(e as Error)?.message ?? String(e)}`;
  }
}
