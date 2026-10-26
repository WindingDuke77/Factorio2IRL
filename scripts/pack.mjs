// Pack what a blueprint needs for the slicer, from the STLs already fetched into models-raw/:
//   pack/<name>/stl/        one copy of every needed STL, named "<qty>x <set> - <file>.stl"
//   pack/<name>/parts.csv   the parts list (same as the app's CSV export) + parts.txt
//   pack/<name>/plates/     one .3mf per print plate: every instance arranged on the bed,
//                           one colour per plate, objects carry their colour as a base material
//
//   node scripts/pack.mjs --sample smelting
//   node scripts/pack.mjs --file my-blueprint.txt [--entry 2]
// Options:
//   --out <dir>            output folder (default pack/<sample or file name>)
//   --variant precision|clearance   tile/inserter/wall/belt variant (default precision)
//   --bed 256x256          bed size in mm (default 256x256), --gap 3 (mm between parts), --margin 3
//   --endStyle none|short|long|medium  --inserterHand closed|open  --chests closed|open
//   --items auto|none|<item>  --pad N  --no-fill  --no-grid  --compact
//   --mixed-plates         pack all colours onto the same plates (default: one colour per plate, but
//                          colours whose parts fill under a quarter of a bed share "mixed" plates)
//   --strict-colours       never share a plate between colours
//   --no-3mf  --no-stl     skip one of the outputs
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeBlueprintString } from '../src/blueprint/decode.js';
import { flattenBook, normalizeBlueprint } from '../src/blueprint/normalize.js';
import { buildPlacements, DEFAULT_OPTIONS } from '../src/blueprint/placements.js';
import { buildBom, bomToCsv, bomToText } from '../src/bom/bom.js';
import { detectItems } from '../src/blueprint/items.js';
import { readStl } from './lib/stl.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'models-raw');

