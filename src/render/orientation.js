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
  // Open chest lids are propped up at the back hinge.
  'chest/wooden-lid': { x: -72 },
  'chest/iron-lid': { x: -72 },
  'chest/steel-lid': { x: -72 },
};

/** Offset (tiles, in the piece's own frame) applied after re-centring, e.g. to move a lid to its hinge. */
export const PIECE_OFFSET = {
  'chest/wooden-lid': [0, -0.02, -0.3],
  'chest/iron-lid': [0, -0.02, -0.29],
  'chest/steel-lid': [0, -0.02, -0.27],
};

/**
 * Vertical stacking: which piece a piece sits on, and how far it sinks into it (tiles).
 * Chains are followed (items sit on belt tops, which sit on belt bottoms).
 */
export const STACK_ON = {
  // The chevron plate (2.76 mm) rests on the base's 4.75 mm support plateau: its surface ends
  // at 7.5 mm, so the 7 mm plus pegs slot into it and the 6 mm side rails stay below it.
  'belt/straight-top': { on: 'belt/straight-bottom', inset: 0.09 },
  'belt/turn-l-top': { on: 'belt/turn-bottom', inset: 0.09 },
  'belt/turn-r-top': { on: 'belt/turn-bottom', inset: 0.09 },
  'belt/underground-in-top': { on: 'belt/underground-in-bottom', inset: 0.2 },
  'belt/underground-out-top': { on: 'belt/underground-out-bottom', inset: 0.2 },
  'belt/splitter-top': { on: 'belt/splitter-bottom', inset: 0.02 },
  'belt/start-long-top': { on: 'belt/start-long-bottom', inset: 0.12 },
  'belt/start-medium-top': { on: 'belt/start-medium-bottom', inset: 0.09 },
  'belt/end-long-top': { on: 'belt/end-long-bottom', inset: 0.125 },
  'belt/end-medium-top': { on: 'belt/end-medium-bottom', inset: 0.09 },
  'inserter/basic-closed': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/basic-open': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/long-closed': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/long-open': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/bulk-closed': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/bulk-open': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/stack-closed': { on: 'inserter/base-single', inset: 0.1 },
  'inserter/stack-open': { on: 'inserter/base-single', inset: 0.1 },
  'chest/wooden-lid': { on: 'chest/wooden-open', inset: 0.02 },
  'chest/iron-lid': { on: 'chest/iron-open', inset: 0.02 },
  'chest/steel-lid': { on: 'chest/steel-open', inset: 0.02 },
  'chest/logistics-lid-closed': { on: 'chest/logistics-closed', inset: 0.09 },
  'chest/logistics-lid-open': { on: 'chest/logistics-open', inset: 0.06 },
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
    // Two identical half-profiles glued back to back make the round pole with one crossarm.
    { key: 'pole/profile', pos: [0, 0.62, 0], rot: [0, 0, 0] },
    { key: 'pole/profile', pos: [0, 0.62, 0], rot: [0, 180, 0] },
  ],
  'electric-mining-drill': [
    { key: 'drill/frame', pos: [0, 0, 0] },
    { key: 'drill/bit', pos: [0, 0.1, 0] },
    { key: 'drill/rod', pos: [0, 0.8, 0] },
    { key: 'drill/head', pos: [0, 1.42, 0] },
    // The frame is an L of two rails; the legs run from the head down to the two rail ends,
    // which build.js finds from the frame geometry (see railEnds()).
    { key: 'drill/leg', from: 'head', to: 'railEnd0', t: 0.3 },
    { key: 'drill/leg', from: 'head', to: 'railEnd1', t: 0.3 },
    { key: 'drill/rail', from: 'head', to: 'railEnd0', t: 0.78 },
    { key: 'drill/rail', from: 'head', to: 'railEnd1', t: 0.78 },
  ],
};

/**
 * Pieces modelled in a shared frame around their tile (the tile is centred on the raw origin),
 * where the raw X/Y offset must be kept instead of re-centring on the bounding box. Wall pins
 * stick out on one side, so bbox-centring would shift every wall by up to 0.16 tiles.
 */
export const RAW_FRAME = /^wall\//;

/**
 * Stacking levels measured from the STLs (1 tile = 25 mm):
 *   grid plate = 2 mm slab + 1.5 mm rim, so a tile drops into a pocket whose floor is 2 mm up;
 *   tiles are 2 mm thick; shaped tiles have a 1 mm pocket the model base (or the inserter's
 *   feet) sits in; the Empty Tile is solid, so chests and poles sit on its top.
 */
export const TILE_FLOOR = 0.08; // pocket floor of the grid plate
export const TILE_THICK = 0.08; // tile thickness
export const TILE_POCKET = 0.04; // floor of a shaped tile's pocket
