import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IPC, type AppInfo } from '../shared/ipc';
import { appPaths } from '../platform/paths';
import { FileGrants } from '../platform/file-grants';
import { RecentStore } from '../storage/recent';
import { RecoveryStore } from '../storage/recovery';
import { registerIpc } from './ipc-handlers';
import { initLog, log } from './log';

const paths = appPaths();
app.setName('PixelCraft');
// Chromium's own state goes to the cache directory; our settings stay in XDG config.
app.setPath('userData', paths.config);
app.setPath('sessionData', join(paths.cache, 'session'));
// Wayland/X11 auto-detection on Linux (Electron honours this switch).
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
// Keep WM_CLASS / app_id matching the .desktop file so the icon shows in docks.
if (process.platform === 'linux') app.commandLine.appendSwitch('class', 'pixelcraft');

const logFile = initLog(paths.cache);
process.on('uncaughtException', (e) => log.error('uncaughtException', e));
process.on('unhandledRejection', (e) => log.error('unhandledRejection', e));

const grants = new FileGrants();
const recent = new RecentStore(join(paths.data, 'recent.json'), join(paths.cache, 'thumbnails'));
const recovery = new RecoveryStore(paths.recovery);
const windows = new Set<BrowserWindow>();
const closeAllowed = new WeakSet<BrowserWindow>();
let startupFiles = extractFiles(process.argv);

function extractFiles(argv: string[]): string[] {
  // Skip the executable (and the app path in development).
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.filter((a) => !a.startsWith('-') && /\.(pixelcraft|png|gif|jpe?g|webp|bmp)$/i.test(a) && existsSync(a)).map((a) => grants.grantFile(resolve(a)));
}

function distribution(): AppInfo['distribution'] {
  if (!app.isPackaged) return 'development';
  if (process.env.APPIMAGE) return 'appimage';
  if (process.env.FLATPAK_ID || existsSync('/.flatpak-info')) return 'flatpak';
  if (process.execPath.startsWith('/opt/')) return 'deb';
  return 'unknown';
}

function appInfo(): AppInfo {
  return {
    name: 'PixelCraft',
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    distribution: distribution(),
    paths,
  };
}

function iconPath(): string | undefined {
  const candidates = [join(process.resourcesPath ?? '', 'icon.png'), join(app.getAppPath(), 'build/icon.png')];
  return candidates.find((p) => existsSync(p));
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: 'PixelCraft',
    icon: iconPath(),
    backgroundColor: '#15131d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged || process.env.PIXELCRAFT_DEVTOOLS === '1',
    },
  });
  windows.add(win);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => windows.delete(win));
  win.on('close', (e) => {
    if (closeAllowed.has(win) || win.webContents.isCrashed()) return;
    e.preventDefault();
    win.webContents.send(IPC.closeRequest);
  });
  // The UI never navigates; links open in the system browser (https only).
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('render-process-gone', (_e, d) => log.error('Renderer encerrado:', d.reason));

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl && !app.isPackaged) void win.loadURL(devUrl);
  else void win.loadFile(join(app.getAppPath(), 'dist/index.html'));
  return win;
}

const gotLock = process.env.PIXELCRAFT_MULTI_INSTANCE === '1' || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const files = extractFiles(argv);
    const win = [...windows][0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    for (const f of files) win.webContents.send(IPC.openFileEvent, f);
  });

  app.whenReady().then(async () => {
    log.info(`PixelCraft ${app.getVersion()} iniciando (${distribution()}); log em ${logFile}`);
    Menu.setApplicationMenu(null);
    // Deny every permission request (camera, notifications, …): none is needed.
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    registerIpc({
      grants,
      recent,
      recovery,
      paths,
      appInfo,
      takeStartupFiles: () => {
        const f = startupFiles;
        startupFiles = [];
        return f;
      },
      createWindow: () => void createWindow(),
    });
    // confirmClose is a one-way message: the renderer has finished its checks.
    ipcMain.on(IPC.confirmClose, (e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return;
      closeAllowed.add(win);
      win.close();
    });
    await recovery.prune().catch((e) => log.warn('Limpeza da recuperação falhou', e));
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
  app.on('web-contents-created', (_e, wc) => {
    wc.on('will-attach-webview', (ev) => ev.preventDefault());
  });
}
