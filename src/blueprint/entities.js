// Entity definitions: footprint, rotation, which official Wube model pieces represent it,
// and a flat colour for rendering. Entities without an official model get a placeholder.
//
// Piece keys match scripts/catalog.json and public/models/manifest.json.

const BELT_COLORS = {
  1: 0xf2b519, // yellow
  2: 0xe0372b, // red
  3: 0x3d9be9, // blue
  4: 0x43c45a, // green (turbo, Space Age)
};
const BASE_GREY = 0x6e6e6e;
const TILE_GREY = 0x4b4b4b;
const WALL_GREY = 0x9aa0a6;

/** @type {Record<string, object>} */
const DEFS = {};

function def(name, props) {
  DEFS[name] = {
    name,
    label: props.label ?? prettify(name),
    size: props.size ?? { w: 1, h: 1 },
    rotates: props.rotates ?? false,
    kind: props.kind ?? 'placeholder',
    tier: props.tier ?? 1,
    color: props.color ?? 0x5a5a5a,
    baseColor: props.baseColor ?? BASE_GREY,
    tileColor: props.tileColor ?? TILE_GREY,
    body: props.body ?? null, // single piece key or array of piece keys
    tile: props.tile ?? 'tile/empty',
    hasModel: props.hasModel ?? Boolean(props.body),
    maxUnderground: props.maxUnderground,
  };
  return DEFS[name];
}

