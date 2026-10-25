// Resolve wall piece variants from the four neighbours (N/E/S/W).
//
// Naming follows Wube's STL set:
//   Walls X-Junction, T-Junction N/E/S/W, Corner NE/NW/SE/SW, Straight NS/WE, Ending N/E/S/W, Pylon.
//
// Conventions (checked against the STL geometry — connector pins/sockets protrude on the
// connected sides):
//   * Corner NE  = connected towards N and E.
//   * T-Junction N = three connections, the stem (odd arm) pointing N (bar runs W-E).
//   * Ending N   = the rounded free end faces N, so the single connection is towards S.

import { buildCellMap } from './belts.js';

const N = 1, E = 2, S = 4, W = 8;

const WALL_LIKE = new Set(['stone-wall', 'gate']);

const BY_MASK = {
  0: { piece: 'wall/pylon', tile: 'tile/wall-pylon' },
  [N]: { piece: 'wall/ending-s', tile: 'tile/wall-ending-ns' },
  [S]: { piece: 'wall/ending-n', tile: 'tile/wall-ending-ns' },
  [E]: { piece: 'wall/ending-w', tile: 'tile/wall-ending-we' },
  [W]: { piece: 'wall/ending-e', tile: 'tile/wall-ending-we' },
  [N | S]: { piece: 'wall/straight-ns', tile: 'tile/wall-straight', rotation: 0 },
  [E | W]: { piece: 'wall/straight-we', tile: 'tile/wall-straight', rotation: 4 },
  [N | E]: { piece: 'wall/corner-ne', tile: 'tile/wall-corner-ne-sw' },
  [S | W]: { piece: 'wall/corner-sw', tile: 'tile/wall-corner-ne-sw' },
  [N | W]: { piece: 'wall/corner-nw', tile: 'tile/wall-corner-nw-se' },
  [S | E]: { piece: 'wall/corner-se', tile: 'tile/wall-corner-nw-se' },
  [N | E | W]: { piece: 'wall/t-junction-n', tile: 'tile/wall-t-junction', rotation: 0 },
  [S | E | W]: { piece: 'wall/t-junction-s', tile: 'tile/wall-t-junction', rotation: 8 },
  [N | S | E]: { piece: 'wall/t-junction-e', tile: 'tile/wall-t-junction', rotation: 4 },
  [N | S | W]: { piece: 'wall/t-junction-w', tile: 'tile/wall-t-junction', rotation: 12 },
  [N | E | S | W]: { piece: 'wall/x-junction', tile: 'tile/wall-x-junction' },
};

/**
 * @param {Array} entities normalised entities
 * @returns {Map<number, {piece: string, tile: string, mask: number}>}
 */
export function resolveWallShapes(entities) {
  const cells = buildCellMap(entities);
  const out = new Map();
  const isWall = (x, y) => {
    const e = cells.get(`${x},${y}`);
    return Boolean(e && WALL_LIKE.has(e.name));
  };
  for (const e of entities) {
    if (e.name !== 'stone-wall') continue;
    let mask = 0;
    if (isWall(e.left, e.top - 1)) mask |= N;
    if (isWall(e.left + 1, e.top)) mask |= E;
    if (isWall(e.left, e.top + 1)) mask |= S;
    if (isWall(e.left - 1, e.top)) mask |= W;
    out.set(e.id, { ...BY_MASK[mask], mask });
  }
  return out;
}

export const WALL_MASK = { N, E, S, W };
