// Resolve belt shapes (straight / turn / start / end / underground / splitter)
// from neighbour relationships, mirroring Factorio's own rules:
//   * a belt curves when nothing feeds it from behind and exactly one side feeds it;
//   * a belt fed from behind AND a side is a side-load (stays straight);
//   * "start" = nothing feeds this tile at all; "end" = the tile ahead accepts nothing.

import { DIR_VEC, oppositeDir, rotateDirCW, rotateDirCCW } from './normalize.js';

const BELT_KINDS = new Set(['belt', 'underground', 'splitter']);

function cellKey(x, y) {
  return `${x},${y}`;
}

/** Build a map from tile cell to the entity occupying it. */
export function buildCellMap(entities) {
  const map = new Map();
  for (const e of entities) {
    for (let dx = 0; dx < e.w; dx++) {
      for (let dy = 0; dy < e.h; dy++) {
        map.set(cellKey(e.left + dx, e.top + dy), e);
      }
    }
  }
  return map;
}

/** Does `e` push items out of cell (cx,cy) in direction `dir`? */
function outputsTo(e, dir) {
  if (!e || !BELT_KINDS.has(e.def.kind)) return false;
  if (e.def.kind === 'underground' && e.type !== 'output') return false;
  return e.direction === dir;
}

/** Does `e` accept items arriving from direction `fromDir` (the direction the items travel)? */
function acceptsFrom(e, fromDir) {
  if (!e || !BELT_KINDS.has(e.def.kind)) return false;
  if (e.def.kind === 'splitter') return e.direction === fromDir;
  if (e.def.kind === 'underground' && e.type === 'output') {
    // An underground exit is fed from below; only side-loading from the sides is possible.
    return fromDir !== e.direction && fromDir !== oppositeDir(e.direction);
  }
  // Belts and underground entrances accept from behind or either side, never head-on.
  return fromDir !== oppositeDir(e.direction);
}

/**
 * @param {Array} entities normalised entities (from normalizeBlueprint)
 * @returns {Map<number, object>} entity id -> shape info
 */
export function resolveBeltShapes(entities) {
  const cells = buildCellMap(entities);
  const shapes = new Map();

  const at = (x, y) => cells.get(cellKey(x, y));

  for (const e of entities) {
    if (!BELT_KINDS.has(e.def.kind)) continue;
    const d = e.direction;
    const fwd = DIR_VEC[d];
    const back = DIR_VEC[oppositeDir(d)];
    const leftDir = rotateDirCCW(d);
    const rightDir = rotateDirCW(d);
    const leftV = DIR_VEC[leftDir];
    const rightV = DIR_VEC[rightDir];

    if (e.def.kind === 'belt') {
      const x = e.left;
      const y = e.top;
      const behind = at(x + back.x, y + back.y);
      const left = at(x + leftV.x, y + leftV.y);
      const right = at(x + rightV.x, y + rightV.y);
      const ahead = at(x + fwd.x, y + fwd.y);

      const fedBehind = outputsTo(behind, d);
      // A feeder on the LEFT side is travelling towards the right (clockwise) direction.
      const fedLeft = outputsTo(left, rightDir);
      const fedRight = outputsTo(right, leftDir);

      let shape = 'straight';
      if (!fedBehind && fedLeft !== fedRight) {
        // Items arrive from the left side and turn to face `d`: that is a left turn.
        shape = fedLeft ? 'turn-l' : 'turn-r';
      }
      const isStart = !fedBehind && !fedLeft && !fedRight;
      const isEnd = !acceptsFrom(ahead, d);
      shapes.set(e.id, { kind: 'belt', shape, isStart, isEnd, tier: e.def.tier });
    } else if (e.def.kind === 'underground') {
      const isInput = e.type !== 'output';
      // Find the matching partner along the direction of travel.
      let partner = null;
      const max = e.def.maxUnderground ?? 5;
      const step = isInput ? fwd : back;
      for (let k = 1; k <= max; k++) {
        const other = at(e.left + step.x * k, e.top + step.y * k);
        if (other && other.def.kind === 'underground' && other.name === e.name && other.direction === d && (other.type !== 'output') !== isInput) {
          partner = other;
          break;
        }
        if (other && other.def.kind === 'underground' && other.name === e.name && other.direction === d && (other.type !== 'output') === isInput) {
          break; // another entrance/exit of the same kind blocks the tunnel
        }
      }
      shapes.set(e.id, { kind: 'underground', shape: isInput ? 'underground-in' : 'underground-out', partnerId: partner?.id ?? null, tier: e.def.tier });
    } else if (e.def.kind === 'splitter') {
      shapes.set(e.id, { kind: 'splitter', shape: 'splitter', tier: e.def.tier });
    }
  }

  return shapes;
}

export { BELT_KINDS, acceptsFrom, outputsTo };
