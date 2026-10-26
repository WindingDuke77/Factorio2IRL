// Converts every downloaded render:true STL into a compressed, normalised .glb under public/models/
// and writes public/models/manifest.json.
//
//   node scripts/convert-models.mjs [--force] [--mm-per-tile=25]
//
// Conventions the renderer depends on:
//   - one mesh / one primitive per file, POSITION only (flat shading in the renderer)
//   - STL Z-up -> glTF Y-up:  (x, y, z) -> (x, z, -y)
//   - scaled so 1 Factorio tile = 1 unit (mmPerTile measured from the 1-tile pieces)
//   - re-centred: XZ bounding-box centre at (0,0), min Y = 0
//   - output file name = key with '/' replaced by '__'
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, Logger, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { rawPath } from './fetch-models.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'models');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

const TRI_CAP_DEFAULT = 40000;
const TRI_CAP_OVERRIDES = { 'assembling-machine': 25000, 'electric-mining-drill': 25000 };

// 1-tile pieces whose XY extent tells us how many mm one tile is.
const CALIBRATION_KEYS = ['tile/empty', 'tile/straight', 'tile/inserter', 'tile/wall-straight', 'belt/straight-bottom', 'grid/1x1'];
// Grid pieces are exact multiples of the tile pitch (an NxN grid is N tiles wide), which pins mmPerTile down
// better than the tiles themselves (those are undersized to leave room for the grid walls).
const GRID_PITCH_KEYS = { 'grid/1x1': 1, 'grid/2x2': 2, 'grid/5x5': 5, 'grid/10x10': 10 };
// Groups whose raw bounding boxes we compare to learn whether multi-part pieces share a frame.
const FRAME_GROUPS = [
  ['assembling-machine', 'tile/assembling-machine'],
  ['electric-mining-drill', 'tile/electric-mining-drill'],
  ['stone-furnace', 'tile/stone-furnace'],
  ['steel-furnace', 'tile/steel-furnace'],
  ['belt/straight-top', 'belt/straight-bottom', 'tile/straight'],
  ['inserter/basic-closed', 'inserter/base-single', 'inserter/base', 'tile/inserter'],
  ['wall/straight-ns', 'tile/wall-straight'],
  ['chest/wooden-closed', 'chest/iron-closed', 'chest/steel-closed', 'chest/logistics-closed'],
];

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const MM_OVERRIDE = (() => { const a = args.find((x) => x.startsWith('--mm-per-tile=')); return a ? Number(a.split('=')[1]) : null; })();

// ---------------------------------------------------------------- STL parsing

/** Returns a Float32Array of raw XYZ positions (3 per vertex, 3 vertices per triangle). */
export function parseStl(buf) {
  const ascii = isAsciiStl(buf);
  return ascii ? parseAsciiStl(buf) : parseBinaryStl(buf);
}

function isAsciiStl(buf) {
  if (buf.length < 84) return true;
  const head = buf.toString('latin1', 0, 5).toLowerCase();
  if (head !== 'solid') return false;
  const count = buf.readUInt32LE(80);
  return 84 + count * 50 !== buf.length; // "solid" prefix AND size mismatch => ASCII
}

function parseBinaryStl(buf) {
  const count = buf.readUInt32LE(80);
  if (84 + count * 50 > buf.length) throw new Error(`binary STL truncated: ${count} triangles declared`);
  const pos = new Float32Array(count * 9);
  let off = 84;
  for (let t = 0; t < count; t++) {
    off += 12; // skip normal
    for (let i = 0; i < 9; i++) { pos[t * 9 + i] = buf.readFloatLE(off); off += 4; }
    off += 2; // attribute byte count
  }
  return pos;
}

function parseAsciiStl(buf) {
  const text = buf.toString('utf8');
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const out = [];
  let m;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  if (out.length % 9 !== 0) throw new Error('ASCII STL: vertex count not a multiple of 3');
  return new Float32Array(out);
}

// ---------------------------------------------------------------- geometry helpers

