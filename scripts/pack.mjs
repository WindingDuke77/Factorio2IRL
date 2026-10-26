// Pack what a blueprint needs for the slicer, from the STLs already fetched into models-raw/
// (same output as the app's "Pack" button, written to a folder instead of a zip):
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
//   --plates colour|colour-strict|part|mixed   how plates are grouped (default colour: one colour per
//                          plate, colours with little to print share "mixed" plates)
//   --no-3mf  --no-stl     skip one of the outputs
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeBlueprintString } from '../src/blueprint/decode.js';
import { flattenBook, normalizeBlueprint } from '../src/blueprint/normalize.js';
import { buildPlacements, DEFAULT_OPTIONS } from '../src/blueprint/placements.js';
import { buildBom } from '../src/bom/bom.js';
import { detectItems } from '../src/blueprint/items.js';
import { buildPackEntries, stlRelPath } from '../src/export/pack.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW_DIR = path.join(ROOT, 'models-raw');

async function main() {
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
  const label = entry.label || name;
  const outDir = path.resolve(val('out', path.join('pack', name)));
  console.log(`Blueprint: ${label}${flat.length > 1 ? ` (entry ${entryIndex + 1} of ${flat.length})` : ''}`);
  console.log(`Footprint ${bom.bounds.w} x ${bom.bounds.h} tiles; output -> ${outDir}`);

  const { entries, missing, plates } = await buildPackEntries({
    bom,
    placements,
    label,
    loadStl: async (row) => {
      try {
        return new Uint8Array(await fs.readFile(path.join(RAW_DIR, stlRelPath(row))));
      } catch {
        return null;
      }
    },
    deflate: async (bytes) => zlib.deflateRawSync(bytes, { level: 6 }),
    onProgress: (msg) => process.stdout.isTTY && process.stdout.write(`\r  ${msg.padEnd(60)}`),
    bedW,
    bedH,
    gap: Number(val('gap', 3)),
    margin: Number(val('margin', 3)),
    groupBy: val('plates', flag('mixed-plates') ? 'mixed' : flag('strict-colours') ? 'colour-strict' : 'colour'),
    includeStl: !flag('no-stl'),
    include3mf: !flag('no-3mf'),
  });
  if (process.stdout.isTTY) process.stdout.write('\r' + ' '.repeat(64) + '\r');
  for (const e of entries) {
    const dst = path.join(outDir, e.name);
    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.writeFile(dst, typeof e.data === 'string' ? e.data : e.data);
  }
  const stlCount = entries.filter((e) => e.name.startsWith('stl/')).length;
  console.log(`${stlCount} STL files, ${plates.length} 3MF plates, ${entries.length} files written to ${path.relative(process.cwd(), outDir) || '.'}`);
  if (missing.length) {
    console.warn(`\n${missing.length} file(s) not in models-raw/ (run "npm run fetch-models"):`);
    for (const r of missing) console.warn(`  ${stlRelPath(r)}`);
  }
}

await main();
