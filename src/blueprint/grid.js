// Grid plates and tiles: work out which Wube "Factorio Grid NxM" base plates cover the
// blueprint footprint, and which shaped tile every cell needs.

import { boundsOf } from './normalize.js';

export const MAX_PLATE = 10;

/**
 * Split a length into plate-sized chunks: as many 10s as possible, never leaving a
 * remainder of 1 when we can avoid it (only 1x1 plates exist with a side of 1).
 */
export function chunkLength(len) {
  if (len <= 0) return [];
  if (len === 1) return [1];
  const chunks = [];
  let remaining = len;
  while (remaining > 0) {
    if (remaining <= MAX_PLATE) {
      chunks.push(remaining);
      remaining = 0;
    } else if (remaining - MAX_PLATE === 1) {
      chunks.push(MAX_PLATE - 1);
      remaining -= MAX_PLATE - 1;
    } else {
      chunks.push(MAX_PLATE);
      remaining -= MAX_PLATE;
    }
  }
  return chunks;
}

/** Key for a plate of w x h tiles (Wube names them AxB with A <= B). */
export function plateKey(w, h) {
  if (w === 1 || h === 1) return 'grid/1x1';
  const a = Math.min(w, h);
  const b = Math.max(w, h);
  return `grid/${a}x${b}`;
}

/**
 * Tile the bounding box with grid plates.
 * @param {{minX:number,minY:number,w:number,h:number}} bounds
 * @returns {{ plates: Array<{key:string,x:number,y:number,w:number,h:number,rotated:boolean}>, pins: number }}
 */
export function tilePlates(bounds) {
  const cols = chunkLength(bounds.w);
  const rows = chunkLength(bounds.h);
  const plates = [];
  let y = bounds.minY;
  for (const h of rows) {
    let x = bounds.minX;
    for (const w of cols) {
      if (w === 1 || h === 1) {
        // Strips of width 1 are made from 1x1 plates.
        for (let i = 0; i < w; i++) {
          for (let j = 0; j < h; j++) {
            plates.push({ key: 'grid/1x1', x: x + i, y: y + j, w: 1, h: 1, rotated: false });
          }
        }
      } else {
        plates.push({ key: plateKey(w, h), x, y, w, h, rotated: w > h });
      }
      x += w;
    }
    y += h;
  }
  // One Grid PIN per plate.
  const pins = plates.length;
  return { plates, pins, cols, rows };
}

function overlap(a, al, b, bl) {
  return Math.min(a + al, b + bl) - Math.max(a, b) > 0;
}

/**
 * Compute the footprint bounds, optionally padded.
 */
export function footprintBounds(entities, tiles = [], pad = 0) {
  const b = boundsOf(entities, tiles);
  if (b.w === 0) return b;
  return {
    minX: b.minX - pad,
    minY: b.minY - pad,
    maxX: b.maxX + pad,
    maxY: b.maxY + pad,
    w: b.w + pad * 2,
    h: b.h + pad * 2,
  };
}

/**
 * Physical size helper.
 * @returns {{ wMm:number, hMm:number }}
 */
export function physicalSize(bounds, mmPerTile) {
  return { wMm: bounds.w * mmPerTile, hMm: bounds.h * mmPerTile };
}