function bbox(pos) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = pos[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

const r = (v, d = 3) => Number(v.toFixed(d));
const rv = (a, d = 3) => a.map((v) => r(v, d));
const size = (b) => b.max.map((v, i) => v - b.min[i]);
const centre = (b) => b.max.map((v, i) => (v + b.min[i]) / 2);
function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** Z-up mm -> Y-up tile units, XZ-centred, resting on Y=0. Mutates in place and returns the final bbox. */
function normalise(pos, rawBox, mmPerTile) {
  const s = 1 / mmPerTile;
  const c = centre(rawBox);
  // After (x,y,z)->(x,z,-y): X' = x, Y' = z, Z' = -y. Centre X' on raw cx, Z' on -cy, floor Y' at raw zmin.
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    pos[i] = (x - c[0]) * s;
    pos[i + 1] = (z - rawBox.min[2]) * s;
    pos[i + 2] = (-y + c[1]) * s;
  }
  return bbox(pos);
}

// ---------------------------------------------------------------- print-plate splitting
//
// Some STLs are print plates holding several loose parts (the drill's frame, legs, bit...; the steel
// furnace body plus its pipes; the pole's base and two flat profiles). We split them into connected
// components (ranked by triangle count, largest first) and write the useful ones as their own pieces
// so the renderer can assemble them. Ranks were checked against the raw files; see README.
// A part spec is a component rank, or { ranks | select, mirror } / { pieces: [...] }:
//   ranks    component ranks (largest first) to merge
//   select   (box) => bool over component bounding boxes {min,max,centre}
//   mirror   also add the part mirrored across its own bed plane (half-pipes printed flat -> full pipe)
//   pieces   several {ranks|select, translate:[x,y,z], rotateY:{deg, about:[x,z]}} merged into one part
// The stack inserter plate carries a second hand assembly beside the arm; Wube's photos show it
// stacked on the arm's own hand (one plate thickness higher), giving the double claw.
const STACK_DOUBLE = {
  pieces: [
    { select: (b) => b.centre[0] > -49 },
    { select: (b) => b.centre[0] <= -49, translate: [22.4, 5.65, 2.4] },
  ],
};
const SPLIT_PARTS = {
  'electric-mining-drill': {
    'drill/head': 0, 'drill/frame': 1, 'drill/housing': 2, 'drill/bit': 4, 'drill/rod': 5,
    'drill/hose-a': { ranks: [6], mirror: true }, 'drill/hose-b': { ranks: [8], mirror: true },
    'drill/chain': 10, 'drill/peg': 12, 'drill/bracket': 13, 'drill/plate': 14,
  },
  'steel-furnace': {
    'steel-furnace/body': 0,
    'steel-furnace/pipe-long': { ranks: [1], mirror: true },
    'steel-furnace/pipe-medium': { ranks: [3], mirror: true },
    'steel-furnace/pipe-small': { ranks: [5], mirror: true },
    'steel-furnace/collar': { ranks: [7], mirror: true },
  },
  'small-electric-pole': { 'pole/base': 0, 'pole/profile': 1, 'pole/profile-b': 2 },
  'inserter/stack-closed': { 'inserter/stack-closed': STACK_DOUBLE },
  'inserter/stack-open': { 'inserter/stack-open': STACK_DOUBLE },
};
const SPLIT_KEYS = new Set(Object.values(SPLIT_PARTS).flatMap((m) => Object.keys(m)));

