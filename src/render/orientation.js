// Per-part placement configuration, loaded from JSON so it can be tuned without touching code:
//   src/config/parts/<key with __>.json   one file per converted piece
//   src/config/composites/<entity>.json   assemblies made of several pieces (drill, pole, furnace)
//   src/config/levels.json                stacking heights of plate / tile / tile pocket
//
// A part file:
//   rotation  0/4/8/12 cardinal steps added to the entity direction so the model faces north
//   tilt      degrees about X/Y/Z applied in the piece's own frame (printing pose -> installed)
//   offset    tiles, applied after re-centring (e.g. move a lid to its hinge)
//   stackOn   key of the piece this one sits on; inset = how far (tiles) it sinks into it
//   rawFrame  keep the STL's raw X/Y offset instead of centring on the bounding box (walls)
//
// The `?dev` page has a tuning panel that edits these live and saves them back to the files.

import levels from '../config/levels.json';

const partFiles = import.meta.glob('../config/parts/*.json', { eager: true, import: 'default' });
const compositeFiles = import.meta.glob('../config/composites/*.json', { eager: true, import: 'default' });

/** key -> part config (mutable: the tuner edits these in place). */
export const PARTS = {};
for (const cfg of Object.values(partFiles)) PARTS[cfg.key] = cfg;

/** entity name -> list of composite parts. */
export const COMPOSITES = {};
for (const c of Object.values(compositeFiles)) COMPOSITES[c.entity] = c.parts;

/** Stacking levels (tiles). */
export const LEVELS = levels;

const DEFAULT = Object.freeze({ rotation: 0, tilt: { x: 0, y: 0, z: 0 }, offset: { x: 0, y: 0, z: 0 }, stackOn: null, inset: 0, rawFrame: false });

export function partConfig(key) {
  return PARTS[key] ?? DEFAULT;
}

/** Create (if missing) and return a mutable config for a key. */
export function ensurePart(key) {
  if (!PARTS[key]) PARTS[key] = { key, ...structuredClone(DEFAULT), notes: '' };
  PARTS[key].tilt ??= { x: 0, y: 0, z: 0 };
  PARTS[key].offset ??= { x: 0, y: 0, z: 0 };
  return PARTS[key];
}

export const partFileName = (key) => key.replaceAll('/', '__');
