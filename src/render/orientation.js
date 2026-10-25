// Per-piece orientation, stacking and assembly rules, tuned against the converted Wube models
// and Wube's own product photos / assembly guides (see README). The converted GLBs are centred
// on their own bounding box with the base at y=0. Entity direction 0 = north = −Z in the scene.
//
// Findings from the STL inspection (scripts/catalog.json keys):
//   * Belt tops/bottoms flow along +X ("east"); start caps are at the west end, end caps east.
//   * Turn pieces are quarter circles with the pivot at the NW corner. "Turn L" enters from the
//     west and exits north; "Turn R" enters from the north and exits west.
//   * Underground hoods are modelled standing on their mouth (nose up) for printing; the
//     "In" base flows west into the hood, the "Out" base flows east out of it.
//   * Inserter arms are flat side profiles folded at two hex hinges (done in models.js).
//   * The drill, steel furnace and small pole STLs are print plates of loose parts; the converter
//     splits them into components which COMPOSITES below assemble.
//   * Walls: "Ending N" has its rounded free end facing north; corners/T-junctions are named
//     by the sides they connect to.

/**
 * Rotation offset in cardinal steps (0/4/8/12 = 0/90/180/270 degrees clockwise from above)
 * added to the entity direction so that the model faces direction 0 (north).
 */
export const PIECE_ROTATION = {
  'belt/straight-top': 12,
  'belt/straight-bottom': 12,
  'belt/start-long-top': 12,
  'belt/start-long-bottom': 12,
  'belt/start-medium-top': 12,
  'belt/start-medium-bottom': 12,
  'belt/start-short': 12,
  'belt/end-long-top': 12,
  'belt/end-long-bottom': 12,
  'belt/end-medium-top': 12,
  'belt/end-medium-bottom': 12,
  'belt/end-short': 12,
  'belt/turn-l-top': 0,
  'belt/turn-r-top': 4,
  'belt/turn-bottom': 0,
  'belt/underground-in-top': 4,
  'belt/underground-in-bottom': 4,
  'belt/underground-out-top': 12,
  'belt/underground-out-bottom': 12,
  'belt/splitter-top': 12,
  'belt/splitter-bottom': 12,
  'tile/straight': 12,
  'tile/turn': 0,
  'tile/underground': 4,
  'tile/splitter': 12,
  'tile/end-long': 12,
  'tile/end-medium': 12,
  'tile/end-short': 12,
  // Inserters: the entity direction is the pickup side; the folded arm reaches towards −Z.
  'inserter/basic-closed': 8,
  'inserter/basic-open': 8,
  'inserter/long-closed': 8,
  'inserter/long-open': 8,
  'inserter/bulk-closed': 8,
  'inserter/bulk-open': 8,
  'inserter/stack-closed': 8,
  'inserter/stack-open': 8,
  'inserter/base-single': 8,
  'inserter/base': 8,
};

/**
 * Fixed tilt (degrees) applied in the piece's own frame before the yaw, for pieces that are
 * modelled in a printing pose rather than their installed pose.
 */
export const PIECE_TILT = {
  'belt/underground-in-top': { z: 90 },
  'belt/underground-out-top': { z: 90 },
};

/**
 * Vertical stacking: which piece a piece sits on, and how far it sinks into it (tiles).
 * Chains are followed (items sit on belt tops, which sit on belt bottoms).
 */
export const STACK_ON = {
  'belt/straight-top': { on: 'belt/straight-bottom', inset: 0.12 },
  'belt/turn-l-top': { on: 'belt/turn-bottom', inset: 0.12 },
  'belt/turn-r-top': { on: 'belt/turn-bottom', inset: 0.12 },
  'belt/underground-in-top': { on: 'belt/underground-in-bottom', inset: 0.2 },
  'belt/underground-out-top': { on: 'belt/underground-out-bottom', inset: 0.2 },
  'belt/splitter-top': { on: 'belt/splitter-bottom', inset: 0.16 },
  'belt/start-long-top': { on: 'belt/start-long-bottom', inset: 0.12 },
  'belt/start-medium-top': { on: 'belt/start-medium-bottom', inset: 0.12 },
  'belt/end-long-top': { on: 'belt/end-long-bottom', inset: 0.12 },
  'belt/end-medium-top': { on: 'belt/end-medium-bottom', inset: 0.12 },
  'inserter/basic-closed': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/basic-open': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/long-closed': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/long-open': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/bulk-closed': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/bulk-open': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/stack-closed': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/stack-open': { on: 'inserter/base-single', inset: 0.1 },
  'item/gear': { on: 'belt/straight-top', inset: 0.01 },
  'item/circuit': { on: 'belt/straight-top', inset: 0.01 },
  'item/copper-cable': { on: 'belt/straight-top', inset: 0.01 },
  'item/iron-or-copper-plate': { on: 'belt/straight-top', inset: 0.01 },
  'item/steel-plate': { on: 'belt/straight-top', inset: 0.01 },
  'item/science-bottle': { on: 'belt/straight-top', inset: 0.01 },
};

/**
 * Pieces assembled from several converted parts (print plates split by the converter).
 * Each part: { key, pos:[x,y,z], rot:[degX,degY,degZ] } in the entity's frame (tile centre, y=0 on
 * the tile), or { key, from, to, t } to align the part's long X axis from `from` to `to`, centred
 * at fraction `t` along that line.
 */
export const COMPOSITES = {
  'steel-furnace': [{ key: 'steel-furnace/body', pos: [0, 0, 0] }],
  'small-electric-pole': [
    { key: 'pole/base', pos: [0, 0, 0] },
    { key: 'pole/profile', pos: [0, 0.62, 0], rot: [0, 0, 0] },
    { key: 'pole/profile', pos: [0, 0.62, 0], rot: [0, 90, 0] },
  ],
  'electric-mining-drill': [
    { key: 'drill/frame', pos: [0, 0, 0] },
    { key: 'drill/bit', pos: [0, 0.1, 0] },
    { key: 'drill/rod', pos: [0, 0.8, 0] },
    { key: 'drill/head', pos: [0, 1.42, 0] },
    { key: 'drill/leg', from: [-0.3, 1.55, -0.15], to: [-1.2, 0.3, -1.2], t: 0.3 },
    { key: 'drill/leg', from: [0.3, 1.55, -0.15], to: [1.2, 0.3, -1.2], t: 0.3 },
    { key: 'drill/rail', from: [-0.3, 1.55, -0.15], to: [-1.2, 0.3, -1.2], t: 0.78 },
    { key: 'drill/rail', from: [0.3, 1.55, -0.15], to: [1.2, 0.3, -1.2], t: 0.78 },
  ],
};

/** How far (in tiles) a body sinks into its tile's pocket. */
export const BODY_INSET = 0.02;
/** How far a tile sinks into the grid plate. */
export const TILE_INSET = 0.0;
