import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, type IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { z } from 'zod';
import { FILE_FILTERS, IPC, MAX_READ_BYTES, type FileKind, type OpenedFile, type WriteResult } from '../shared/ipc';
import { describeFsError, readJson, writeFileAtomic, writeJson } from '../platform/fs-atomic';
import type { FileGrants } from '../platform/file-grants';
import type { RecentStore } from '../storage/recent';
import type { RecoveryStore } from '../storage/recovery';
import { log } from './log';

export interface HandlerDeps {
  grants: FileGrants;
  recent: RecentStore;
  recovery: RecoveryStore;
  paths: { config: string; data: string; cache: string; recovery: string };
  appInfo: () => unknown;
  takeStartupFiles: () => string[];
  createWindow: () => void;
}

const fileKind = z.enum(['project', 'image', 'palette', 'gif', 'json', 'any']);
const pathArg = z.string().min(1).max(4096);
const bytesArg = z.instanceof(Uint8Array);
const DOCS_URL = 'https://github.com/leonardodevbb/PixelCraft-App';

/** Only plain file names: no separators, no traversal, no hidden control chars. */
export function safeFileName(name: string): string {
  const n = name.replace(/[\u0000-\u001f/\\]/g, '_').trim();
  if (!n || n === '.' || n === '..' || n.length > 255) throw new Error('Nome de arquivo inválido.');
  return n;
}

function windowOf(e: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(e.sender) ?? undefined;
}

async function readGranted(path: string): Promise<OpenedFile> {
  try {
    const st = await fs.stat(path);
    if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'EISDIR' });
    if (st.size > MAX_READ_BYTES) throw new Error('O arquivo é grande demais para ser aberto.');
    const data = new Uint8Array(await fs.readFile(path));
    return { path, name: basename(path), data };
  } catch (e) {
    throw new Error(describeFsError(e, path));
  }
}

function ensureExtension(path: string, kind: FileKind, extensions?: string[]): string {
  const exts = extensions ?? FILE_FILTERS[kind][0]?.extensions ?? [];
  if (!exts.length || exts.includes('*')) return path;
  const ext = extname(path).slice(1).toLowerCase();
  return exts.includes(ext) ? path : `${path}.${exts[0]}`;
}