function compBox(c) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < c.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], c[i + k]); max[k] = Math.max(max[k], c[i + k]); }
  return { min, max, centre: min.map((m, k) => (m + max[k]) / 2) };
}
function concatParts(arrs) {
  const out = new Float32Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
/** Build one part from the components of a print plate according to a spec (see SPLIT_PARTS). */
function assemblePart(spec, comps) {
  if (typeof spec === 'number') return comps[spec];
  const pieces = spec.pieces ?? [{ ranks: spec.ranks, select: spec.select }];
  const parts = [];
  for (const pc of pieces) {
    const sel = pc.ranks ? pc.ranks.map((r) => comps[r]) : comps.filter((c) => pc.select(compBox(c)));
    for (const src of sel) {
      if (!src) throw new Error('component missing');
      const c = Float32Array.from(src);
      if (pc.translate) for (let i = 0; i < c.length; i += 3) { c[i] += pc.translate[0]; c[i + 1] += pc.translate[1]; c[i + 2] += pc.translate[2]; }
      if (pc.rotateY) {
        const th = (pc.rotateY.deg * Math.PI) / 180, [x0, z0] = pc.rotateY.about, cs = Math.cos(th), sn = Math.sin(th);
        for (let i = 0; i < c.length; i += 3) {
          const dx = c[i] - x0, dz = c[i + 2] - z0;
          c[i] = x0 + dx * cs + dz * sn;
          c[i + 2] = z0 - dx * sn + dz * cs;
        }
      }
      parts.push(c);
    }
  }
  let merged = concatParts(parts);
  if (spec.mirror) {
    const zmin = compBox(merged).min[2];
    const m = new Float32Array(merged.length);
    for (let t = 0; t < merged.length; t += 9) {
      // Mirror across the bed plane and swap two vertices so the winding stays outward.
      for (const [from, to] of [[0, 0], [3, 6], [6, 3]]) {
        m[t + to] = merged[t + from]; m[t + to + 1] = merged[t + from + 1]; m[t + to + 2] = 2 * zmin - merged[t + from + 2];
      }
    }
    merged = concatParts([merged, m]);
  }
  return merged;
}

/** Connected components of a triangle soup (vertices welded at 0.01 mm). Sorted largest first. */
function splitComponents(pos) {
  const n = pos.length / 9;
  const key = new Map();
  const vid = new Int32Array(n * 3);
  let nv = 0;
  for (let i = 0; i < n * 3; i++) {
    const k = `${Math.round(pos[i * 3] * 100)},${Math.round(pos[i * 3 + 1] * 100)},${Math.round(pos[i * 3 + 2] * 100)}`;
    let id = key.get(k);
    if (id === undefined) { id = nv++; key.set(k, id); }
    vid[i] = id;
  }
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < n; t++) {
    const a = find(vid[t * 3]), b = find(vid[t * 3 + 1]), c = find(vid[t * 3 + 2]);
    parent[a] = b; parent[find(b)] = find(c);
  }
  const groups = new Map();
  for (let t = 0; t < n; t++) {
    const r0 = find(vid[t * 3]);
    let g = groups.get(r0);
    if (!g) { g = []; groups.set(r0, g); }
    g.push(t);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length).map((tris) => {
    const out = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => out.set(pos.subarray(t * 9, t * 9 + 9), i * 9));
    return out;
  });
}

// ---------------------------------------------------------------- glTF building

async function makeIO() {
  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
}

function buildDocument(key, pos) {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  const buffer = doc.createBuffer();
  const position = doc.createAccessor('POSITION').setType('VEC3').setArray(pos).setBuffer(buffer);
  const prim = doc.createPrimitive().setAttribute('POSITION', position);
  const mesh = doc.createMesh(key).addPrimitive(prim);
  const node = doc.createNode(key).setMesh(mesh);
  doc.createScene(key).addChild(node);
  doc.getRoot().getDefaultScene() ?? doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);
  return doc;
}

function triangleCount(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      n += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(n);
}

/** Runs the compression pipeline and writes the .glb. Returns { triangles, compressed }. */
async function writeGlb(io, key, pos, outFile) {
  const triCap = TRI_CAP_OVERRIDES[key] ?? TRI_CAP_DEFAULT;
  const triRaw = pos.length / 9;
  let doc = buildDocument(key, pos);

  await doc.transform(weld());
  if (triRaw > triCap) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: triCap / triRaw, error: 0.001 }));
  }
  await doc.transform(quantize());
  const triangles = triangleCount(doc);

  let compressed = true;
  let glb;
  try {
    await doc.transform(meshopt({ encoder: MeshoptEncoder }));
    glb = await io.writeBinary(doc);
  } catch (err) {
    console.warn(`  ! meshopt compression failed for ${key} (${err.message}); writing uncompressed`);
    compressed = false;
    // Rebuild without the meshopt extension (the failed transform may have left the doc half-modified).
    doc = buildDocument(key, pos);
    await doc.transform(weld());
    if (triRaw > triCap) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: triCap / triRaw, error: 0.001 }));
    await doc.transform(quantize());
    glb = await io.writeBinary(doc);
  }
  await fs.writeFile(outFile, glb);
  return { triangles, compressed, bytes: glb.byteLength };
}

// ---------------------------------------------------------------- main

async function mtime(p) { try { return (await fs.stat(p)).mtimeMs; } catch { return null; } }

