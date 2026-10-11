import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';

let logFile: string | null = null;

/** Minimal file + console logger ($XDG_CACHE_HOME/pixelcraft/pixelcraft.log). */
export function initLog(dir: string): string {
  mkdirSync(dir, { recursive: true });
  logFile = join(dir, 'pixelcraft.log');
  try {
    if (statSync(logFile).size > 1024 * 1024) renameSync(logFile, `${logFile}.1`);
  } catch {
    /* no log yet */
  }
  return logFile;
}

function write(level: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} [${level}] ${args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  if (level === 'error') console.error(line);
  else console.log(line);
  if (logFile) {
    try {
      appendFileSync(logFile, line + '\n');
    } catch {
      /* logging must never crash the app */
    }
  }
}

export const log = {
  info: (...a: unknown[]) => write('info', a),
  warn: (...a: unknown[]) => write('warn', a),
  error: (...a: unknown[]) => write('error', a),
};
