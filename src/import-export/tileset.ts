import type { TileSettings } from '../project/model';
import { PixelBuffer } from '../raster/pixel-buffer';
import type { Rect } from '../raster/rect';

export interface TileGrid {
  /** Top-left of the first whole tile. */
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
}

/** Whole tiles that fit in the image given the tile size and grid offset. */
export function tileGrid(imgW: number, imgH: number, t: TileSettings): TileGrid {
  const w = Math.max(1, Math.floor(t.width));
  const h = Math.max(1, Math.floor(t.height));
  const originX = ((t.offsetX % w) + w) % w;
  const originY = ((t.offsetY % h) + h) % h;
  return {
    originX,
    originY,
    cols: Math.max(0, Math.floor((imgW - originX) / w)),
    rows: Math.max(0, Math.floor((imgH - originY) / h)),
    width: w,
    height: h,
  };
}

export interface TileExtractOptions {
  /** Identical tiles are stored once (default true). */
  dedupe?: boolean;
  /** Fully transparent tiles map to -1 and are not stored (default true). */
  skipEmpty?: boolean;
}

export interface ExtractedTiles {
  grid: TileGrid;
  tiles: PixelBuffer[];
  /** Row-major tile index per grid cell; -1 for skipped empty cells. */
  map: number[];
}

function hashTile(img: PixelBuffer): string {
  // FNV-1a over the bytes; collisions are resolved with a full compare.
  let h = 0x811c9dc5;
  const d = img.data;
  for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i]!, 0x01000193);
  return (h >>> 0).toString(16);
}

export function extractTiles(img: PixelBuffer, t: TileSettings, opts: TileExtractOptions = {}): ExtractedTiles {
  const dedupe = opts.dedupe ?? true;
  const skipEmpty = opts.skipEmpty ?? true;
  const grid = tileGrid(img.width, img.height, t);
  const tiles: PixelBuffer[] = [];
  const map: number[] = [];
  const seen = new Map<string, number[]>();
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) {
      const rect: Rect = { x: grid.originX + c * grid.width, y: grid.originY + r * grid.height, w: grid.width, h: grid.height };
      const tile = img.extract(rect);
      if (skipEmpty && tile.isEmpty()) {
        map.push(-1);
        continue;
      }
      if (dedupe) {
        const key = hashTile(tile);
        const bucket = seen.get(key) ?? [];
        const hit = bucket.find((i) => tiles[i]!.equals(tile));
        if (hit !== undefined) {
          map.push(hit);
          continue;
        }
        bucket.push(tiles.length);
        seen.set(key, bucket);
      }
      map.push(tiles.length);
      tiles.push(tile);
    }
  return { grid, tiles, map };
}

/** Packs tiles row by row into an image `columns` tiles wide. */
export function buildTilesetImage(tiles: PixelBuffer[], tileW: number, tileH: number, columns: number, spacing = 0): PixelBuffer {
  const cols = Math.max(1, Math.min(columns, tiles.length || 1));
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const out = new PixelBuffer(cols * tileW + (cols - 1) * spacing, rows * tileH + (rows - 1) * spacing);
  tiles.forEach((tile, i) => out.paste(tile, (i % cols) * (tileW + spacing), Math.floor(i / cols) * (tileH + spacing)));
  return out;
}

/**
 * A Tiled (mapeditor.org) JSON map (.tmj) with one tile layer that rebuilds
 * the image from the tileset. GIDs start at 1; 0 means an empty cell.
 */
export function tiledMapJson(ex: ExtractedTiles, sheet: { image: string; width: number; height: number; columns: number; spacing: number }, name: string): string {
  const { grid } = ex;
  return JSON.stringify(
    {
      type: 'map',
      version: '1.10',
      tiledversion: '1.10.2',
      orientation: 'orthogonal',
      renderorder: 'right-down',
      infinite: false,
      width: grid.cols,
      height: grid.rows,
      tilewidth: grid.width,
      tileheight: grid.height,
      nextlayerid: 2,
      nextobjectid: 1,
      layers: [{ id: 1, name, type: 'tilelayer', x: 0, y: 0, width: grid.cols, height: grid.rows, opacity: 1, visible: true, data: ex.map.map((i) => i + 1) }],
      tilesets: [
        {
          firstgid: 1,
          name,
          image: sheet.image,
          imagewidth: sheet.width,
          imageheight: sheet.height,
          tilewidth: grid.width,
          tileheight: grid.height,
          tilecount: ex.tiles.length,
          columns: Math.max(1, Math.min(sheet.columns, ex.tiles.length || 1)),
          margin: 0,
          spacing: sheet.spacing,
        },
      ],
    },
    null,
    2,
  );
}
