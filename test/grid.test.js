import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkLength, tilePlates, plateKey } from '../src/blueprint/grid.js';
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
  assert.equal(pins, 2, 'one Grid PIN per plate');
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
