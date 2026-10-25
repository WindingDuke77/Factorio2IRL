// Turn raw blueprint JSON into a normalised, version-independent structure.
//
// - Flattens blueprint books into a list of { path, label, blueprint } entries.
// - Normalises `direction` to the 2.0 16-step scale (N=0, E=4, S=8, W=12).
// - Rounds positions to integer tile rects and attaches the entity definition.

import { getEntityDef } from './entities.js';

export const DIR = Object.freeze({ N: 0, E: 4, S: 8, W: 12 });

/** Cardinal unit vectors in blueprint space (x right, y DOWN, like Factorio). */
export const DIR_VEC = Object.freeze({
  0: { x: 0, y: -1 },
  4: { x: 1, y: 0 },
  8: { x: 0, y: 1 },
  12: { x: -1, y: 0 },
});

export function oppositeDir(d) {
  return (d + 8) % 16;
}
export function rotateDirCW(d) {
  return (d + 4) % 16;
}
export function rotateDirCCW(d) {
  return (d + 12) % 16;
}
/** Snap any 0..15 direction to the nearest cardinal (0,4,8,12). */
export function toCardinal(d) {
  return (Math.round((((d ?? 0) % 16) + 16) % 16 / 4) * 4) % 16;
}

/**
 * The `version` field packs major.minor.patch.dev into 64 bits (16 bits each).
 * @returns {number} major version (1 or 2), defaulting to 2 when missing.
 */
export function getVersionMajor(version) {
  if (version === undefined || version === null) return 2;
  try {
    const big = typeof version === 'bigint' ? version : BigInt(Math.trunc(Number(version)));
    const major = Number(big >> 48n);
    return major > 0 ? major : 2;
  } catch {
    return 2;
  }
}

/**
 * Flatten a decoded blueprint/book into a list of blueprints.
 * @param {object} decoded `{ blueprint }` or `{ blueprint_book }`
 * @returns {Array<{ path: string, label: string, blueprint: object }>}
 */
export function flattenBook(decoded, path = '', out = []) {
  if (!decoded || typeof decoded !== 'object') return out;
  if (decoded.blueprint) {
    const bp = decoded.blueprint;
    out.push({
      path: path || '0',
      label: bp.label || `Blueprint ${out.length + 1}`,
      blueprint: bp,
    });
  } else if (decoded.blueprint_book) {
    const book = decoded.blueprint_book;
    const bookLabel = book.label || 'Book';
    for (const child of book.blueprints ?? []) {
      const idx = child.index ?? 0;
      const childPath = path ? `${path}/${idx}` : `${idx}`;
      const before = out.length;
      flattenBook(child, childPath, out);
      for (let i = before; i < out.length; i++) {
        out[i].label = `${bookLabel} / ${out[i].label}`;
      }
    }
  }
  return out;
}

/**
 * Normalise one blueprint's entities.
 * @param {object} blueprint the inner `blueprint` object
 */
export function normalizeBlueprint(blueprint) {
  const versionMajor = getVersionMajor(blueprint.version);
  const dirScale = versionMajor >= 2 ? 1 : 2;

  const entities = (blueprint.entities ?? []).map((e, i) => {
    const def = getEntityDef(e.name, versionMajor);
    const rawDir = Number(e.direction ?? 0);
    const direction = def.rotates ? toCardinal(rawDir * dirScale) : 0;
    const { w, h } = footprintFor(def, direction);
    // Factorio positions are entity centres.
    const x = Number(e.position?.x ?? 0);
    const y = Number(e.position?.y ?? 0);
    const left = Math.round(x - w / 2);
    const top = Math.round(y - h / 2);
    return {
      id: e.entity_number ?? i + 1,
      name: e.name,
      def,
      direction,
      x,
      y,
      left,
      top,
      w,
      h,
      type: e.type,
      recipe: e.recipe,
      raw: e,
    };
  });

  const tiles = (blueprint.tiles ?? []).map((t) => ({
    name: t.name,
    x: Math.floor(Number(t.position?.x ?? 0)),
    y: Math.floor(Number(t.position?.y ?? 0)),
  }));

  return {
    label: blueprint.label ?? '',
    description: blueprint.description ?? '',
    versionMajor,
    entities,
    tiles,
    icons: blueprint.icons ?? [],
  };
}

/** Footprint in tiles after rotation. */
export function footprintFor(def, direction) {
  const rotated = direction === DIR.E || direction === DIR.W;
  return rotated ? { w: def.size.h, h: def.size.w } : { w: def.size.w, h: def.size.h };
}

/** Integer tile bounding box of a set of normalised entities (and tiles). */
export function boundsOf(entities, tiles = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of entities) {
    minX = Math.min(minX, e.left);
    minY = Math.min(minY, e.top);
    maxX = Math.max(maxX, e.left + e.w);
    maxY = Math.max(maxY, e.top + e.h);
  }
  for (const t of tiles) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + 1);
    maxY = Math.max(maxY, t.y + 1);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