async function main() {
// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const val = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const sampleId = val('sample', null);
const file = val('file', null);
if (!sampleId && !file) {
  console.error('Usage: node scripts/pack.mjs --sample <id> | --file <blueprint.txt> [options]  (see the header of this file)');
  process.exit(2);
}
const variant = val('variant', 'precision') === 'clearance' ? 'clearance' : 'precision';
const [bedW, bedH] = String(val('bed', '256x256')).split('x').map(Number);
const gap = Number(val('gap', 3));
const margin = Number(val('margin', 3));
const options = {
  ...DEFAULT_OPTIONS,
  endStyle: val('endStyle', DEFAULT_OPTIONS.endStyle),
  inserterHand: val('inserterHand', DEFAULT_OPTIONS.inserterHand),
  chestsOpen: val('chests', 'closed') === 'open',
  beltItems: val('items', DEFAULT_OPTIONS.beltItems),
  pad: Number(val('pad', 0)) || 0,
  fillEmpty: !flag('no-fill'),
  includeGrid: !flag('no-grid'),
  compactPlates: flag('compact'),
};

// ---------------------------------------------------------------- blueprint
let text;
let name;
if (sampleId) {
  const samples = JSON.parse(await fs.readFile(path.join(ROOT, 'src', 'data', 'samples.json'), 'utf8'));
  const s = samples.find((x) => x.id === sampleId);
  if (!s) {
    console.error(`Unknown sample "${sampleId}". Samples: ${samples.map((x) => x.id).join(', ')}`);
    process.exit(2);
  }
  text = s.string;
  name = sampleId;
} else {
  text = await fs.readFile(file, 'utf8');
  name = path.basename(file).replace(/\.[^.]+$/, '');
}
const decoded = await decodeBlueprintString(text.trim());
const flat = flattenBook(decoded);
const entryIndex = Math.min(flat.length - 1, Math.max(0, Number(val('entry', 0)) || 0));
const entry = flat[entryIndex];
if (!entry) {
  console.error('The blueprint (book) is empty.');
  process.exit(1);
}
const normalized = normalizeBlueprint(entry.blueprint);
const detected = detectItems(normalized);
const placements = buildPlacements(normalized, { ...options, detectedItem: detected.best });
const bom = buildBom(placements, { variant, mmPerTile: 25 });
const outDir = path.resolve(val('out', path.join('pack', name)));
await fs.mkdir(outDir, { recursive: true });
console.log(`Blueprint: ${entry.label || name}${flat.length > 1 ? ` (entry ${entryIndex + 1} of ${flat.length})` : ''}`);
console.log(`Footprint ${bom.bounds.w} x ${bom.bounds.h} tiles; output -> ${outDir}`);

// ---------------------------------------------------------------- parts list
await fs.writeFile(path.join(outDir, 'parts.csv'), bomToCsv(bom));
await fs.writeFile(path.join(outDir, 'parts.txt'), bomToText(bom, entry.label || name));

// Colour per catalog key: the most common colour the placements give it.
const colourOf = new Map();
{
  const tally = new Map();
  for (const p of placements.pieces) {
    const m = tally.get(p.key) ?? new Map();
    m.set(p.color, (m.get(p.color) ?? 0) + (p.qty ?? 1));
    tally.set(p.key, m);
  }
  for (const [key, m] of tally) colourOf.set(key, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
}
const hex = (c) => `#${(c ?? 0x808080).toString(16).padStart(6, '0')}`;
const shortSet = (setName) => setName.replace(/^Factorio\s+/i, '');

// ---------------------------------------------------------------- STL pack
const rows = bom.sets.flatMap((set) => set.rows.map((r) => ({ ...r, set })));
const rawPath = (r) => path.join(RAW_DIR, r.set.setId, r.folder ?? '', r.filename);
const missing = [];
if (!flag('no-stl')) {
  const stlDir = path.join(outDir, 'stl');
  await fs.mkdir(stlDir, { recursive: true });
  for (const r of rows) {
    const src = rawPath(r);
    const dst = path.join(stlDir, `${r.qty}x ${shortSet(r.set.setName)} - ${r.filename}`);
    try {
      await fs.copyFile(src, dst);
    } catch {
      missing.push(r);
    }
  }
  console.log(`STL pack: ${rows.length - missing.length} files copied to ${path.relative(process.cwd(), stlDir)}`);
}

// ---------------------------------------------------------------- 3MF plates
if (!flag('no-3mf')) {
  const meshes = new Map();
  const instances = [];
  for (const r of rows) {
    const src = rawPath(r);
    let mesh = meshes.get(src);
    if (!mesh) {
      try {
        mesh = readStl(await fs.readFile(src));
      } catch {
        if (!missing.includes(r)) missing.push(r);
        continue;
      }
      mesh.name = `${r.filename.replace(/\.stl$/i, '')} (${shortSet(r.set.setName)}${r.folder ? `, ${r.folder}` : ''})`;
      mesh.w = mesh.max[0] - mesh.min[0];
      mesh.d = mesh.max[1] - mesh.min[1];
      meshes.set(src, mesh);
    }
    const colour = hex(colourOf.get(r.key));
    for (let i = 0; i < r.qty; i++) instances.push({ mesh, colour, key: r.key });
  }
  const plates = arrange(instances, { bedW, bedH, gap, margin, mixed: flag('mixed-plates'), strict: flag('strict-colours') });
  const platesDir = path.join(outDir, 'plates');
  await fs.mkdir(platesDir, { recursive: true });
  const index = [];
  for (let i = 0; i < plates.length; i++) {
    const plate = plates[i];
    const colours = [...new Set(plate.items.map((it) => it.colour))];
    const fileName = `plate-${String(i + 1).padStart(2, '0')}${colours.length === 1 ? `-${colours[0].slice(1)}` : ''}.3mf`;
    await fs.writeFile(path.join(platesDir, fileName), write3mf(plate, `${entry.label || name} - plate ${i + 1}`));
    const counts = new Map();
    for (const it of plate.items) counts.set(it.mesh.name, (counts.get(it.mesh.name) ?? 0) + 1);
    index.push(`${fileName}  (${colours.join(', ')})\n` + [...counts].map(([n, q]) => `    ${String(q).padStart(3)} x ${n}`).join('\n'));
  }
  await fs.writeFile(path.join(platesDir, 'plates.txt'), `${bedW} x ${bedH} mm bed, ${gap} mm gap\n\n${index.join('\n\n')}\n`);
  console.log(`3MF plates: ${plates.length} written to ${path.relative(process.cwd(), platesDir)} (${instances.length} instances)`);
}

await fs.writeFile(
  path.join(outDir, 'README.txt'),
  `${entry.label || name}\n\nstl/      one copy of every STL this blueprint needs; the number in front is how many to print.\nplates/   one 3MF per print plate with all instances arranged on a ${bedW} x ${bedH} mm bed, one colour per plate.\n          Open a plate in PrusaSlicer, Bambu Studio or OrcaSlicer, pick the filament, slice.\nparts.csv the parts list with Printables links.\n\nModels by Wube Software (CC BY-NC), https://www.printables.com/@WubeSoftware/models\n`,
);
if (missing.length) {
  console.warn(`\n${missing.length} file(s) not in models-raw/ (run "npm run fetch-models" for the ${variant} variant):`);
  for (const r of missing) console.warn(`  ${r.set.setId}/${r.folder ? r.folder + '/' : ''}${r.filename}`);
}

}

// ---------------------------------------------------------------- arrangement
/**
 * Shelf-pack instances onto bed-sized plates: rows of parts sorted by depth, a new row when
 * the width runs out, a new plate when the depth runs out. With `mixed` off every plate holds a
 * single colour (so it can be printed with one filament); colours with little to print share
 * "mixed" plates unless `strict` is set.
 */
function arrange(instances, { bedW, bedH, gap, margin, mixed, strict }) {
  const groups = new Map();
  for (const it of instances) {
    const g = mixed ? 'all' : it.colour;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(it);
  }
  if (!mixed && !strict) {
    const bedArea = (bedW - 2 * margin) * (bedH - 2 * margin);
    const small = [...groups].filter(([, items]) => items.reduce((a, it) => a + (it.mesh.w + gap) * (it.mesh.d + gap), 0) < bedArea / 4);
    if (small.length > 1) {
      const shared = [];
      for (const [g, items] of small) { shared.push(...items); groups.delete(g); }
      groups.set('mixed', shared);
    }
  }
  const plates = [];
  for (const items of groups.values()) {
    items.sort((a, b) => b.mesh.d - a.mesh.d || b.mesh.w - a.mesh.w);
    let plate = null;
    let x = margin;
    let y = margin;
    let rowDepth = 0;
    const newPlate = () => {
      plate = { items: [] };
      plates.push(plate);
      x = margin;
      y = margin;
      rowDepth = 0;
    };
    newPlate();
    for (const it of items) {
      const w = it.mesh.w;
      const d = it.mesh.d;
      if (w > bedW - 2 * margin || d > bedH - 2 * margin) console.warn(`  ${it.mesh.name} (${w.toFixed(0)} x ${d.toFixed(0)} mm) is larger than the bed; placed anyway`);
      if (x + w > bedW - margin && x > margin) {
        x = margin;
        y += rowDepth + gap;
        rowDepth = 0;
      }
      if (y + d > bedH - margin && plate.items.length) newPlate();
      plate.items.push({ ...it, x, y });
      x += w + gap;
      rowDepth = Math.max(rowDepth, d);
    }
  }
  return plates;
}

// ---------------------------------------------------------------- 3MF writer
function write3mf(plate, title) {
  const colours = [...new Set(plate.items.map((it) => it.colour))];
  const meshIds = new Map();
  const parts = [];
  let nextId = 2;
  const res = [];
  res.push(`<basematerials id="1">${colours.map((c) => `<base name="${c}" displaycolor="${c}" />`).join('')}</basematerials>`);
  for (const it of plate.items) {
    const k = `${it.mesh.name}|${it.colour}`;
    if (!meshIds.has(k)) {
      const id = nextId++;
      meshIds.set(k, id);
      res.push(meshXml(id, it.mesh, colours.indexOf(it.colour)));
    }
    const m = it.mesh;
    parts.push(`<item objectid="${meshIds.get(k)}" transform="1 0 0 0 1 0 0 0 1 ${f(it.x - m.min[0])} ${f(it.y - m.min[1])} ${f(-m.min[2])}" />`);
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">Factorio2IRL pack</metadata>
<metadata name="Designer">Wube Software (CC BY-NC)</metadata>
<resources>
${res.join('\n')}
</resources>
<build>
${parts.join('\n')}
</build>
</model>
`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" /></Types>
`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" /></Relationships>
`;
  return zip([
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rels],
    ['3D/3dmodel.model', model],
  ]);
}
function f(v) {
  return (Math.round(v * 1000) / 1000).toString();
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
function meshXml(id, mesh, pindex) {
  const v = mesh.vertices;
  const t = mesh.triangles;
  const out = [`<object id="${id}" name="${esc(mesh.name)}" type="model" pid="1" pindex="${pindex}"><mesh><vertices>`];
  for (let i = 0; i < v.length; i += 3) out.push(`<vertex x="${f(v[i])}" y="${f(v[i + 1])}" z="${f(v[i + 2])}" />`);
  out.push('</vertices><triangles>');
  for (let i = 0; i < t.length; i += 3) out.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}" />`);
  out.push('</triangles></mesh></object>');
  return out.join('');
}

// ---------------------------------------------------------------- tiny zip writer (deflate)
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [fileName, content] of entries) {
    const nameBuf = Buffer.from(fileName, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, end]);
}
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

await main();
