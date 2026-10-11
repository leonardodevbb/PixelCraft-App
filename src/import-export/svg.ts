import type { PixelBuffer } from '../raster/pixel-buffer';

/**
 * Writes an image as SVG: one rectangle per horizontal run of equal colour,
 * with crisp edges so it stays sharp at any size (handy for the web, vinyl
 * cutters and laser engravers). Fully transparent pixels are left out.
 */
export function encodeSvg(img: PixelBuffer, scale = 1): string {
  const { width: w, height: h } = img;
  const byColor = new Map<number, string[]>();
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const c = img.get(x, y);
      let end = x + 1;
      while (end < w && img.get(end, y) === c) end++;
      if ((c & 255) !== 0) {
        let list = byColor.get(c);
        if (!list) byColor.set(c, (list = []));
        list.push(`M${x} ${y}h${end - x}v1h${x - end}z`);
      }
      x = end;
    }
  }
  const paths = [...byColor].map(([c, d]) => {
    const hex = `#${(c >>> 8).toString(16).padStart(6, '0')}`;
    const a = c & 255;
    return `<path fill="${hex}"${a < 255 ? ` fill-opacity="${+(a / 255).toFixed(3)}"` : ''} d="${d.join('')}"/>`;
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">`,
    ...paths,
    '</svg>',
    '',
  ].join('\n');
}
