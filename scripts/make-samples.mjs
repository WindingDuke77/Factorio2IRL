// Generate sample blueprint strings used by the UI ("Load a sample") and by the tests.
// Run: node scripts/make-samples.mjs  → writes src/data/samples.json

import { writeFile, mkdir } from 'node:fs/promises';
import { encodeBlueprintJson } from '../src/blueprint/decode.js';

const V2 = Number((2n << 48n) | (0n << 32n) | (60n << 16n));
const V1 = Number((1n << 48n) | (1n << 32n) | (110n << 16n) | 1n);

let n = 0;
const ent = (name, x, y, extra = {}) => ({ entity_number: ++n, name, position: { x, y }, ...extra });

// --- Sample A: belt playground --------------------------------------------
function beltPlayground() {
  n = 0;
  const E = [];
  // 6x6 clockwise loop
  for (let x = 0; x < 5; x++) E.push(ent('transport-belt', x + 0.5, 0.5, { direction: 4 }));
  E.push(ent('transport-belt', 5.5, 0.5, { direction: 8 }));
  for (let y = 1; y < 5; y++) E.push(ent('transport-belt', 5.5, y + 0.5, { direction: 8 }));
  E.push(ent('transport-belt', 5.5, 5.5, { direction: 12 }));
  for (let x = 4; x > 0; x--) E.push(ent('transport-belt', x + 0.5, 5.5, { direction: 12 }));
  E.push(ent('transport-belt', 0.5, 5.5, { direction: 0 }));
  for (let y = 4; y > 0; y--) E.push(ent('transport-belt', 0.5, y + 0.5, { direction: 0 }));
  // Line with an underground pair, a side-load and a splitter
  E.push(ent('fast-transport-belt', 0.5, 8.5, { direction: 4 }));
  E.push(ent('fast-transport-belt', 1.5, 8.5, { direction: 4 }));
  E.push(ent('fast-underground-belt', 2.5, 8.5, { direction: 4, type: 'input' }));
  E.push(ent('fast-underground-belt', 5.5, 8.5, { direction: 4, type: 'output' }));
  E.push(ent('fast-transport-belt', 6.5, 8.5, { direction: 4 }));
  E.push(ent('fast-splitter', 7.5, 8, { direction: 4 }));
  E.push(ent('fast-transport-belt', 8.5, 7.5, { direction: 4 }));
  E.push(ent('fast-transport-belt', 8.5, 8.5, { direction: 4 }));
  E.push(ent('fast-transport-belt', 1.5, 9.5, { direction: 0 })); // side-load into (1,8)
  // Express belt with a left turn
  E.push(ent('express-transport-belt', 10.5, 0.5, { direction: 8 }));
  E.push(ent('express-transport-belt', 10.5, 1.5, { direction: 8 }));
  E.push(ent('express-transport-belt', 10.5, 2.5, { direction: 4 }));
  E.push(ent('express-transport-belt', 11.5, 2.5, { direction: 4 }));
  return {
    blueprint: {
      item: 'blueprint',
      label: 'Belt playground',
      description: 'Loop with four turns, underground pair, side-load, splitter.',
      icons: [{ signal: { name: 'transport-belt' }, index: 1 }],
      entities: E,
      version: V2,
    },
  };
}

