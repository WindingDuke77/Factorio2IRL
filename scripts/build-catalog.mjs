// Builds scripts/catalog.json from the Printables API: every Wube STL gets a stable key.
// Usage: node scripts/build-catalog.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listUserModels } from './printables-api.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'catalog.json');

const DECOR_SETS = new Set(['1801974', '1801972', '1801966', '1801978', '1801957', '1807994']);
const CHEST_RENDER = new Set(['wooden-closed', 'iron-closed', 'steel-closed', 'logistics-closed', 'wooden-open', 'iron-open', 'steel-open', 'logistics-open', 'wooden-lid', 'iron-lid', 'steel-lid', 'logistics-lid-open', 'logistics-lid-closed']);

/** "Walls T-Junction N.stl" -> "walls-t-junction-n" */
export function slugify(name) {
  return name
    .replace(/\.stl$/i, '')
    .toLowerCase()
    .replace(/[\s()]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function licenseShort(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('creative commons')) {
    let s = 'CC';
    if (n.includes('attribution')) s += ' BY';
    if (n.includes('noncommercial') || n.includes('non-commercial')) s += '-NC';
    if (n.includes('sharealike') || n.includes('share alike')) s += '-SA';
    if (n.includes('noderivatives') || n.includes('no derivatives')) s += '-ND';
    return s;
  }
  return name;
}

function variantOf(folder, filename) {
  const src = `${folder ?? ''} ${filename}`;
  if (/high precision/i.test(src)) return 'precision';
  if (/high clearance/i.test(src)) return 'clearance';
  return null;
}

/** Returns { key, render } for a (set, folder, filename) or throws. */
export function mapKey(setId, folder, filename) {
  const base = filename.replace(/\.stl$/i, '');
  const slug = slugify(filename);
  const variant = variantOf(folder, filename);
  const renderVariant = variant !== 'clearance'; // precision or variant-less

  if (setId === '1807994') return { key: `item/${slug}`, render: true }; // Belt Items: placed on belts
  if (DECOR_SETS.has(setId)) return { key: `decor/${slug}`, render: false };

  switch (setId) {
    case '1801951': { // Transport Belts
      if (/^Belts High/i.test(folder ?? '')) return { key: `belt/${slug}`, render: renderVariant };
      if (/^Tiles High/i.test(folder ?? '')) {
        const name = base.replace(/^Belt\s+/i, '').replace(/\s+Tile$/i, '');
        return { key: `tile/${slugify(name)}`, render: renderVariant };
      }
      if (folder === 'Grids') {
        const name = base.replace(/^Factorio Grid\s+/i, '');
        return { key: `grid/${slugify(name)}`, render: true };
      }
      break;
    }
    case '1801944': { // Assembling Machine
      if (/Tile/i.test(base)) return { key: 'tile/assembling-machine', render: renderVariant };
      return { key: 'assembling-machine', render: true };
    }
    case '1801935': { // Electric Mining Drill
      if (/^Electric Miner \(/i.test(base)) return { key: 'tile/electric-mining-drill', render: renderVariant };
      if (/Add Brim/i.test(base)) return { key: 'electric-mining-drill-brim', render: false };
      if (/Main/i.test(base)) return { key: 'electric-mining-drill', render: true };
      break;
    }
    case '1801924': // Stone Furnace
    case '1801927': { // Steel Furnace
      const body = setId === '1801924' ? 'stone-furnace' : 'steel-furnace';
      if (/Tile/i.test(base)) return { key: `tile/${body}`, render: renderVariant };
      return { key: body, render: true };
    }
    case '1801872': return { key: 'small-electric-pole', render: true };
    case '1801901': return { key: `chest/${slug}`, render: CHEST_RENDER.has(slug) }; // Chests
    case '1801917': { // Inserters
      if (/^Tile$/i.test(base)) return { key: 'tile/inserter', render: renderVariant };
      if (/Inserter/i.test(base)) {
        const name = base.replace(/\s+Inserter\s+/i, ' '); // "Basic Inserter Open" -> "Basic Open"
        return { key: `inserter/${slugify(name)}`, render: renderVariant };
      }
      return { key: `inserter/${slug}`, render: renderVariant }; // Base, Base Single
    }
    case '1801893': { // Walls
      const name = base.replace(/^Walls\s+/i, '');
      if (/\s+Tile$/i.test(name)) return { key: `tile/wall-${slugify(name.replace(/\s+Tile$/i, ''))}`, render: renderVariant };
      return { key: `wall/${slugify(name)}`, render: renderVariant };
    }
  }
  throw new Error(`No key mapping for set ${setId} / ${folder} / ${filename}`);
}

async function main() {
  const sets = await listUserModels('@WubeSoftware', 50);
  const entries = [];
  for (const set of sets) {
    for (const f of set.stls) {
      const { key, render } = mapKey(String(set.id), f.folder ?? null, f.name);
      entries.push({
        key,
        set: String(set.id),
        setName: set.name,
        slug: set.slug,
        license: licenseShort(set.license?.name),
        fileId: String(f.id),
        filename: f.name,
        folder: f.folder ?? null,
        variant: variantOf(f.folder, f.name),
        fileSize: f.fileSize,
        render,
      });
    }
  }
  entries.sort((a, b) => a.key.localeCompare(b.key) || (a.variant ?? '').localeCompare(b.variant ?? ''));

  // Assertions
  const total = sets.reduce((n, s) => n + s.stls.length, 0);
  if (entries.length !== total) throw new Error(`Mapped ${entries.length} of ${total} files`);
  const seen = new Map();
  for (const e of entries.filter((e) => e.render)) {
    if (seen.has(e.key)) throw new Error(`Duplicate render:true key ${e.key}: ${seen.get(e.key)} vs ${e.folder}/${e.filename}`);
    seen.set(e.key, `${e.folder}/${e.filename}`);
  }

  await fs.writeFile(OUT, JSON.stringify(entries, null, 2) + '\n');

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('KEY', 32) + pad('VARIANT', 11) + pad('RENDER', 8) + pad('SET', 9) + pad('FOLDER', 28) + 'FILENAME');
  for (const e of entries) {
    console.log(pad(e.key, 32) + pad(e.variant ?? '-', 11) + pad(e.render ? 'yes' : '-', 8) + pad(e.set, 9) + pad(e.folder ?? '-', 28) + e.filename);
  }
  console.log(`\n${entries.length} entries (${total} files in ${sets.length} sets), ${seen.size} render:true -> ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