function prettify(name) {
  return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---- Belts -------------------------------------------------------------
const BELT_TIERS = [
  ['transport-belt', 'underground-belt', 'splitter', 1, 5],
  ['fast-transport-belt', 'fast-underground-belt', 'fast-splitter', 2, 7],
  ['express-transport-belt', 'express-underground-belt', 'express-splitter', 3, 9],
  ['turbo-transport-belt', 'turbo-underground-belt', 'turbo-splitter', 4, 11],
];
for (const [belt, ug, splitter, tier, maxUg] of BELT_TIERS) {
  def(belt, { kind: 'belt', rotates: true, tier, color: BELT_COLORS[tier], hasModel: true, tile: 'tile/straight' });
  def(ug, { kind: 'underground', rotates: true, tier, color: BELT_COLORS[tier], hasModel: true, tile: 'tile/underground', maxUnderground: maxUg });
  def(splitter, { kind: 'splitter', rotates: true, tier, color: BELT_COLORS[tier], hasModel: true, size: { w: 2, h: 1 }, tile: 'tile/splitter' });
}

// ---- Inserters ---------------------------------------------------------
def('burner-inserter', { kind: 'inserter', rotates: true, color: 0x4d4d4d, body: 'inserter/basic', tile: 'tile/inserter' });
def('inserter', { kind: 'inserter', rotates: true, color: 0xe6c02f, body: 'inserter/basic', tile: 'tile/inserter' });
def('fast-inserter', { kind: 'inserter', rotates: true, color: 0x3f8fe0, body: 'inserter/basic', tile: 'tile/inserter' });
def('long-handed-inserter', { kind: 'inserter', rotates: true, color: 0xd6482f, body: 'inserter/long', tile: 'tile/inserter' });
def('bulk-inserter', { kind: 'inserter', rotates: true, color: 0x4dbe5e, body: 'inserter/bulk', tile: 'tile/inserter' });
def('stack-inserter', { kind: 'inserter', rotates: true, color: 0x33b5a0, body: 'inserter/stack', tile: 'tile/inserter' });
// In 1.x "stack-inserter" is what 2.0 calls the bulk inserter.
const STACK_INSERTER_1X = { ...def('stack-inserter-1x', { kind: 'inserter', rotates: true, color: 0x4dbe5e, body: 'inserter/bulk', tile: 'tile/inserter' }), name: 'stack-inserter', label: 'Stack Inserter' };
delete DEFS['stack-inserter-1x'];

// ---- Machines ----------------------------------------------------------
def('assembling-machine-1', { kind: 'machine', size: { w: 3, h: 3 }, color: 0xa8a8a8, body: 'assembling-machine', tile: 'tile/assembling-machine' });
def('assembling-machine-2', { kind: 'machine', size: { w: 3, h: 3 }, color: 0x5c8fd8, body: 'assembling-machine', tile: 'tile/assembling-machine' });
def('assembling-machine-3', { kind: 'machine', size: { w: 3, h: 3 }, color: 0xe6b63c, body: 'assembling-machine', tile: 'tile/assembling-machine' });
def('electric-mining-drill', { kind: 'machine', rotates: true, size: { w: 3, h: 3 }, color: 0x7d9b4a, body: 'electric-mining-drill', tile: 'tile/electric-mining-drill' });
def('stone-furnace', { kind: 'machine', size: { w: 2, h: 2 }, color: 0x9a8a78, body: 'stone-furnace', tile: 'tile/stone-furnace' });
def('steel-furnace', { kind: 'machine', size: { w: 2, h: 2 }, color: 0x9c9c9c, body: 'steel-furnace', tile: 'tile/steel-furnace' });

// ---- Chests ------------------------------------------------------------
def('wooden-chest', { kind: 'chest', color: 0x9c6b3c, body: 'chest/wooden-closed' });
def('iron-chest', { kind: 'chest', color: 0x8c9196, body: 'chest/iron-closed' });
def('steel-chest', { kind: 'chest', color: 0xb5b9bd, body: 'chest/steel-closed' });
const LOGISTIC = {
  'active-provider': 0x9b59b6,
  'passive-provider': 0xc0392b,
  storage: 0xf1c40f,
  buffer: 0x27ae60,
  requester: 0x2980b9,
};
for (const [kind, color] of Object.entries(LOGISTIC)) {
  def(`${kind}-chest`, { kind: 'chest', color, body: 'chest/logistics-closed' });
  def(`logistic-chest-${kind}`, { kind: 'chest', color, body: 'chest/logistics-closed', label: prettify(`${kind}-chest`) });
}

// ---- Poles & walls -----------------------------------------------------
def('small-electric-pole', { kind: 'pole', color: 0x8a6a42, body: 'small-electric-pole' });
def('stone-wall', { kind: 'wall', color: WALL_GREY, hasModel: true, tile: 'tile/wall-straight' });

// ---- Placeholders with known footprints --------------------------------
const PLACEHOLDERS = {
  'burner-mining-drill': [2, 2, true],
  'electric-furnace': [3, 3],
  'medium-electric-pole': [1, 1],
  'big-electric-pole': [2, 2],
  substation: [2, 2],
  gate: [1, 1, true],
  lab: [3, 3],
  radar: [3, 3],
  'oil-refinery': [5, 5, true],
  'chemical-plant': [3, 3, true],
  centrifuge: [3, 3],
  'steam-engine': [3, 5, true],
  'steam-turbine': [3, 5, true],
  boiler: [3, 2, true],
  'heat-exchanger': [3, 2, true],
  'heat-pipe': [1, 1],
  'nuclear-reactor': [5, 5],
  'offshore-pump': [1, 2, true],
  pump: [1, 2, true],
  pipe: [1, 1],
  'pipe-to-ground': [1, 1, true],
  'storage-tank': [3, 3, true],
  'solar-panel': [3, 3],
  accumulator: [2, 2],
  beacon: [3, 3],
  roboport: [4, 4],
  'straight-rail': [2, 2, true],
  'train-stop': [2, 2, true],
  'rail-signal': [1, 1, true],
  'rail-chain-signal': [1, 1, true],
  'gun-turret': [2, 2],
  'laser-turret': [2, 2],
  'flamethrower-turret': [2, 3, true],
  'artillery-turret': [3, 3],
  'constant-combinator': [1, 1, true],
  'arithmetic-combinator': [1, 2, true],
  'decider-combinator': [1, 2, true],
  'selector-combinator': [1, 2, true],
  'power-switch': [2, 2],
  'programmable-speaker': [1, 1],
  'small-lamp': [1, 1],
  'rocket-silo': [9, 9],
  'land-mine': [1, 1],
  'cargo-landing-pad': [8, 8],
  'electromagnetic-plant': [4, 4],
  foundry: [4, 4, true],
  biochamber: [3, 3],
  'cryogenic-plant': [5, 5, true],
  recycler: [2, 3, true],
  'big-mining-drill': [5, 5, true],
  'agricultural-tower': [3, 3],
  crusher: [3, 3, true],
  'space-platform-hub': [8, 8],
  'cargo-bay': [2, 2],
  thruster: [5, 5],
  asteroid: [1, 1],
  'heating-tower': [3, 3],
  'lightning-rod': [2, 2],
  'lightning-collector': [2, 2],
  'fusion-reactor': [7, 7, true],
  'fusion-generator': [3, 5, true],
  'tesla-turret': [2, 2],
  'rocket-turret': [4, 4],
  'railgun-turret': [4, 4],
  'display-panel': [1, 1, true],
};
for (const [name, [w, h, rotates]] of Object.entries(PLACEHOLDERS)) {
  def(name, { kind: 'placeholder', size: { w, h }, rotates: Boolean(rotates), hasModel: false });
}

/**
 * Look up an entity definition. Unknown entities get a 1x1 placeholder.
 * @param {string} name prototype name
 * @param {number} versionMajor 1 or 2
 */
export function getEntityDef(name, versionMajor = 2) {
  if (name === 'stack-inserter' && versionMajor < 2) return STACK_INSERTER_1X;
  return DEFS[name] ?? unknownDef(name);
}

const unknownCache = new Map();
function unknownDef(name) {
  if (!unknownCache.has(name)) {
    unknownCache.set(name, {
      name,
      label: prettify(name),
      size: { w: 1, h: 1 },
      rotates: false,
      kind: 'placeholder',
      tier: 1,
      color: 0x5a5a5a,
      baseColor: BASE_GREY,
      tileColor: TILE_GREY,
      body: null,
      tile: 'tile/empty',
      hasModel: false,
      unknown: true,
    });
  }
  return unknownCache.get(name);
}

export const ENTITY_DEFS = DEFS;
export { BELT_COLORS, BASE_GREY, TILE_GREY, WALL_GREY };
