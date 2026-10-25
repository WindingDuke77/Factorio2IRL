import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBlueprintString, encodeBlueprintJson } from '../src/blueprint/decode.js';
import { getVersionMajor, normalizeBlueprint, flattenBook, toCardinal } from '../src/blueprint/normalize.js';

const V2 = Number((2n << 48n) | (60n << 16n));
const V1 = Number((1n << 48n) | (1n << 32n) | (110n << 16n));

test('round-trips a blueprint through encode/decode', async () => {
  const json = { blueprint: { item: 'blueprint', label: 'x', entities: [{ entity_number: 1, name: 'transport-belt', position: { x: 0.5, y: 0.5 }, direction: 4 }], version: V2 } };
  const str = await encodeBlueprintJson(json);
  assert.equal(str[0], '0');
  const back = await decodeBlueprintString(str);
  assert.deepEqual(back, json);
});

test('accepts raw JSON and rejects junk', async () => {
  const json = { blueprint: { item: 'blueprint', entities: [] } };
  assert.deepEqual(await decodeBlueprintString(JSON.stringify(json)), json);
  await assert.rejects(() => decodeBlueprintString('hello world'), /version byte/);
  await assert.rejects(() => decodeBlueprintString('0!!!'), /base64/);
  await assert.rejects(() => decodeBlueprintString(''), /Nothing/);
});

test('version major is read from the top 16 bits', () => {
  assert.equal(getVersionMajor(V2), 2);
  assert.equal(getVersionMajor(V1), 1);
  assert.equal(getVersionMajor(undefined), 2);
});

test('toCardinal snaps 16-way directions', () => {
  assert.equal(toCardinal(0), 0);
  assert.equal(toCardinal(1), 0);
  assert.equal(toCardinal(3), 4);
  assert.equal(toCardinal(15), 0);
  assert.equal(toCardinal(13), 12);
});

test('1.x directions are doubled, 2.0 directions kept', () => {
  const bp1 = { entities: [{ entity_number: 1, name: 'inserter', position: { x: 0.5, y: 0.5 }, direction: 6 }], version: V1 };
  const bp2 = { entities: [{ entity_number: 1, name: 'inserter', position: { x: 0.5, y: 0.5 }, direction: 12 }], version: V2 };
  assert.equal(normalizeBlueprint(bp1).entities[0].direction, 12);
  assert.equal(normalizeBlueprint(bp2).entities[0].direction, 12);
});

test('1.x stack-inserter maps to the bulk model, 2.0 to the stack model', () => {
  const bp1 = { entities: [{ entity_number: 1, name: 'stack-inserter', position: { x: 0.5, y: 0.5 } }], version: V1 };
  const bp2 = { entities: [{ entity_number: 1, name: 'stack-inserter', position: { x: 0.5, y: 0.5 } }], version: V2 };
  assert.equal(normalizeBlueprint(bp1).entities[0].def.body, 'inserter/bulk');
  assert.equal(normalizeBlueprint(bp2).entities[0].def.body, 'inserter/stack');
});

test('footprints rotate and snap to integer tiles', () => {
  const bp = {
    entities: [
      { entity_number: 1, name: 'assembling-machine-1', position: { x: 1.5, y: 1.5 } },
      { entity_number: 2, name: 'splitter', position: { x: 7.5, y: 8 }, direction: 4 },
      { entity_number: 3, name: 'stone-furnace', position: { x: 7, y: 1 } },
    ],
    version: V2,
  };
  const [am, sp, fu] = normalizeBlueprint(bp).entities;
  assert.deepEqual([am.left, am.top, am.w, am.h], [0, 0, 3, 3]);
  assert.deepEqual([sp.left, sp.top, sp.w, sp.h], [7, 7, 1, 2]);
  assert.deepEqual([fu.left, fu.top, fu.w, fu.h], [6, 0, 2, 2]);
});

test('flattenBook walks nested books', () => {
  const bp = (label) => ({ blueprint: { item: 'blueprint', label, entities: [] } });
  const book = { blueprint_book: { label: 'Outer', blueprints: [{ index: 0, ...bp('A') }, { index: 1, blueprint_book: { label: 'Inner', blueprints: [{ index: 0, ...bp('B') }] } }] } };
  const flat = flattenBook(book);
  assert.deepEqual(flat.map((f) => f.label), ['Outer / A', 'Outer / Inner / B']);
  assert.deepEqual(flat.map((f) => f.path), ['0', '1/0']);
});