export function registerIpc(deps: HandlerDeps): void {
  const { grants } = deps;
  const handle = <A extends unknown[]>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => unknown): void => {
    ipcMain.handle(channel, async (e, ...args) => {
      try {
        return await fn(e, ...(args as A));
      } catch (err) {
        log.warn(`IPC ${channel} falhou:`, (err as Error).message);
        throw err;
      }
    });
  };

  handle(IPC.appInfo, () => deps.appInfo());
  ipcMain.on(IPC.setTitle, (e, title: unknown) => {
    const t = z.string().max(300).safeParse(title);
    if (t.success) BrowserWindow.fromWebContents(e.sender)?.setTitle(t.data);
  });
  handle(IPC.toggleFullscreen, (e) => {
    const w = windowOf(e);
    if (!w) return false;
    w.setFullScreen(!w.isFullScreen());
    return w.isFullScreen();
  });
  handle(IPC.startupFiles, () => deps.takeStartupFiles());
  handle(IPC.openDocs, async (_e, page: unknown) => {
    const p = z.enum(['readme', 'shortcuts', 'tutorial']).parse(page);
    const url = p === 'readme' ? `${DOCS_URL}#readme` : `${DOCS_URL}/blob/main/docs/${p === 'shortcuts' ? 'SHORTCUTS' : 'TUTORIAL'}.md`;
    await shell.openExternal(url);
  });
  handle(IPC.newWindow, () => deps.createWindow());

  handle(IPC.openDialog, async (e, kind: unknown, title: unknown) => {
    const k = fileKind.parse(kind);
    const w = windowOf(e);
    const opts = {
      title: z.string().max(200).optional().parse(title),
      properties: ['openFile'] as ('openFile')[],
      filters: [...FILE_FILTERS[k], ...FILE_FILTERS.any],
    };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    const path = r.filePaths[0];
    if (r.canceled || !path) return null;
    return readGranted(grants.grantFile(path));
  });

  handle(IPC.openManyDialog, async (e, kind: unknown, title: unknown) => {
    const k = fileKind.parse(kind);
    const w = windowOf(e);
    const opts = {
      title: z.string().max(200).optional().parse(title),
      properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[],
      filters: [...FILE_FILTERS[k], ...FILE_FILTERS.any],
    };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled) return [];
    const out: OpenedFile[] = [];
    for (const p of r.filePaths.slice(0, 1000)) out.push(await readGranted(grants.grantFile(p)));
    return out;
  });

  handle(IPC.read, async (_e, path: unknown) => {
    const p = pathArg.parse(path);
    if (!grants.hasFile(p)) {
      // Entries of the recent list were chosen by the user in earlier sessions.
      if ((await deps.recent.paths()).includes(p)) grants.grantFile(p);
      else throw new Error('Acesso negado: o arquivo não foi escolhido pelo usuário.');
    }
    return readGranted(p);
  });

  handle(IPC.saveDialog, async (e, raw: unknown) => {
    const o = z
      .object({
        kind: fileKind,
        defaultName: z.string().max(255),
        title: z.string().max(200).optional(),
        extensions: z.array(z.string().regex(/^[a-z0-9]{1,10}$/)).max(10).optional(),
        filterName: z.string().max(100).optional(),
      })
      .parse(raw);
    const w = windowOf(e);
    const filters = o.extensions ? [{ name: o.filterName ?? o.extensions.join(', ').toUpperCase(), extensions: o.extensions }] : FILE_FILTERS[o.kind];
    const opts = { title: o.title, defaultPath: safeFileName(o.defaultName || 'sem-titulo'), filters, properties: ['showOverwriteConfirmation' as const, 'createDirectory' as const] };
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    return grants.grantFile(ensureExtension(r.filePath, o.kind, o.extensions));
  });

  handle(IPC.write, async (_e, path: unknown, data: unknown): Promise<WriteResult> => {
    const p = pathArg.parse(path);
    const bytes = bytesArg.parse(data);
    if (!grants.hasFile(p)) throw new Error('Acesso negado: escolha o local do arquivo pelo diálogo de salvamento.');
    try {
      await writeFileAtomic(p, bytes);
    } catch (err) {
      throw new Error(describeFsError(err, p));
    }
    return { path: p, bytes: bytes.length };
  });

  handle(IPC.writeSibling, async (_e, path: unknown, ext: unknown, data: unknown): Promise<WriteResult> => {
    const p = pathArg.parse(path);
    const x = z.enum(['json', 'tmj']).parse(ext);
    const bytes = bytesArg.parse(data);
    if (!grants.hasFile(p)) throw new Error('Acesso negado: escolha o local do arquivo pelo diálogo de salvamento.');
    const sib = join(dirname(p), `${basename(p, extname(p))}.${x}`);
    try {
      await writeFileAtomic(sib, bytes);
    } catch (err) {
      throw new Error(describeFsError(err, sib));
    }
    return { path: sib, bytes: bytes.length };
  });

  handle(IPC.chooseDirectory, async (e, title: unknown) => {
    const w = windowOf(e);
    const opts = { title: z.string().max(200).optional().parse(title), properties: ['openDirectory' as const, 'createDirectory' as const] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    const p = r.filePaths[0];
    if (r.canceled || !p) return null;
    return grants.grantDirectory(p);
  });

  handle(IPC.writeInDirectory, async (_e, dir: unknown, name: unknown, data: unknown): Promise<WriteResult> => {
    const d = pathArg.parse(dir);
    const n = safeFileName(z.string().parse(name));
    const bytes = bytesArg.parse(data);
    if (!grants.hasDirectory(d)) throw new Error('Acesso negado: escolha a pasta pelo diálogo.');
    const p = join(d, n);
    try {
      await writeFileAtomic(p, bytes);
    } catch (err) {
      throw new Error(describeFsError(err, p));
    }
    return { path: p, bytes: bytes.length };
  });

  handle(IPC.showInFolder, (_e, path: unknown) => {
    const p = pathArg.parse(path);
    if (grants.hasFile(p)) shell.showItemInFolder(p);
    else if (grants.hasDirectory(p)) void shell.openPath(p);
  });

  handle(IPC.recentList, () => deps.recent.list());
  handle(IPC.recentAdd, async (_e, path: unknown, name: unknown, thumb: unknown) => {
    const p = pathArg.parse(path);
    if (!grants.hasFile(p)) return;
    await deps.recent.add(p, z.string().max(300).parse(name), thumb == null ? null : bytesArg.parse(thumb));
    app.addRecentDocument(p);
  });
  handle(IPC.recentRemove, (_e, path: unknown) => deps.recent.remove(pathArg.parse(path)));
  handle(IPC.recentClear, () => deps.recent.clear());

  const settingsFile = join(deps.paths.config, 'settings.json');
  const palettesFile = join(deps.paths.config, 'palettes.json');
  const MAX_JSON = 4 * 1024 * 1024;
  const jsonValue = z.unknown().refine((v) => JSON.stringify(v ?? null).length < MAX_JSON, 'valor grande demais');
  handle(IPC.settingsLoad, () => readJson(settingsFile));
  handle(IPC.settingsSave, (_e, v: unknown) => writeJson(settingsFile, jsonValue.parse(v)));
  handle(IPC.palettesLoad, () => readJson(palettesFile));
  handle(IPC.palettesSave, (_e, v: unknown) => writeJson(palettesFile, jsonValue.parse(v)));

  // Clipboard: images only, as PNG; capped so a huge clipboard can't exhaust memory.
  const MAX_CLIPBOARD = 64 * 1024 * 1024;
  handle(IPC.clipboardWritePng, (_e, data: unknown) => {
    const bytes = bytesArg.refine((b) => b.length <= MAX_CLIPBOARD).parse(data);
    const img = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (img.isEmpty()) throw new Error('Imagem inválida para a área de transferência.');
    clipboard.writeImage(img);
  });
  handle(IPC.clipboardReadPng, () => {
    const img = clipboard.readImage();
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (width * height > 4096 * 4096) throw new Error('A imagem da área de transferência é grande demais.');
    const png = img.toPNG();
    return png.length > MAX_CLIPBOARD ? null : new Uint8Array(png);
  });

  const recoveryId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
  handle(IPC.recoveryWrite, (_e, id: unknown, meta: unknown, data: unknown) =>
    deps.recovery.write(
      recoveryId.parse(id),
      z.object({ name: z.string().max(300), originalPath: z.string().max(4096).nullable() }).parse(meta),
      bytesArg.parse(data),
    ),
  );
  handle(IPC.recoveryList, () => deps.recovery.list());
  handle(IPC.recoveryRead, async (_e, id: unknown) => deps.recovery.read(recoveryId.parse(id)));
  handle(IPC.recoveryRemove, (_e, id: unknown) => deps.recovery.remove(recoveryId.parse(id)));
}
