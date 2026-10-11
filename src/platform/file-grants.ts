import { resolve } from 'node:path';

/**
 * Paths the renderer may read or write. A path becomes granted only through
 * a user action: picking it in a native dialog, opening it from the recent
 * list, or passing it on the command line / from the file manager. This way a
 * compromised renderer still cannot read or overwrite arbitrary files.
 */
export class FileGrants {
  private files = new Set<string>();
  private dirs = new Set<string>();

  grantFile(path: string): string {
    const p = resolve(path);
    this.files.add(p);
    return p;
  }

  grantDirectory(path: string): string {
    const p = resolve(path);
    this.dirs.add(p);
    return p;
  }

  hasFile(path: string): boolean {
    return this.files.has(resolve(path));
  }

  hasDirectory(path: string): boolean {
    return this.dirs.has(resolve(path));
  }
}
