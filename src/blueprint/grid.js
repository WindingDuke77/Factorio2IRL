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
      pushPlate(plates, x, y, w, h);
      x += w;
    }
    y += h;
  }
  return { plates, pins: seamPins(plates), cols, rows };
}

/** Add a w x h plate (strips of width or height 1 become 1x1 plates). */
function pushPlate(plates, x, y, w, h) {
  if (w === 1 || h === 1) {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) plates.push({ key: 'grid/1x1', x: x + i, y: y + j, w: 1, h: 1, rotated: false });
  } else {
    plates.push({ key: plateKey(w, h), x, y, w, h, rotated: w > h });
  }
}

/**
 * Compact tiling: plates only where cells are occupied. Rows are grouped into bands with the same
 * occupancy pattern (capped at 10 rows); neighbouring bands merge while the merged plates stay
 * mostly occupied (or a band is a single row). In each band every run of columns holding an
 * occupied cell gets plates, trimmed to its occupied rows; 1-wide / 1-tall runs are widened by one
 * empty column / row so they use a 2xN plate instead of N 1x1 plates.
 * @param {{minX:number,minY:number,maxX:number,maxY:number,w:number,h:number}} bounds
 * @param {Set<string>} occupied  cells as "x,y"
 */
export function tilePlatesCompact(bounds, occupied) {
  const has = (x, y) => occupied.has(`${x},${y}`);
  const signature = (y) => {
    let sig = '';
    for (let x = bounds.minX; x < bounds.maxX; x++) sig += has(x, y) ? '1' : '0';
    return sig;
  };
  // Column runs of a band, trimmed to their occupied rows.
  const runsOf = (y0, y1) => {
    const colHas = (cx) => {
      for (let cy = y0; cy < y1; cy++) if (has(cx, cy)) return true;
      return false;
    };
    const runs = [];
    let x = bounds.minX;
    while (x < bounds.maxX) {
      if (!colHas(x)) {
        x++;
        continue;
      }
      let x1 = x;
      while (x1 < bounds.maxX && colHas(x1)) x1++;
      let ry0 = y1;
      let ry1 = y0;
      let occ = 0;
      for (let cx = x; cx < x1; cx++) for (let cy = y0; cy < y1; cy++) if (has(cx, cy)) { ry0 = Math.min(ry0, cy); ry1 = Math.max(ry1, cy + 1); occ++; }
      runs.push({ x, x1, ry0, ry1, occ });
      x = x1;
    }
    return runs;
  };
  const emptyFraction = (y0, y1) => {
    let area = 0;
    let occ = 0;
    for (const r of runsOf(y0, y1)) { area += (r.x1 - r.x) * (r.ry1 - r.ry0); occ += r.occ; }
    return area ? 1 - occ / area : 0;
  };

  const bands = [];
  for (let y = bounds.minY; y < bounds.maxY; y++) {
    const sig = signature(y);
    const last = bands[bands.length - 1];
    if (last && last.sig === sig && last.y1 - last.y0 < MAX_PLATE) last.y1 = y + 1;
    else bands.push({ y0: y, y1: y + 1, sig });
  }
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i + 1 < bands.length; i++) {
      const p = bands[i];
      const q = bands[i + 1];
      if (q.y1 - p.y0 > MAX_PLATE) continue;
      const thin = p.y1 - p.y0 < 2 || q.y1 - q.y0 < 2;
      if (thin || emptyFraction(p.y0, q.y1) <= 0.25) {
        bands.splice(i, 2, { y0: p.y0, y1: q.y1, sig: null });
        merged = true;
        break;
      }
    }
  }

  const plates = [];
  for (const { y0, y1 } of bands) {
    let claimed = bounds.minX; // columns below this already carry a plate in this band
    for (let { x, x1, ry0, ry1 } of runsOf(y0, y1)) {
      if (x1 - x === 1) {
        if (x1 < bounds.maxX) x1++;
        else if (x - 1 >= claimed) x--;
      }
      if (ry1 - ry0 === 1) {
        if (ry1 < y1) ry1++;
        else if (ry0 > y0) ry0--;
      }
      let px = x;
      for (const w of chunkLength(x1 - x)) {
        pushPlate(plates, px, ry0, w, ry1 - ry0);
        px += w;
      }
      claimed = x1;
    }
  }
  return { plates, pins: seamPins(plates) };
}

/** One Grid PIN for every tile along a shared edge between neighbouring plates. */
export function seamPins(plates) {
  let pins = 0;
  for (let i = 0; i < plates.length; i++) {
    for (let j = i + 1; j < plates.length; j++) {
      const a = plates[i];
      const b = plates[j];
      if (a.x + a.w === b.x || b.x + b.w === a.x) pins += Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      else if (a.y + a.h === b.y || b.y + b.h === a.y) pins += Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    }
  }
  return pins;
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
