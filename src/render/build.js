// Build a three.js Group from placements: one InstancedMesh per (piece, colour),
// composite pieces assembled from several parts, and placeholder boxes for entities without an
// official model.

import * as THREE from 'three';
import { getGeometry, loadManifest, ANCHORED } from './models.js';
import { PIECE_ROTATION, PIECE_TILT, STACK_ON, COMPOSITES, BODY_INSET, TILE_INSET } from './orientation.js';

const DEG = Math.PI / 180;

const materialCache = new Map();
function materialFor(color, opts = {}) {
  const k = `${color}|${opts.roughness ?? 0.7}|${opts.metalness ?? 0.15}`;
  if (!materialCache.has(k)) {
    materialCache.set(
      k,
      new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.7,
        metalness: opts.metalness ?? 0.15,
        flatShading: true,
      }),
    );
  }
  return materialCache.get(k);
}

const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.85 });
const placeholderEdge = new THREE.LineBasicMaterial({ color: 0xffa200 });

/**
 * The piece's own transform (before yaw and world placement): a tilt for pieces modelled in a
 * printing pose, and an offset that puts the piece's anchor at the tile centre with its lowest
 * point at y=0.
 * @returns {{ tilt: THREE.Matrix4, offset: THREE.Vector3 }}
 */
export function localTransform(key, geo) {
  const box = geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox);
  let tilt = new THREE.Matrix4();
  const offset = new THREE.Vector3();
  const fixed = PIECE_TILT[key];
  if (fixed) {
    tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((fixed.x ?? 0) * DEG, (fixed.y ?? 0) * DEG, (fixed.z ?? 0) * DEG, 'XYZ'));
  }
  if (ANCHORED.has(key)) return { tilt, offset };
  const tilted = box.clone().applyMatrix4(tilt);
  offset.set(-(tilted.min.x + tilted.max.x) / 2, -tilted.min.y, -(tilted.min.z + tilted.max.z) / 2);
  return { tilt, offset };
}

/** Local matrix for a composite part: either pos/rot, or aligned along a from→to line. */
function partMatrix(part, geo) {
  const m = new THREE.Matrix4();
  if (part.from) {
    const from = new THREE.Vector3(...part.from);
    const to = new THREE.Vector3(...part.to);
    const dir = to.clone().sub(from).normalize();
    const centre = from.clone().lerp(to, part.t ?? 0.5);
    // Align the part's longest axis with the line.
    const b = geo.boundingBox;
    const sz = new THREE.Vector3().subVectors(b.max, b.min);
    const axis = sz.x >= sz.y && sz.x >= sz.z ? new THREE.Vector3(1, 0, 0) : sz.z >= sz.y ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(axis, dir);
    // The part is centred on its bbox in XZ with min y = 0: shift it to its own centre first.
    const shift = new THREE.Matrix4().makeTranslation(0, -(b.max.y + b.min.y) / 2, 0);
    return m.compose(centre, q, new THREE.Vector3(1, 1, 1)).multiply(shift);
  }
  const pos = new THREE.Vector3(...(part.pos ?? [0, 0, 0]));
  const rot = part.rot ?? [0, 0, 0];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
  return m.compose(pos, q, new THREE.Vector3(1, 1, 1));
}

/**
 * @param {object} placements from buildPlacements()
 * @param {{ showBodies?: boolean, showTiles?: boolean, showGrid?: boolean }} view
 * @returns {Promise<{ group: THREE.Group, missingKeys: string[] }>}
 */
