import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_DIR = 'pixelcraft';

function xdg(varName: string, fallback: string): string {
  const v = process.env[varName];
  // The XDG spec says relative paths must be ignored.
  return v && v.startsWith('/') ? v : join(homedir(), fallback);
}

/** XDG Base Directory locations used by PixelCraft (also correct inside Flatpak). */
export function appPaths(): { config: string; data: string; cache: string; recovery: string } {
  const config = join(xdg('XDG_CONFIG_HOME', '.config'), APP_DIR);
  const data = join(xdg('XDG_DATA_HOME', '.local/share'), APP_DIR);
  const cache = join(xdg('XDG_CACHE_HOME', '.cache'), APP_DIR);
  return { config, data, cache, recovery: join(data, 'recovery') };
}
