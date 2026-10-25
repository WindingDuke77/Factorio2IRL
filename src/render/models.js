// Loads the converted Wube model pieces (GLB with meshopt compression) and caches geometries.
// Some pieces are post-processed here to go from their *printing* pose to their *installed* pose
// (inserter arms are printed flat and folded at two hinges; the pole profiles are stood up).

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BASE = `${import.meta.env.BASE_URL}models/`;
const DEG = Math.PI / 180;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

let manifestPromise = null;
const geometryCache = new Map();

export function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${BASE}manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`manifest.json ${r.status}`);
        return r.json();
      })
      .catch((err) => {
        console.warn('No model manifest; rendering placeholders only.', err);
        return { mmPerTile: null, pieces: {} };
      });
  }
  return manifestPromise;
}

/** Piece info from the manifest, or null. */
export async function pieceInfo(key) {
  const m = await loadManifest();
  return m.pieces?.[key] ?? null;
}

/**
 * Geometry for a piece key, or null if it is not available. The returned geometry is
 * non-indexed (flat shading) with its bounding box computed.
 * @returns {Promise<THREE.BufferGeometry|null>}
 */
export function getGeometry(key) {
  if (!geometryCache.has(key)) {
    geometryCache.set(
      key,
      (async () => {
        if (PROCEDURAL[key]) return PROCEDURAL[key]();
        const info = await pieceInfo(key);
        if (!info) return null;
        try {
          const gltf = await loader.loadAsync(`${BASE}${info.file}`);
          const geos = [];
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((obj) => {
            if (obj.isMesh) {
              const g = toFloatPositions(obj.geometry);
              g.applyMatrix4(obj.matrixWorld);
              geos.push(g);
            }
          });
          if (!geos.length) return null;
          const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
          let flat = merged.index ? merged.toNonIndexed() : merged;
          if (POST_PROCESS[key]) flat = POST_PROCESS[key](flat);
          flat.computeVertexNormals();
          flat.computeBoundingBox();
          return flat;
        } catch (err) {
          console.warn(`Failed to load model ${key}`, err);
          return null;
        }
      })(),
    );
  }
  return geometryCache.get(key);
}

/**
 * The GLBs are quantized (KHR_mesh_quantization: Int16 positions, dequantized by the node
 * transform). Writing transformed floats back into an Int16 attribute clamps everything to ±1,
 * so copy the positions into a Float32 attribute first (getX/Y/Z handle the normalisation).
 */
function toFloatPositions(geometry) {
  const src = geometry.attributes.position;
  const out = new Float32Array(src.count * 3);
  for (let i = 0; i < src.count; i++) {
    out[i * 3] = src.getX(i);
    out[i * 3 + 1] = src.getY(i);
    out[i * 3 + 2] = src.getZ(i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  if (geometry.index) g.setIndex(geometry.index.clone());
  return g;
}

export async function preload(keys) {
  await Promise.all([...new Set(keys)].map((k) => getGeometry(k)));
}

// ---------------------------------------------------------------------------
// Post-processing: printing pose -> installed pose.

/**
 * Inserter arms are printed as a flat side profile: mount pin at one end (+Z after conversion),
 * a hex hinge 0.26 tiles from it, a long upper arm, a second hinge just past the middle, then the
 * forearm and hand. Wube's instructions fold the print at the two hinges. We do the same:
 * stand it up with the pin at the origin, lean the upper arm forward by `upper` degrees and the
 * forearm by `fore` degrees (both from vertical), towards −Z.
 */
function foldArm(geo, { upper, fore }) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const L = b.max.z - b.min.z;
  const zc = (b.max.z + b.min.z) / 2;
  const yJ1 = -(L / 2 - 0.26); // first hinge, after standing up (mount tip at y = -L/2)
  const yJ2 = 0.08; // second hinge
  const phiC = -(fore - upper) * DEG;
  const phiB = -upper * DEG;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Stand up: rotate +90° about X so +Z (mount) goes to -Y and the hand points up.
    const y0 = -(v.z - zc);
    const z0 = v.y - (b.max.y + b.min.y) / 2;
    let y = y0;
    let z = z0;
    if (y > yJ2) {
      const dy = y - yJ2;
      y = yJ2 + dy * Math.cos(phiC) - z * Math.sin(phiC);
      z = dy * Math.sin(phiC) + z * Math.cos(phiC);
    }
    if (y > yJ1) {
      const dy = y - yJ1;
      y = yJ1 + dy * Math.cos(phiB) - z * Math.sin(phiB);
      z = dy * Math.sin(phiB) + z * Math.cos(phiB);
    }
    pos.setXYZ(i, v.x - (b.max.x + b.min.x) / 2, y + L / 2, z);
  }
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  return geo;
}

/**
 * Flat print profiles that stand up: rotate the long Z axis to Y so that the wider end (the pole's
 * crossarm) is at the top, then re-centre on the ground.
 */
function standUpWideEndUp(geo) {
  const pos = geo.attributes.position;
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const L = b.max.z - b.min.z;
  let wMin = 0;
  let wMax = 0;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.z < b.min.z + L * 0.15) wMin = Math.max(wMin, Math.abs(v.x));
    if (v.z > b.max.z - L * 0.15) wMax = Math.max(wMax, Math.abs(v.x));
  }
  const wideAtMax = wMax >= wMin;
  // +Z end goes up when wide end is at +Z: rotate -90° about X (z -> y). Otherwise +90°.
  const s = wideAtMax ? -1 : 1;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const y = -s * v.z;
    const z = s * v.y;
    pos.setXYZ(i, v.x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeBoundingBox();
  const nb = geo.boundingBox;
  geo.translate(-(nb.max.x + nb.min.x) / 2, -nb.min.y, -(nb.max.z + nb.min.z) / 2);
  geo.computeBoundingBox();
  return geo;
}

const POST_PROCESS = {
  'inserter/basic-closed': (g) => foldArm(g, { upper: 30, fore: 110 }),
  'inserter/basic-open': (g) => foldArm(g, { upper: 30, fore: 110 }),
  'inserter/bulk-closed': (g) => foldArm(g, { upper: 30, fore: 110 }),
  'inserter/bulk-open': (g) => foldArm(g, { upper: 30, fore: 110 }),
  'inserter/stack-closed': (g) => foldArm(g, { upper: 30, fore: 110 }),
  'inserter/stack-open': (g) => foldArm(g, { upper: 30, fore: 110 }),
  'inserter/long-closed': (g) => foldArm(g, { upper: 45, fore: 110 }),
  'inserter/long-open': (g) => foldArm(g, { upper: 45, fore: 110 }),
  'pole/profile': standUpWideEndUp,
};

/** Keys whose geometry is already anchored (origin = mount point, y=0 = base); never re-centred. */
export const ANCHORED = new Set(Object.keys(POST_PROCESS));

/**
 * Procedural stand-ins, used only when a converted piece is missing.
 */
const PROCEDURAL = {};