async function main() {
  const catalog = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts', 'catalog.json'), 'utf8'));
  const pieces = catalog.filter((e) => e.render);
  await fs.mkdir(OUT_DIR, { recursive: true });

  let previous = null;
  try { previous = JSON.parse(await fs.readFile(MANIFEST, 'utf8')); } catch { /* first run */ }

  // --- Phase 1: raw bounding boxes of calibration + frame-check pieces (cheap; parse only).
  const needRaw = new Set([...CALIBRATION_KEYS, ...Object.keys(GRID_PITCH_KEYS), ...FRAME_GROUPS.flat()]);
  const rawBoxes = new Map();
  for (const e of pieces) {
    if (!needRaw.has(e.key)) continue;
    const src = rawPath(e);
    try { rawBoxes.set(e.key, bbox(parseStl(await fs.readFile(src)))); } catch (err) { console.warn(`  (no raw STL for ${e.key}: ${err.message})`); }
  }

  console.log('\n== Calibration: raw XY extents (mm, STL frame) ==');
  const tileExtents = [];
  for (const key of CALIBRATION_KEYS) {
    const b = rawBoxes.get(key);
    if (!b) { console.log(`  ${key.padEnd(24)} (missing)`); continue; }
    const s = size(b);
    const ext = Math.max(s[0], s[1]);
    if (key.startsWith('tile/')) tileExtents.push(ext);
    console.log(`  ${key.padEnd(24)} x=${r(s[0])}  y=${r(s[1])}  z=${r(s[2])}  max(x,y)=${r(ext)}`);
  }
  const pitches = Object.entries(GRID_PITCH_KEYS).filter(([k]) => rawBoxes.has(k)).map(([k, n]) => {
    const sz = size(rawBoxes.get(k));
    const pitch = Math.max(sz[0], sz[1]) / n;
    console.log(`  ${k.padEnd(24)} x=${r(sz[0])}  y=${r(sz[1])}  -> pitch ${r(pitch)} mm/tile`);
    return pitch;
  });
  const tileMedian = median(tileExtents);
  let mmPerTile;
  if (MM_OVERRIDE) {
    mmPerTile = MM_OVERRIDE;
    console.log(`  mmPerTile = ${mmPerTile} (from --mm-per-tile)`);
  } else if (pitches.length && Math.max(...pitches) - Math.min(...pitches) < 0.05) {
    mmPerTile = r(pitches[0], 3);
    console.log(`  mmPerTile = ${mmPerTile} (grid pitch, consistent across ${pitches.length} grid pieces)`);
    if (tileMedian) console.log(`  1-tile tiles measure ${r(tileMedian)} mm -> ${r(mmPerTile - tileMedian)} mm total clearance per tile for the grid walls`);
  } else {
    if (tileMedian == null) throw new Error('No calibration pieces found; run fetch-models first or pass --mm-per-tile=');
    const rounded = Math.round(tileMedian);
    const allNearRound = tileExtents.every((v) => Math.abs(v - rounded) / rounded < 0.02);
    mmPerTile = allNearRound ? rounded : r(tileMedian, 3);
    console.log(`  median tile extent = ${r(tileMedian)} mm -> mmPerTile = ${mmPerTile}${allNearRound ? ' (all tiles within 2% of this round number)' : ' (tiles disagree; using exact median)'}`);
  }

  console.log('\n== Frame check: raw bbox per piece (mm; same centre => shared modelling frame) ==');
  for (const group of FRAME_GROUPS) {
    const rows = group.filter((k) => rawBoxes.has(k));
    if (rows.length < 2) continue;
    const centres = rows.map((k) => centre(rawBoxes.get(k)));
    const spreadXY = Math.max(...[0, 1].map((i) => Math.max(...centres.map((c) => c[i])) - Math.min(...centres.map((c) => c[i]))));
    console.log(`  ${rows.join(' vs ')}  ->  XY centre spread ${r(spreadXY)} mm ${spreadXY < 0.5 ? '(SHARED frame)' : '(DIFFERENT origins)'}`);
    for (const k of rows) {
      const b = rawBoxes.get(k);
      console.log(`     ${k.padEnd(28)} min=[${rv(b.min, 2)}] max=[${rv(b.max, 2)}] centre=[${rv(centre(b), 2)}] size=[${rv(size(b), 2)}]`);
    }
  }

  // --- Phase 2: convert.
  const io = await makeIO();
  const reusable = previous && previous.mmPerTile === mmPerTile && !FORCE ? previous.pieces : {};
  const manifest = { mmPerTile, generated: new Date().toISOString(), pieces: {} };
  const stats = { written: 0, skipped: 0, failed: 0, uncompressed: [], bytes: 0 };
  const failures = [];

  console.log('\n== Converting ==');
  for (const e of pieces) {
    if (SPLIT_KEYS.has(e.key)) continue; // produced from the print plate below
    const file = e.key.replaceAll('/', '__') + '.glb';
    const src = rawPath(e);
    const out = path.join(OUT_DIR, file);
    const [srcT, outT] = await Promise.all([mtime(src), mtime(out)]);
    if (srcT == null) { stats.failed++; failures.push(`${e.key}: STL not downloaded (${src})`); continue; }

    if (!FORCE && outT != null && outT > srcT && reusable[e.key]) {
      manifest.pieces[e.key] = reusable[e.key];
      stats.skipped++;
      stats.bytes += (await fs.stat(out)).size;
      continue;
    }

    try {
      const pos = parseStl(await fs.readFile(src));
      const trianglesRaw = pos.length / 9;
      const bboxRaw = bbox(pos);
      const box = normalise(pos, bboxRaw, mmPerTile);
      const res = await writeGlb(io, e.key, pos, out);
      if (!res.compressed) stats.uncompressed.push(e.key);
      manifest.pieces[e.key] = {
        file,
        triangles: res.triangles,
        trianglesRaw,
        bboxRaw: { min: rv(bboxRaw.min), max: rv(bboxRaw.max) },
        bbox: { min: rv(box.min, 4), max: rv(box.max, 4) },
        size: rv(size(box), 4),
      };
      stats.written++;
      stats.bytes += res.bytes;
      console.log(`  ${e.key.padEnd(28)} ${String(trianglesRaw).padStart(7)} -> ${String(res.triangles).padStart(6)} tris  ${(res.bytes / 1024).toFixed(0).padStart(5)} KB${res.compressed ? '' : '  (uncompressed)'}`);
    } catch (err) {
      stats.failed++;
      failures.push(`${e.key}: ${err.message}`);
      console.error(`  FAILED ${e.key}: ${err.message}`);
    }
  }

  // --- Phase 3: split print plates into parts.
  console.log('\n== Splitting print plates ==');
  for (const [srcKey, parts] of Object.entries(SPLIT_PARTS)) {
    const e = pieces.find((p) => p.key === srcKey);
    if (!e) continue;
    const src = rawPath(e);
    const srcT = await mtime(src);
    const partKeys = Object.keys(parts);
    const fresh = await Promise.all(partKeys.map(async (k) => {
      const t = await mtime(path.join(OUT_DIR, k.replaceAll('/', '__') + '.glb'));
      return t != null && t > srcT && reusable[k];
    }));
    if (!FORCE && fresh.every(Boolean)) {
      for (const k of partKeys) { manifest.pieces[k] = reusable[k]; stats.skipped++; }
      continue;
    }
    try {
      const pos = parseStl(await fs.readFile(src));
      const comps = splitComponents(pos);
      console.log(`  ${srcKey}: ${comps.length} components`);
      for (const [partKey, spec] of Object.entries(parts)) {
        const rank = typeof spec === 'number' ? spec : (spec.ranks?.join('+') ?? 'sel');
        let part;
        try { part = assemblePart(spec, comps); } catch (err) { failures.push(`${partKey}: ${err.message}`); stats.failed++; continue; }
        const file = partKey.replaceAll('/', '__') + '.glb';
        const trianglesRaw = part.length / 9;
        const bboxRaw = bbox(part);
        const box = normalise(part, bboxRaw, mmPerTile);
        const res = await writeGlb(io, partKey, part, path.join(OUT_DIR, file));
        manifest.pieces[partKey] = {
          file, triangles: res.triangles, trianglesRaw, part: { of: srcKey, rank },
          bboxRaw: { min: rv(bboxRaw.min), max: rv(bboxRaw.max) },
          bbox: { min: rv(box.min, 4), max: rv(box.max, 4) }, size: rv(size(box), 4),
        };
        stats.written++; stats.bytes += res.bytes;
        console.log(`    ${partKey.padEnd(26)} rank ${rank}  ${String(trianglesRaw).padStart(7)} -> ${String(res.triangles).padStart(6)} tris  size ${rv(size(box), 2).join('x')}`);
      }
    } catch (err) { stats.failed++; failures.push(`${srcKey} split: ${err.message}`); }
  }

  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nDone: ${stats.written} written, ${stats.skipped} up to date, ${stats.failed} failed; ${(stats.bytes / 1e6).toFixed(2)} MB of .glb -> ${OUT_DIR}`);
  if (stats.uncompressed.length) console.log(`Written WITHOUT meshopt compression: ${stats.uncompressed.join(', ')}`);
  if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
}

main().catch((err) => { console.error(err); process.exit(1); });
