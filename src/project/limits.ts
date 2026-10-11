/**
 * Hard limits that protect the editor from documents that would exhaust
 * memory, whether created in the app or loaded from a (possibly malicious)
 * file. Rationale is documented in docs/PROJECT_FORMAT.md.
 */
export const LIMITS = {
  /** Max width or height of a document, in pixels. */
  maxDimension: 4096,
  /** Max pixels (w*h) of a single document frame: 4096² = 16.7M (64 MiB RGBA). */
  maxPixels: 4096 * 4096,
  maxFrames: 1000,
  maxLayers: 256,
  maxGroupDepth: 8,
  /** Max total decoded pixel memory for all images in a project, bytes. */
  maxTotalImageBytes: 1024 * 1024 * 1024,
  /** Max number of entries accepted in a .pixelcraft archive. */
  maxArchiveEntries: 50_000,
  /** Max size of the manifest.json in a project archive, bytes. */
  maxManifestBytes: 32 * 1024 * 1024,
  /** Max file size we try to open at all, bytes. */
  maxProjectFileBytes: 1024 * 1024 * 1024,
  minFrameDuration: 10,
  maxFrameDuration: 60_000,
  maxPaletteColors: 1024,
  maxNameLength: 200,
} as const;

export function checkDimensions(width: number, height: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return 'As dimensões devem ser números inteiros.';
  if (width < 1 || height < 1) return 'As dimensões devem ser de pelo menos 1×1 pixel.';
  if (width > LIMITS.maxDimension || height > LIMITS.maxDimension)
    return `As dimensões máximas são ${LIMITS.maxDimension}×${LIMITS.maxDimension} pixels.`;
  if (width * height > LIMITS.maxPixels) return 'O documento excede o número máximo de pixels.';
  return null;
}
