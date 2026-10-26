// Print pack: the files a slicer needs for a blueprint. Shared by the "Pack" button (browser) and
// scripts/pack.mjs (node): callers supply how to load an STL and how to deflate bytes.
//   stl/<qty>x <set> - <file>.stl   one copy of every needed STL
//   parts.csv, parts.txt, README.txt
//   plates/plate-NN[-colour].3mf    every instance arranged on a bed, one colour per plate
//   plates/plates.txt               what is on each plate
import { bomToCsv, bomToText } from '../bom/bom.js';
import { readStl } from './stl.js';

export const PACK_DEFAULTS = {
  bedW: 256, // mm
  bedH: 256,
  gap: 3, // mm between parts
  margin: 3, // mm from the bed edge
  mixed: false, // pack all colours together
  strict: false, // never share a plate between colours (default: small colour groups share)
  includeStl: true,
  include3mf: true,
};

export const shortSet = (setName) => setName.replace(/^Factorio\s+/i, '');
/** Path of a row's STL below models-raw/ or /stl/. */
export const stlRelPath = (row) => `${row.set.setId}/${row.folder ? `${row.folder}/` : ''}${row.filename}`;
export const stlPackName = (row) => `${row.qty}x ${shortSet(row.set.setName)} - ${row.filename}`;
/** Every parts-list row with its set attached. */
export const packRows = (bom) => bom.sets.flatMap((set) => set.rows.map((r) => ({ ...r, set })));
export const hexColour = (c) => `#${(c ?? 0x808080).toString(16).padStart(6, '0')}`;

/** Colour per catalog key: the most common colour the placements give it. */
export function colourByKey(placements) {
  const tally = new Map();
  for (const p of placements.pieces) {
    const m = tally.get(p.key) ?? new Map();
    m.set(p.color, (m.get(p.color) ?? 0) + (p.qty ?? 1));
    tally.set(p.key, m);
  }
  const out = new Map();
  for (const [key, m] of tally) out.set(key, hexColour([...m.entries()].sort((a, b) => b[1] - a[1])[0][0]));
  return out;
}

/**
 * Build the pack's files.
 * @param {object} args
 * @param {object} args.bom            from buildBom()
 * @param {object} args.placements     from buildPlacements()
 * @param {string} args.label          blueprint label
 * @param {(row) => Promise<Uint8Array|null>} args.loadStl  bytes of a row's STL, or null if missing
 * @param {(bytes: Uint8Array) => Promise<Uint8Array>} args.deflate  raw deflate
 * @param {(msg: string) => void} [args.onProgress]
 * @returns {Promise<{ entries: Array<{name:string, data:Uint8Array|string, store?:boolean}>, missing: object[], plates: object[] }>}
 */
export async function buildPackEntries({ bom, placements, label, loadStl, deflate, onProgress = () => {}, ...options }) {
  const o = { ...PACK_DEFAULTS, ...options };
  const rows = packRows(bom);
  const entries = [];
  const missing = [];
  const files = new Map();
  let fetched = 0;
  const distinct = new Set(rows.map(stlRelPath)).size;
  for (const r of rows) {
    const rel = stlRelPath(r);
    if (!files.has(rel)) {
      onProgress(`Fetching ${++fetched}/${distinct}`);
      files.set(rel, (await loadStl(r)) ?? null);
    }
    const bytes = files.get(rel);
    if (!bytes) {
      missing.push(r);
      continue;
    }
    if (o.includeStl) entries.push({ name: `stl/${stlPackName(r)}`, data: bytes });
  }
  entries.push({ name: 'parts.csv', data: bomToCsv(bom) }, { name: 'parts.txt', data: bomToText(bom, label) });

  let plates = [];
  if (o.include3mf) {
    const colours = colourByKey(placements);
    const meshes = new Map();
    const instances = [];
    for (const r of rows) {
      const rel = stlRelPath(r);
      const bytes = files.get(rel);
      if (!bytes) continue;
      let mesh = meshes.get(rel);
      if (!mesh) {
        onProgress(`Reading ${r.filename}`);
        mesh = readStl(bytes);
        mesh.name = `${r.filename.replace(/\.stl$/i, '')} (${shortSet(r.set.setName)}${r.folder ? `, ${r.folder}` : ''})`;
        mesh.w = mesh.max[0] - mesh.min[0];
        mesh.d = mesh.max[1] - mesh.min[1];
        meshes.set(rel, mesh);
      }
      const colour = colours.get(r.key) ?? '#808080';
      for (let i = 0; i < r.qty; i++) instances.push({ mesh, colour, key: r.key });
    }
    plates = arrange(instances, o);
    const index = [];
    for (let i = 0; i < plates.length; i++) {
      onProgress(`Plate ${i + 1}/${plates.length}`);
      const plate = plates[i];
      const plateColours = [...new Set(plate.items.map((it) => it.colour))];
      const fileName = `plate-${String(i + 1).padStart(2, '0')}${plateColours.length === 1 ? `-${plateColours[0].slice(1)}` : '-mixed'}.3mf`;
      entries.push({ name: `plates/${fileName}`, data: await build3mf(plate, `${label} - plate ${i + 1}`, deflate), store: true });
      const counts = new Map();
      for (const it of plate.items) counts.set(it.mesh.name, (counts.get(it.mesh.name) ?? 0) + 1);
      index.push(`${fileName}  (${plateColours.join(', ')})\n${[...counts].map(([n, q]) => `    ${String(q).padStart(3)} x ${n}`).join('\n')}`);
    }
    entries.push({ name: 'plates/plates.txt', data: `${o.bedW} x ${o.bedH} mm bed, ${o.gap} mm gap\n\n${index.join('\n\n')}\n` });
  }
  entries.push({
    name: 'README.txt',
    data: `${label}\n\nstl/      one copy of every STL this blueprint needs; the number in front is how many to print.\nplates/   one 3MF per print plate with all instances arranged on a ${o.bedW} x ${o.bedH} mm bed, one colour per plate\n          (small colour groups share "mixed" plates). Open a plate in PrusaSlicer, Bambu Studio or OrcaSlicer, pick the filament, slice.\nparts.csv the parts list with Printables links.\n\nModels by Wube Software (CC BY-NC), https://www.printables.com/@WubeSoftware/models\n`,
  });
  return { entries, missing, plates };
}

