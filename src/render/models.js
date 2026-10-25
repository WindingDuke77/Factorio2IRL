// Loads the converted Wube model pieces (GLB with meshopt compression) and caches geometries.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BASE = `${import.meta.env.BASE_URL}models/`;

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
 * Geometry for a piece key, or null if it is not available.
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
              const g = obj.geometry.clone();
              g.applyMatrix4(obj.matrixWorld);
              for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
              geos.push(g);
            }
          });
          if (!geos.length) return null;
          const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
          // Flat shading needs per-face normals; drop the index so each triangle owns its vertices.
          const flat = merged.index ? merged.toNonIndexed() : merged;
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
 * Pieces whose STL is a print plate of loose parts (no single assembled shape), drawn as a
 * simple stand-in in the 3D view. The parts list still names the real STL.
 */
const PROCEDURAL = {
  'small-electric-pole': () => {
    const parts = [];
    const pole = new THREE.CylinderGeometry(0.07, 0.09, 2.3, 10);
    pole.translate(0, 1.15, 0);
    parts.push(pole);
    const bar = new THREE.BoxGeometry(0.9, 0.07, 0.07);
    bar.translate(0, 2.05, 0);
    parts.push(bar);
    for (const dx of [-0.32, 0.32]) {
      const ins = new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8);
      ins.translate(dx, 2.15, 0);
      parts.push(ins);
    }
    const foot = new THREE.CylinderGeometry(0.16, 0.18, 0.12, 10);
    foot.translate(0, 0.06, 0);
    parts.push(foot);
    const merged = mergeGeometries(parts, false);
    const flat = merged.toNonIndexed();
    flat.computeVertexNormals();
    flat.computeBoundingBox();
    return flat;
  },
};

export async function preload(keys) {
  await Promise.all([...new Set(keys)].map((k) => getGeometry(k)));
}
