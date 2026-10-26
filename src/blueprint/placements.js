// Turn a normalised blueprint into a flat list of physical pieces to place/print.
//
// Each piece: { key, x, y, rotation, color, entityId, group }
//   key      - piece key from scripts/catalog.json (e.g. 'belt/straight-top')
//   x, y     - centre of the piece in blueprint tile coordinates (y grows "down")
//   rotation - cardinal direction 0/4/8/12 the piece faces (N/E/S/W)
//   group    - 'body' | 'tile' | 'grid' | 'hardware' (hardware = pins, not rendered)

import { resolveBeltShapes, buildCellMap } from './belts.js';
import { resolveWallShapes } from './walls.js';
import { footprintBounds, tilePlates } from './grid.js';
import { DIR_VEC, rotateDirCW } from './normalize.js';
import { BELT_ITEMS, ITEM_ORDER } from './items.js';

export const DEFAULT_OPTIONS = Object.freeze({
  endStyle: 'none', // 'none' | 'short' (cap on the next tile) | 'long' (integrated piece) | 'medium' (medium piece + cap)
  inserterHand: 'closed', // 'closed' | 'open'
  fillEmpty: true, // put an Empty Tile on every uncovered cell inside the footprint
  includeGrid: true, // add grid base plates + pins
  chestsOpen: false, // draw chests with the lid off / propped open
  beltItems: 'auto', // 'none' | 'auto' | 'mixed' | an id from BELT_ITEMS
  detectedItem: null, // item id found in the blueprint (used when beltItems === 'auto')
  pad: 0, // extra empty tiles around the footprint
});

const GRID_COLOR = 0x8f8f8f; // unpainted print grey
const PIN_COLOR = 0x6a6a6a;

