/**
 * The typed contract between the main process and the renderer. The preload
 * script exposes exactly this API on `window.pixelcraft`; nothing else from
 * Node or Electron is reachable from the UI.
 */

export type FileKind = 'project' | 'image' | 'palette' | 'gif' | 'json' | 'any';

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  packaged: boolean;
  /** How this build was installed, when detectable. */
  distribution: 'deb' | 'appimage' | 'flatpak' | 'development' | 'unknown';
  paths: { config: string; data: string; cache: string; recovery: string };
}

export interface OpenedFile {
  path: string;
  name: string;
  data: Uint8Array;
}

export interface RecentEntry {
  path: string;
  name: string;
  openedAt: string;
  exists: boolean;
  /** PNG thumbnail as a data: URL, when available. */
  thumbnail: string | null;
}

export interface RecoveryEntry {
  id: string;
  name: string;
  /** File the document was last saved to, if any. */
  originalPath: string | null;
  savedAt: string;
  size: number;
}

export interface SaveDialogOptions {
  kind: FileKind;
  defaultName: string;
  title?: string;
  /** Overrides the filters of `kind`, e.g. ['png'] when exporting PNG. */
  extensions?: string[];
  filterName?: string;
}

export interface WriteResult {
  path: string;
  bytes: number;
}

export interface PixelCraftApi {
  app: {
    info(): Promise<AppInfo>;
    setTitle(title: string): void;
    toggleFullscreen(): Promise<boolean>;
    /** Allows the pending window close to proceed (after unsaved-changes checks). */
    confirmClose(): void;
    onCloseRequest(cb: () => void): () => void;
    /** Files passed on the command line or opened from the file manager. */
    onOpenFile(cb: (path: string) => void): () => void;
    /** Paths given at startup, consumed once. */
    takeStartupFiles(): Promise<string[]>;
    openDocs(page: 'readme' | 'shortcuts' | 'tutorial'): Promise<void>;
    newWindow(): Promise<void>;
  };
  file: {
    openDialog(kind: FileKind, title?: string): Promise<OpenedFile | null>;
    openManyDialog(kind: FileKind, title?: string): Promise<OpenedFile[]>;
    /** Reads a path previously granted (dialog, recent list or command line). */
    read(path: string): Promise<OpenedFile>;
    saveDialog(opts: SaveDialogOptions): Promise<string | null>;
    /** Atomically writes a granted path. */
    write(path: string, data: Uint8Array): Promise<WriteResult>;
    chooseDirectory(title?: string): Promise<string | null>;
    /** Writes a file named `name` (no directories) inside a granted directory. */
    writeInDirectory(dir: string, name: string, data: Uint8Array): Promise<WriteResult>;
    showInFolder(path: string): Promise<void>;
  };
  recent: {
    list(): Promise<RecentEntry[]>;
    add(path: string, name: string, thumbnailPng: Uint8Array | null): Promise<void>;
    remove(path: string): Promise<void>;
    clear(): Promise<void>;
  };
  settings: {
    load(): Promise<unknown>;
    save(value: unknown): Promise<void>;
  };
  palettes: {
    load(): Promise<unknown>;
    save(value: unknown): Promise<void>;
  };
  clipboard: {
    /** Puts a PNG image on the system clipboard. */
    writePng(data: Uint8Array): Promise<void>;
    /** PNG bytes of the image on the system clipboard, or null. */
    readPng(): Promise<Uint8Array | null>;
  };
  recovery: {
    write(id: string, meta: { name: string; originalPath: string | null }, data: Uint8Array): Promise<void>;
    list(): Promise<RecoveryEntry[]>;
    read(id: string): Promise<Uint8Array>;
    remove(id: string): Promise<void>;
  };
}

export const IPC = {
  appInfo: 'app:info',
  setTitle: 'app:set-title',
  toggleFullscreen: 'app:toggle-fullscreen',
  confirmClose: 'app:confirm-close',
  closeRequest: 'app:close-request',
  openFileEvent: 'app:open-file',
  startupFiles: 'app:startup-files',
  openDocs: 'app:open-docs',
  newWindow: 'app:new-window',
  openDialog: 'file:open-dialog',
  openManyDialog: 'file:open-many-dialog',
  read: 'file:read',
  saveDialog: 'file:save-dialog',
  write: 'file:write',
  chooseDirectory: 'file:choose-directory',
  writeInDirectory: 'file:write-in-directory',
  showInFolder: 'file:show-in-folder',
  recentList: 'recent:list',
  recentAdd: 'recent:add',
  recentRemove: 'recent:remove',
  recentClear: 'recent:clear',
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',
  palettesLoad: 'palettes:load',
  palettesSave: 'palettes:save',
  clipboardWritePng: 'clipboard:write-png',
  clipboardReadPng: 'clipboard:read-png',
  recoveryWrite: 'recovery:write',
  recoveryList: 'recovery:list',
  recoveryRead: 'recovery:read',
  recoveryRemove: 'recovery:remove',
} as const;

export const FILE_FILTERS: Record<FileKind, { name: string; extensions: string[] }[]> = {
  project: [{ name: 'Projeto PixelCraft', extensions: ['pixelcraft'] }],
  image: [
    { name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
    { name: 'PNG', extensions: ['png'] },
  ],
  palette: [{ name: 'Paletas', extensions: ['gpl', 'hex', 'json', 'pal', 'act', 'txt'] }],
  gif: [{ name: 'GIF animado', extensions: ['gif'] }],
  json: [{ name: 'JSON', extensions: ['json'] }],
  any: [{ name: 'Todos os arquivos', extensions: ['*'] }],
};

/** Max size of any single file read through the API (1 GiB). */
export const MAX_READ_BYTES = 1024 * 1024 * 1024;