/**
 * Shelf-pack instances onto bed-sized plates: rows of parts sorted by depth, a new row when the
 * width runs out, a new plate when the depth runs out. One colour per plate unless `mixed`;
 * colours with little to print share "mixed" plates unless `strict`.
 */
export function arrange(instances, opts = {}) {
  const { bedW, bedH, gap, margin, mixed, strict } = { ...PACK_DEFAULTS, ...opts };
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
      for (const [g, items] of small) {
        shared.push(...items);
        groups.delete(g);
      }
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

// ---------------------------------------------------------------- 3MF
/** A core-spec 3MF (zip) for one plate: objects per mesh+colour, build items per instance. */
export async function build3mf(plate, title, deflate) {
  const colours = [...new Set(plate.items.map((it) => it.colour))];
  const objectIds = new Map();
  const resources = [`<basematerials id="1">${colours.map((c) => `<base name="${c}" displaycolor="${c}" />`).join('')}</basematerials>`];
  const items = [];
  let nextId = 2;
  for (const it of plate.items) {
    const k = `${it.mesh.name}|${it.colour}`;
    if (!objectIds.has(k)) {
      const id = nextId++;
      objectIds.set(k, id);
      resources.push(meshXml(id, it.mesh, colours.indexOf(it.colour)));
    }
    const m = it.mesh;
    items.push(`<item objectid="${objectIds.get(k)}" transform="1 0 0 0 1 0 0 0 1 ${num(it.x - m.min[0])} ${num(it.y - m.min[1])} ${num(-m.min[2])}" />`);
  }
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${esc(title)}</metadata>
<metadata name="Application">Factorio2IRL</metadata>
<metadata name="Designer">Wube Software (CC BY-NC)</metadata>
<resources>
${resources.join('\n')}
</resources>
<build>
${items.join('\n')}
</build>
</model>
`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" /></Types>
`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" /></Relationships>
`;
  return buildZip(
    [
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: '3D/3dmodel.model', data: model },
    ],
    deflate,
  );
}

const num = (v) => (Math.round(v * 1000) / 1000).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function meshXml(id, mesh, pindex) {
  const v = mesh.vertices;
  const t = mesh.triangles;
  const out = [`<object id="${id}" name="${esc(mesh.name)}" type="model" pid="1" pindex="${pindex}"><mesh><vertices>`];
  for (let i = 0; i < v.length; i += 3) out.push(`<vertex x="${num(v[i])}" y="${num(v[i + 1])}" z="${num(v[i + 2])}" />`);
  out.push('</vertices><triangles>');
  for (let i = 0; i < t.length; i += 3) out.push(`<triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}" />`);
  out.push('</triangles></mesh></object>');
  return out.join('');
}

// ---------------------------------------------------------------- zip
const encoder = new TextEncoder();
const toBytes = (d) => (typeof d === 'string' ? encoder.encode(d) : d instanceof Uint8Array ? d : new Uint8Array(d));

/** Zip entries [{ name, data, store? }] with raw deflate (or stored when `store`). */
export async function buildZip(entries, deflate) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = encoder.encode(e.name);
    const data = toBytes(e.data);
    const packed = e.store ? data : await deflate(data);
    const method = e.store ? 0 : 8;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, method, true);
    cen.setUint16(12, 0, true);
    cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, packed.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint16(30, 0, true);
    cen.setUint16(32, 0, true);
    cen.setUint16(34, 0, true);
    cen.setUint16(36, 0, true);
    cen.setUint32(38, 0, true);
    cen.setUint32(42, offset, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, packed);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of all) {
    out.set(b, o);
    o += b.length;
  }
  return out;
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
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Raw deflate for browsers (CompressionStream). */
export async function deflateRawBrowser(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