export async function buildBlueprintGroup(placements, view = {}) {
  const show = { showBodies: true, showTiles: false, showGrid: true, ...view };
  const manifest = await loadManifest();
  const group = new THREE.Group();
  const { bounds } = placements;
  const cx = bounds.minX + bounds.w / 2;
  const cy = bounds.minY + bounds.h / 2;

  const heightOf = (key) => manifest.pieces?.[key]?.size?.[1] ?? 0;
  const plateH = Math.max(0, heightOf('grid/1x1') - TILE_INSET);
  const tileH = Math.max(0, heightOf('tile/empty') - BODY_INSET);
  const stackBase = (key, depth = 0) => {
    const s = STACK_ON[key];
    if (!s || depth > 4) return 0;
    return stackBase(s.on, depth + 1) + Math.max(0, heightOf(s.on) - (s.inset ?? 0));
  };

  // Group instances by (key, color).
  const buckets = new Map();
  for (const p of placements.pieces) {
    if (p.group === 'hardware') continue;
    if ((p.group === 'body' || p.group === 'item') && !show.showBodies) continue;
    if (p.group === 'tile' && !show.showTiles) continue;
    if (p.group === 'grid' && !show.showGrid) continue;
    const k = `${p.key}|${p.color}`;
    if (!buckets.has(k)) buckets.set(k, { key: p.key, color: p.color, group: p.group, items: [] });
    buckets.get(k).items.push(p);
  }

  const missing = new Set();
  const mWorld = new THREE.Matrix4();
  const mYaw = new THREE.Matrix4();

  const baseYFor = (b) => {
    if (b.group === 'tile') return show.showGrid ? plateH : 0;
    if (b.group === 'body' || b.group === 'item') return (show.showGrid ? plateH : 0) + (show.showTiles ? tileH : 0) + stackBase(b.key);
    return 0;
  };

  const addInstances = (b, geo, local, baseY, rotOffset) => {
    const mesh = new THREE.InstancedMesh(geo, materialFor(b.color, b.group === 'grid' ? { roughness: 0.95, metalness: 0 } : {}), b.items.length);
    mesh.castShadow = b.group !== 'grid';
    mesh.receiveShadow = true;
    b.items.forEach((p, i) => {
      const yaw = -((p.rotation + rotOffset) / 16) * Math.PI * 2;
      mWorld.makeTranslation(p.x - cx, baseY, p.y - cy);
      mYaw.makeRotationY(yaw);
      mesh.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(mWorld, mYaw).multiply(local));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.userData = { key: b.key, group: b.group };
    group.add(mesh);
  };

  await Promise.all(
    [...buckets.values()].map(async (b) => {
      const baseY = baseYFor(b);
      const rotOffset = PIECE_ROTATION[b.key] ?? 0;
      const composite = COMPOSITES[b.key];
      if (composite) {
        let any = false;
        for (const part of composite) {
          const geo = await getGeometry(part.key);
          if (!geo) continue;
          any = true;
          addInstances(b, geo, partMatrix(part, geo), baseY, rotOffset);
        }
        if (!any) missing.add(b.key);
        return;
      }
      const geo = await getGeometry(b.key);
      if (!geo) {
        missing.add(b.key);
        return;
      }
      const { tilt, offset } = localTransform(b.key, geo);
      const local = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z).multiply(tilt);
      addInstances(b, geo, local, baseY, rotOffset);
    }),
  );

  // Placeholders: boxes with orange edges and a floating label.
  const phBase = show.showGrid ? plateH : 0;
  for (const ph of placements.placeholders) {
    const h = 0.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(ph.w - 0.08, h, ph.h - 0.08), placeholderMat);
    box.position.set(ph.x - cx, phBase + h / 2, ph.y - cy);
    box.castShadow = true;
    box.receiveShadow = true;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), placeholderEdge);
    box.add(edges);
    const label = makeLabel(ph.label);
    label.position.set(0, h / 2 + 0.35, 0);
    label.scale.set(Math.max(ph.w, 1.6), Math.max(ph.w, 1.6) * 0.25, 1);
    box.add(label);
    group.add(box);
  }

  return { group, missingKeys: [...missing] };
}

const labelCache = new Map();
export function makeLabel(text) {
  if (!labelCache.has(text)) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(32,24,16,0.85)';
    roundRect(ctx, 4, 4, 504, 120, 18);
    ctx.fill();
    ctx.strokeStyle = '#e39827';
    ctx.lineWidth = 6;
    roundRect(ctx, 4, 4, 504, 120, 18);
    ctx.stroke();
    ctx.fillStyle = '#ffe6c0';
    ctx.font = 'bold 56px "Titillium Web", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.length > 18 ? text.slice(0, 17) + '…' : text, 256, 66);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    labelCache.set(text, tex);
  }
  const mat = new THREE.SpriteMaterial({ map: labelCache.get(text), depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 10;
  return sprite;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function disposeGroup(group) {
  group?.traverse((obj) => {
    if (obj.isMesh && !obj.isInstancedMesh && obj.geometry) obj.geometry.dispose();
    if (obj.isLineSegments) obj.geometry.dispose();
    if (obj.isSprite) obj.material.dispose();
  });
}
