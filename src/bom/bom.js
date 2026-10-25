// Bill of materials: which STL files to print, how many, grouped by Printables model set.

import catalog from '../../scripts/catalog.json' with { type: 'json' };

const byKey = new Map();
for (const entry of catalog) {
  if (!byKey.has(entry.key)) byKey.set(entry.key, []);
  byKey.get(entry.key).push(entry);
}

/** Catalog entry for a key in the requested variant ("precision" | "clearance"). */
export function catalogEntry(key, variant = 'precision') {
  const entries = byKey.get(key);
  if (!entries) return null;
  return entries.find((e) => e.variant === variant) ?? entries.find((e) => e.variant === null) ?? entries[0];
}

export function printablesUrl(entry) {
  return `https://www.printables.com/model/${entry.set}-${entry.slug}`;
}

/**
 * @param {{pieces: Array, placeholders: Array, bounds: object, grid: object}} placements
 * @param {{variant?: string, mmPerTile?: number}} opts
 */
export function buildBom(placements, opts = {}) {
  const variant = opts.variant ?? 'precision';
  const mmPerTile = opts.mmPerTile ?? null;

  const counts = new Map();
  for (const p of placements.pieces) {
    counts.set(p.key, (counts.get(p.key) ?? 0) + (p.qty ?? 1));
  }

  const sets = new Map();
  const unknownKeys = [];
  for (const [key, qty] of counts) {
    const entry = catalogEntry(key, variant);
    if (!entry) {
      unknownKeys.push({ key, qty });
      continue;
    }
    if (!sets.has(entry.set)) {
      sets.set(entry.set, {
        setId: entry.set,
        setName: entry.setName,
        slug: entry.slug,
        url: printablesUrl(entry),
        license: entry.license,
        rows: [],
        total: 0,
      });
    }
    const set = sets.get(entry.set);
    set.rows.push({
      key,
      filename: entry.filename,
      folder: entry.folder,
      variant: entry.variant,
      qty,
      group: groupOf(key),
      fileSize: entry.fileSize,
    });
    set.total += qty;
  }

  const setList = [...sets.values()].sort((a, b) => b.total - a.total);
  for (const s of setList) s.rows.sort((a, b) => groupRank(a.group) - groupRank(b.group) || b.qty - a.qty || a.filename.localeCompare(b.filename));

  // Entities with no official model.
  const missing = new Map();
  for (const ph of placements.placeholders) {
    const m = missing.get(ph.name) ?? { name: ph.name, label: ph.label, count: 0, w: ph.w, h: ph.h, unknown: ph.unknown };
    m.count++;
    missing.set(ph.name, m);
  }

  const totals = {
    pieces: [...counts.values()].reduce((a, b) => a + b, 0),
    bodies: sum(placements.pieces, (p) => p.group === 'body'),
    tiles: sum(placements.pieces, (p) => p.group === 'tile'),
    plates: sum(placements.pieces, (p) => p.group === 'grid'),
    pins: placements.grid?.pins ?? 0,
    placeholders: placements.placeholders.length,
  };

  const physical = mmPerTile
    ? { wMm: placements.bounds.w * mmPerTile, hMm: placements.bounds.h * mmPerTile }
    : null;

  return { variant, sets: setList, missing: [...missing.values()].sort((a, b) => b.count - a.count), unknownKeys, totals, bounds: placements.bounds, physical };
}

function sum(arr, pred) {
  let n = 0;
  for (const p of arr) if (pred(p)) n += p.qty ?? 1;
  return n;
}

function groupOf(key) {
  if (key.startsWith('grid/')) return 'grid';
  if (key.startsWith('tile/')) return 'tile';
  if (key.endsWith('-pin')) return 'hardware';
  return 'body';
}
function groupRank(g) {
  return { body: 0, hardware: 1, tile: 2, grid: 3 }[g] ?? 9;
}

/** Plain-text export of the parts list. */
export function bomToText(bom, label = '') {
  const lines = [];
  lines.push(`Factorio2IRL parts list${label ? ` - ${label}` : ''}`);
  lines.push(`Footprint: ${bom.bounds.w} x ${bom.bounds.h} tiles${bom.physical ? ` (~${Math.round(bom.physical.wMm)} x ${Math.round(bom.physical.hMm)} mm)` : ''}`);
  lines.push(`Variant: High ${bom.variant === 'precision' ? 'Precision' : 'Clearance'}`);
  lines.push(`Total pieces: ${bom.totals.pieces}`);
  lines.push('');
  for (const set of bom.sets) {
    lines.push(`## ${set.setName} (${set.url})`);
    for (const r of set.rows) {
      lines.push(`${String(r.qty).padStart(4)} x ${r.filename}${r.folder ? `  [${r.folder}]` : ''}`);
    }
    lines.push('');
  }
  if (bom.missing.length) {
    lines.push('## No official model yet (not included above)');
    for (const m of bom.missing) lines.push(`${String(m.count).padStart(4)} x ${m.label} (${m.w}x${m.h})`);
    lines.push('');
  }
  lines.push('Models by Wube Software, CC BY-NC: https://www.printables.com/@WubeSoftware/models');
  return lines.join('\n');
}

/** CSV export. */
export function bomToCsv(bom) {
  const rows = [['set', 'file', 'folder', 'qty', 'group', 'printables_url']];
  for (const set of bom.sets) {
    for (const r of set.rows) rows.push([set.setName, r.filename, r.folder ?? '', r.qty, r.group, set.url]);
  }
  for (const m of bom.missing) rows.push(['(no official model)', m.label, '', m.count, 'placeholder', '']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