export function buildPlacements(normalized, options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const { entities, tiles } = normalized;
  const beltShapes = resolveBeltShapes(entities);
  const wallShapes = resolveWallShapes(entities);
  // Short end caps sit on the tile before/after the belt, so reserve those cells when free.
  const cellMap = buildCellMap(entities);
  const capCells = [];
  const capsAllowed = new Set();
  if (opt.endStyle === 'short') {
    for (const e of entities) {
      if (e.def.kind !== 'belt') continue;
      const s = beltShapes.get(e.id);
      if (s.shape !== 'straight') continue;
      const f = DIR_VEC[e.direction];
      for (const [flag, sign, cap] of [[s.isStart, -1, 'start'], [s.isEnd, 1, 'end']]) {
        if (!flag) continue;
        const cx = e.left + f.x * sign;
        const cy = e.top + f.y * sign;
        if (cellMap.has(`${cx},${cy}`) || capCells.some((c) => c.x === cx && c.y === cy)) continue;
        capCells.push({ x: cx, y: cy });
        capsAllowed.add(`${e.id}:${cap}`);
      }
    }
  }
  const bounds = footprintBounds(entities, [...tiles, ...capCells], opt.pad);

  const pieces = [];
  const placeholders = [];
  const covered = new Set();
  let beltCount = 0;
  const itemFor = () => {
    const mode = opt.beltItems;
    if (!mode || mode === 'none') return null;
    if (mode === 'auto') return opt.detectedItem ? BELT_ITEMS[opt.detectedItem] ?? null : null;
    if (mode === 'mixed') return BELT_ITEMS[ITEM_ORDER[beltCount % ITEM_ORDER.length]];
    return BELT_ITEMS[mode] ?? null;
  };

  const push = (key, e, group, color, extra = {}) => {
    pieces.push({
      key,
      x: e.x,
      y: e.y,
      rotation: e.direction ?? 0,
      color,
      entityId: e.id,
      entityName: e.name,
      group,
      ...extra,
    });
  };
  const cover = (e) => {
    for (let dx = 0; dx < e.w; dx++) for (let dy = 0; dy < e.h; dy++) covered.add(`${e.left + dx},${e.top + dy}`);
  };
  for (const c of capCells) covered.add(`${c.x},${c.y}`);

  for (const e of entities) {
    const d = e.def;
    switch (d.kind) {
      case 'belt': {
        const s = beltShapes.get(e.id);
        addBeltPieces(push, e, s, opt, capsAllowed);
        const item = itemFor();
        if (item && s.shape === 'straight') addBeltItems(pieces, e, s, item);
        beltCount++;
        cover(e);
        break;
      }
      case 'underground': {
        const s = beltShapes.get(e.id);
        const io = s.shape === 'underground-in' ? 'in' : 'out';
        push(`belt/underground-${io}-top`, e, 'body', d.color);
        push(`belt/underground-${io}-bottom`, e, 'body', d.baseColor);
        // The shared underground tile is modelled for the entrance; the exit flows the other way.
        push('tile/underground', e, 'tile', d.tileColor, { rotation: (e.direction + (io === 'out' ? 8 : 0)) % 16 });
        cover(e);
        break;
      }
      case 'splitter': {
        // Per Wube's guide a splitter sits over two Straight Bottoms (one per lane); the splitter
        // base is a cover that goes over them and carries the top.
        {
          const right = DIR_VEC[rotateDirCW(e.direction)];
          for (const side of [-0.5, 0.5]) {
            push('belt/straight-bottom', e, 'body', d.baseColor, { x: e.x + right.x * side, y: e.y + right.y * side });
          }
        }
        push('belt/splitter-top', e, 'body', d.color);
        push('belt/splitter-bottom', e, 'body', d.baseColor);
        push('belt/splitter-pin', e, 'hardware', PIN_COLOR, { qty: 1 }); // the Splitter Pin file is a set of two
        push('tile/splitter', e, 'tile', d.tileColor);
        cover(e);
        break;
      }
      case 'inserter': {
        push(`${d.body}-${opt.inserterHand}`, e, 'body', d.color);
        push('inserter/base-single', e, 'body', d.baseColor);
        push('tile/inserter', e, 'tile', d.tileColor);
        cover(e);
        break;
      }
      case 'wall': {
        const s = wallShapes.get(e.id);
        push(s.piece, e, 'body', d.color, { rotation: 0 });
        push(s.tile, e, 'tile', d.tileColor, { rotation: s.rotation ?? 0 });
        cover(e);
        break;
      }
      case 'chest': {
        const open = Boolean(opt.chestsOpen) && d.bodyOpen;
        push(open ? d.bodyOpen : d.body, e, 'body', d.color);
        const lid = open ? d.lidOpen : d.lidClosed;
        if (lid) push(lid, e, 'body', d.color);
        push(d.tile, e, 'tile', d.tileColor);
        cover(e);
        break;
      }
      case 'machine':
      case 'pole': {
        push(d.body, e, 'body', d.color);
        push(d.tile, e, 'tile', d.tileColor);
        cover(e);
        break;
      }
      default: {
        placeholders.push({
          entityId: e.id,
          name: e.name,
          label: d.label,
          x: e.x,
          y: e.y,
          w: e.w,
          h: e.h,
          rotation: e.direction ?? 0,
          color: d.color,
          unknown: Boolean(d.unknown),
        });
      }
    }
  }

  // Wall junctions (corners, T, X) take a Fill-In plug each.
  let fillIns = 0;
  for (const s of wallShapes.values()) if (popcount(s.mask) >= 2 && s.mask !== 5 && s.mask !== 10) fillIns++;
  if (fillIns) pieces.push({ key: 'wall/fill-in', x: bounds.minX, y: bounds.minY, rotation: 0, color: PIN_COLOR, entityId: null, group: 'hardware', qty: fillIns });

  // Empty tiles for every uncovered cell inside the footprint.
  if (opt.fillEmpty && bounds.w > 0) {
    for (let x = bounds.minX; x < bounds.maxX; x++) {
      for (let y = bounds.minY; y < bounds.maxY; y++) {
        if (covered.has(`${x},${y}`)) continue;
        pieces.push({ key: 'tile/empty', x: x + 0.5, y: y + 0.5, rotation: 0, color: 0x6f6f6f, entityId: null, group: 'tile' });
      }
    }
  }

  // Grid base plates.
  let grid = { plates: [], pins: 0 };
  if (opt.includeGrid && bounds.w > 0) {
    grid = tilePlates(bounds);
    for (const p of grid.plates) {
      pieces.push({
        key: p.key,
        x: p.x + p.w / 2,
        y: p.y + p.h / 2,
        rotation: p.rotated ? 4 : 0,
        color: GRID_COLOR,
        entityId: null,
        group: 'grid',
        plate: p,
      });
    }
    if (grid.pins > 0) {
      pieces.push({ key: 'grid/pin', x: bounds.minX, y: bounds.minY, rotation: 0, color: PIN_COLOR, entityId: null, group: 'hardware', qty: grid.pins });
    }
  }

  return { pieces, placeholders, bounds, grid, options: opt, beltShapes, wallShapes, cellMap: buildCellMap(entities) };
}

