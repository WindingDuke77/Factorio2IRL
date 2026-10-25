import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBlueprint } from '../src/blueprint/normalize.js';
import { resolveBeltShapes } from '../src/blueprint/belts.js';
import { resolveWallShapes } from '../src/blueprint/walls.js';

const V2 = Number((2n << 48n) | (60n << 16n));
let n = 0;
const belt = (x, y, direction, name = 'transport-belt', extra = {}) => ({ entity_number: ++n, name, position: { x: x + 0.5, y: y + 0.5 }, direction, ...extra });
const shapesOf = (entities) => {
  const norm = normalizeBlueprint({ entities, version: V2 });
  const shapes = resolveBeltShapes(norm.entities);
  return { norm, shapes, at: (x, y) => shapes.get(norm.entities.find((e) => e.left === x && e.top === y).id) };
};

test('straight line: start, middle, end', () => {
  n = 0;
  const { at } = shapesOf([belt(0, 0, 4), belt(1, 0, 4), belt(2, 0, 4)]);
  assert.deepEqual([at(0, 0).shape, at(0, 0).isStart, at(0, 0).isEnd], ['straight', true, false]);
  assert.deepEqual([at(1, 0).shape, at(1, 0).isStart, at(1, 0).isEnd], ['straight', false, false]);
  assert.deepEqual([at(2, 0).shape, at(2, 0).isStart, at(2, 0).isEnd], ['straight', false, true]);
});

test('east then south is a right turn; east then north is a left turn', () => {
  n = 0;
  const r = shapesOf([belt(0, 0, 4), belt(1, 0, 8), belt(1, 1, 8)]);
  assert.equal(r.at(1, 0).shape, 'turn-r');
  n = 0;
  const l = shapesOf([belt(0, 2, 4), belt(1, 2, 0), belt(1, 1, 0)]);
  assert.equal(l.at(1, 2).shape, 'turn-l');
});

test('side-load onto a belt fed from behind stays straight', () => {
  n = 0;
  const { at } = shapesOf([belt(0, 0, 4), belt(1, 0, 4), belt(2, 0, 4), belt(1, 1, 0)]);
  assert.equal(at(1, 0).shape, 'straight');
  assert.equal(at(1, 0).isStart, false);
  assert.equal(at(1, 1).isEnd, false); // the side-loader feeds into a belt, so it is not an end
});

test('two side feeders and nothing behind stays straight', () => {
  n = 0;
  const { at } = shapesOf([belt(1, 0, 4), belt(1, -1, 8), belt(1, 1, 0), belt(2, 0, 4)]);
  assert.equal(at(1, 0).shape, 'straight');
});

test('head-on belt is an end, not a feeder', () => {
  n = 0;
  const { at } = shapesOf([belt(0, 0, 4), belt(1, 0, 12)]);
  assert.equal(at(0, 0).isEnd, true);
  assert.equal(at(1, 0).isEnd, true);
  assert.equal(at(0, 0).shape, 'straight');
});

test('underground pair links and feeds the belt after it', () => {
  n = 0;
  const ents = [belt(0, 0, 4), belt(1, 0, 4, 'underground-belt', { type: 'input' }), belt(4, 0, 4, 'underground-belt', { type: 'output' }), belt(5, 0, 4)];
  const { at, norm } = shapesOf(ents);
  assert.equal(at(1, 0).shape, 'underground-in');
  assert.equal(at(4, 0).shape, 'underground-out');
  assert.equal(at(1, 0).partnerId, norm.entities[2].id);
  assert.equal(at(4, 0).partnerId, norm.entities[1].id);
  assert.equal(at(0, 0).isEnd, false);
  assert.equal(at(5, 0).isStart, false);
  assert.equal(at(5, 0).isEnd, true);
});

test('splitter feeds both lanes ahead and is fed from behind', () => {
  n = 0;
  const ents = [belt(0, 0, 4), { entity_number: ++n, name: 'splitter', position: { x: 1.5, y: 1 }, direction: 4 }, belt(2, 0, 4), belt(2, 1, 4)];
  const { at } = shapesOf(ents);
  assert.equal(at(0, 0).isEnd, false);
  assert.equal(at(2, 0).isStart, false);
  assert.equal(at(2, 1).isStart, false);
  assert.equal(at(1, 0).shape, 'splitter');
});

test('walls pick junction variants from their neighbours', () => {
  n = 0;
  const wall = (x, y) => ({ entity_number: ++n, name: 'stone-wall', position: { x: x + 0.5, y: y + 0.5 } });
  //   .#.
  //   ###
  //   .#.   plus a lone wall far away and a straight run
  const ents = [wall(1, 0), wall(0, 1), wall(1, 1), wall(2, 1), wall(1, 2), wall(10, 10), wall(5, 0), wall(5, 1), wall(5, 2), wall(6, 2)];
  const norm = normalizeBlueprint({ entities: ents, version: V2 });
  const shapes = resolveWallShapes(norm.entities);
  const at = (x, y) => shapes.get(norm.entities.find((e) => e.left === x && e.top === y).id).piece;
  assert.equal(at(1, 1), 'wall/x-junction');
  assert.equal(at(1, 0), 'wall/ending-n'); // only connected to the south, cap faces north
  assert.equal(at(0, 1), 'wall/ending-w');
  assert.equal(at(10, 10), 'wall/pylon');
  assert.equal(at(5, 0), 'wall/ending-n');
  assert.equal(at(5, 1), 'wall/straight-ns');
  assert.equal(at(5, 2), 'wall/corner-ne');
  assert.equal(at(6, 2), 'wall/ending-e');
});
