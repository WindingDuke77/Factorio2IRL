// Minimal STL reader shared by the pack script: binary or ASCII -> indexed mesh (mm).

/** @returns {{ vertices: Float64Array, triangles: Uint32Array, min: number[], max: number[] }} */
export function readStl(buf) {
  const tris = isAscii(buf) ? parseAscii(buf.toString('latin1')) : parseBinary(buf);
  return index(tris);
}

function isAscii(buf) {
  if (buf.length < 84) return true;
  if (buf.toString('latin1', 0, 5) !== 'solid') return false;
  const n = buf.readUInt32LE(80);
  return buf.length !== 84 + n * 50;
}

function parseBinary(buf) {
  const n = buf.readUInt32LE(80);
  const out = new Float64Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++) out[i * 9 + k] = buf.readFloatLE(o + k * 4);
  }
  return out;
}

function parseAscii(text) {
  const nums = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m;
  while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
  return Float64Array.from(nums.slice(0, nums.length - (nums.length % 9)));
}

/** Weld vertices at 1 µm and build an index; also returns the bounding box. */
function index(tris) {
  const n = tris.length / 3;
  const ids = new Map();
  const verts = [];
  const idx = new Uint32Array(n);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const x = tris[i * 3];
    const y = tris[i * 3 + 1];
    const z = tris[i * 3 + 2];
    const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      ids.set(key, id);
      verts.push(x, y, z);
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
    }
    idx[i] = id;
  }
  return { vertices: Float64Array.from(verts), triangles: idx, min, max };
}