function popcount(n) {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>= 1;
  }
  return c;
}

/** Two items per lane on straight belts, one per lane on turns (as in Wube's photos). */
function addBeltItems(pieces, e, s, item) {
  const fwd = DIR_VEC[e.direction];
  const right = DIR_VEC[rotateDirCW(e.direction)];
  const spots = [[-0.24, -0.19], [0.24, -0.19], [-0.24, 0.19], [0.24, 0.19]];
  spots.forEach(([a, b], i) => {
    pieces.push({
      key: item.key,
      x: e.x + fwd.x * a + right.x * b,
      y: e.y + fwd.y * a + right.y * b,
      rotation: (e.direction + 4 * ((i + e.id) % 4)) % 16,
      color: item.color,
      entityId: e.id,
      entityName: e.name,
      group: 'item',
    });
  });
}

function addBeltPieces(push, e, s, opt, capsAllowed = new Set()) {
  const d = e.def;
  if (s.shape === 'turn-l' || s.shape === 'turn-r') {
    // The turn base and tile are symmetric quarter-circles (pivot NW when unrotated); a right
    // turn needs them a quarter further clockwise than a left turn.
    const extra = s.shape === 'turn-r' ? 4 : 0;
    push(`belt/${s.shape}-top`, e, 'body', d.color);
    push('belt/turn-bottom', e, 'body', d.baseColor, { rotation: (e.direction + extra) % 16 });
    push('tile/turn', e, 'tile', d.tileColor, { rotation: (e.direction + extra) % 16 });
    return;
  }
  const style = opt.endStyle;
  const f = DIR_VEC[e.direction];
  const at = (dist) => ({ x: e.x + f.x * dist, y: e.y + f.y * dist });
  // A lone belt tile counts as a start. The end tiles are modelled for an "End" (rounded at the
  // front); a start is the mirror image.
  const cap = s.isStart ? 'start' : s.isEnd ? 'end' : null;
  const sign = cap === 'end' ? 1 : -1;
  const capRot = (e.direction + (cap === 'start' ? 8 : 0)) % 16;

  if (cap && style === 'long') {
    // One integrated piece: a full tile with the rounded end built in.
    push(`belt/${cap}-long-top`, e, 'body', d.color);
    push(`belt/${cap}-long-bottom`, e, 'body', d.baseColor);
    push('tile/end-long', e, 'tile', d.tileColor, { rotation: capRot });
    return;
  }
  if (cap && style === 'medium') {
    // Medium piece on its End Medium Tile (no separate cap).
    push(`belt/${cap}-medium-top`, e, 'body', d.color, at(-sign * 0.12));
    push(`belt/${cap}-medium-bottom`, e, 'body', d.baseColor, at(-sign * 0.12));
    push('tile/end-medium', e, 'tile', d.tileColor, { rotation: capRot });
    return;
  }
  push('belt/straight-top', e, 'body', d.color);
  push('belt/straight-bottom', e, 'body', d.baseColor);
  push('tile/straight', e, 'tile', d.tileColor);
  if (style === 'short') {
    // Short caps go on the free tile before/after the belt, on their own End Short Tile.
    for (const [c, sg] of [['start', -1], ['end', 1]]) {
      if (!capsAllowed.has(`${e.id}:${c}`)) continue;
      push(`belt/${c}-short`, e, 'body', d.baseColor, at(sg * (0.5 + 0.135)));
      push('tile/end-short', e, 'tile', d.tileColor, { ...at(sg), rotation: (e.direction + (c === 'start' ? 8 : 0)) % 16 });
    }
  }
}
