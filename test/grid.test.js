import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkLength, tilePlates, plateKey, tilePlatesCompact, seamPins } from '../src/blueprint/grid.js';
import { normalizeBlueprint } from '../src/blueprint/normalize.js';
import { buildPlacements } from '../src/blueprint/placements.js';

test('chunkLength never leaves a remainder of 1 when avoidable', () => {
  assert.deepEqual(chunkLength(1), [1]);
  assert.deepEqual(chunkLength(2), [2]);
  assert.deepEqual(chunkLength(10), [10]);
  assert.deepEqual(chunkLength(11), [9, 2]);
  assert.deepEqual(chunkLength(21), [10, 9, 2]);
  assert.deepEqual(chunkLength(25), [10, 10, 5]);
});

test('plate keys are AxB with A <= B', () => {
  assert.equal(plateKey(3, 7), 'grid/3x7');
  assert.equal(plateKey(7, 3), 'grid/3x7');
  assert.equal(plateKey(1, 5), 'grid/1x1');
});

test('tilePlates covers the whole footprint', () => {
  const { plates, pins } = tilePlates({ minX: -2, minY: 0, w: 13, h: 4 });
  const area = plates.reduce((a, p) => a + p.w * p.h, 0);
  assert.equal(area, 13 * 4);
  assert.equal(plates.length, 2);
  assert.equal(pins, 4, 'one Grid PIN per tile along the shared edge');
});

test('placements produce bodies, tiles, empty tiles and plates', () => {
  const V2 = Number((2n << 48n) | (60n << 16n));
  const bp = {
    entities: [
      { entity_number: 1, name: 'assembling-machine-1', position: { x: 1.5, y: 1.5 } },
      { entity_number: 2, name: 'inserter', position: { x: 3.5, y: 1.5 }, direction: 12 },
      { entity_number: 3, name: 'iron-chest', position: { x: 4.5, y: 1.5 } },
      { entity_number: 4, name: 'lab', position: { x: 1.5, y: 4.5 } },
    ],
    version: V2,
  };
  const norm = normalizeBlueprint(bp);
  const pl = buildPlacements(norm);
  const keys = pl.pieces.map((p) => p.key);
  assert.ok(keys.includes('assembling-machine'));
  assert.ok(keys.includes('tile/assembling-machine'));
  assert.ok(keys.includes('inserter/basic-closed'));
  assert.ok(keys.includes('inserter/base-single'));
  assert.ok(keys.includes('chest/iron-closed'));
  assert.equal(pl.placeholders.length, 1);
  assert.equal(pl.placeholders[0].name, 'lab');
  // footprint 5x6 = 30 cells; covered 9+1+1 = 11 → 19 empty tiles, plus the chest sits on an empty tile → 20
  assert.equal(pl.bounds.w, 5);
  assert.equal(pl.bounds.h, 6);
  assert.equal(keys.filter((k) => k === "tile/empty").length, 20);
  assert.equal(pl.pieces.filter((p) => p.group === 'grid').length, 1);
  assert.equal(pl.pieces.find((p) => p.group === 'grid').key, 'grid/5x6');
});

test('compact tiling only plates occupied regions and counts seam pins per tile', () => {
  // An L: a 12x3 bar along the top and a 3x9 bar down the left, inside a 12x12 box.
  const occ = new Set();
  for (let x = 0; x < 12; x++) for (let y = 0; y < 3; y++) occ.add(`${x},${y}`);
  for (let x = 0; x < 3; x++) for (let y = 3; y < 12; y++) occ.add(`${x},${y}`);
  const { plates, pins } = tilePlatesCompact({ minX: 0, minY: 0, maxX: 12, maxY: 12, w: 12, h: 12 }, occ);
  const area = plates.reduce((a, p) => a + p.w * p.h, 0);
  assert.ok(area < 144, 'does not cover the empty quadrant');
  const covers = (x, y) => plates.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
  for (const [x, y] of [[11, 0], [0, 11], [2, 5]]) assert.ok(covers(x, y), `covers ${x},${y}`);
  assert.ok(!covers(8, 8), 'no plate at 8,8');
  assert.equal(pins, seamPins(plates));
  assert.equal(seamPins([{ x: 0, y: 0, w: 10, h: 4 }, { x: 10, y: 0, w: 3, h: 4 }]), 4);
});

test('plate size can be capped to a printer bed', () => {
  assert.deepEqual(chunkLength(13, 4), [4, 4, 3, 2]);
  assert.deepEqual(chunkLength(7, 7), [7]);
  const { plates } = tilePlates({ minX: 0, minY: 0, w: 13, h: 9 }, 4);
  assert.ok(plates.every((p) => p.w <= 4 && p.h <= 4), 'no plate larger than 4x4');
  assert.equal(plates.reduce((a, p) => a + p.w * p.h, 0), 13 * 9);
});