// --- Sample B: smelting + assembly --------------------------------------------
function smeltingLine() {
  n = 0;
  const E = [];
  // Ore belt going south at x=4
  for (let y = 0; y < 8; y++) E.push(ent('transport-belt', 4.5, y + 0.5, { direction: 8 }));
  // Two mining drills feeding the belt from the west
  E.push(ent('electric-mining-drill', 2.5, 1.5, { direction: 4 }));
  E.push(ent('electric-mining-drill', 2.5, 4.5, { direction: 4 }));
  // Furnaces with inserters in/out
  for (let i = 0; i < 4; i++) {
    const y = i * 2;
    E.push(ent('inserter', 5.5, y + 0.5, { direction: 12 }));
    E.push(ent(i % 2 ? 'steel-furnace' : 'stone-furnace', 7, y + 1));
    E.push(ent('fast-inserter', 8.5, y + 0.5, { direction: 12 }));
  }
  // Plate belt going north at x=9
  for (let y = 0; y < 8; y++) E.push(ent('transport-belt', 9.5, y + 0.5, { direction: 0 }));
  E.push(ent('small-electric-pole', 5.5, 1.5));
  E.push(ent('small-electric-pole', 5.5, 5.5));
  E.push(ent('small-electric-pole', 8.5, 5.5));
  // Assembler fed from the plate belt, output to a chest
  E.push(ent('long-handed-inserter', 10.5, 2.5, { direction: 12 }));
  E.push(ent('assembling-machine-2', 12.5, 2.5, { recipe: 'iron-gear-wheel' }));
  E.push(ent('bulk-inserter', 14.5, 2.5, { direction: 12 }));
  E.push(ent('steel-chest', 15.5, 2.5));
  E.push(ent('wooden-chest', 9.5, -0.5));
  E.push(ent('iron-chest', 4.5, 8.5));
  // Something without an official model
  E.push(ent('lab', 12.5, 6.5));
  E.push(ent('medium-electric-pole', 10.5, 5.5));
  // Wall along the top with a corner and a T
  for (let x = -1; x <= 16; x++) E.push(ent('stone-wall', x + 0.5, -2.5));
  for (let y = -1; y <= 9; y++) E.push(ent('stone-wall', -0.5, y + 0.5));
  E.push(ent('stone-wall', 7.5, -1.5));
  return {
    blueprint: {
      item: 'blueprint',
      label: 'Smelting line',
      description: 'Drills, furnaces, inserters, assembler, chests, poles, walls, and a lab with no model.',
      icons: [{ signal: { name: 'stone-furnace' }, index: 1 }],
      entities: E,
      version: V2,
    },
  };
}

// --- Sample C: a 1.x blueprint (directions 0..7) ------------------------------
function legacyCorner() {
  n = 0;
  const E = [
    ent('transport-belt', 0.5, 0.5, { direction: 2 }),
    ent('transport-belt', 1.5, 0.5, { direction: 2 }),
    ent('transport-belt', 2.5, 0.5, { direction: 4 }),
    ent('transport-belt', 2.5, 1.5, { direction: 4 }),
    ent('inserter', 3.5, 1.5, { direction: 6 }),
    ent('stack-inserter', 3.5, 0.5, { direction: 6 }),
    ent('iron-chest', 4.5, 1.5),
    ent('logistic-chest-passive-provider', 4.5, 0.5),
  ];
  return {
    blueprint: {
      item: 'blueprint',
      label: 'Legacy 1.1 corner',
      entities: E,
      version: V1,
    },
  };
}

function book(children) {
  return {
    blueprint_book: {
      item: 'blueprint-book',
      label: 'Factorio2IRL samples',
      blueprints: children.map((c, index) => ({ index, ...c })),
      active_index: 0,
      version: V2,
    },
  };
}

const samples = [
  { id: 'belts', label: 'Belt playground', json: beltPlayground() },
  { id: 'smelting', label: 'Smelting line', json: smeltingLine() },
  { id: 'legacy', label: 'Legacy 1.1 corner', json: legacyCorner() },
];
samples.push({ id: 'book', label: 'Blueprint book (all of the above)', json: book(samples.map((s) => s.json)) });

const out = [];
for (const s of samples) {
  out.push({ id: s.id, label: s.label, string: await encodeBlueprintJson(s.json) });
}
await mkdir(new URL('../src/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../src/data/samples.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`Wrote ${out.length} samples to src/data/samples.json`);
for (const s of out) console.log(`  ${s.id}: ${s.string.length} chars`);
