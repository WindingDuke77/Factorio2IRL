// Build a three.js Group from placements: one InstancedMesh per (piece, colour),
// plus placeholder boxes for entities without an official model.

import * as THREE from 'three';
import { getGeometry, loadManifest } from './models.js';
import { PIECE_ROTATION, PIECE_TILT, ARM_LEAN, STACK_ON, BODY_INSET, TILE_INSET } from './orientation.js';

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

  const lean = ARM_LEAN[key];
  const fixed = PIECE_TILT[key];
  if (lean !== undefined) {
    // Stand the flat arm up (+90° about X puts the south end down) then lean it north.
    tilt = new THREE.Matrix4().makeRotationX((90 - lean) * DEG);
    // The mount pin (south end, +Z) must end up at the tile centre.
    const halfLen = (box.max.z - box.min.z) / 2;
    offset.z = -halfLen * Math.sin(lean * DEG);
  } else if (fixed) {
    tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((fixed.x ?? 0) * DEG, (fixed.y ?? 0) * DEG, (fixed.z ?? 0) * DEG, 'XYZ'));
  }

  // Lift so the tilted piece rests on y=0, and re-centre it in X/Z unless an anchor was set.
  const tilted = box.clone().applyMatrix4(tilt);
  offset.y = -tilted.min.y;
  if (lean === undefined) {
    offset.x = -(tilted.min.x + tilted.max.x) / 2;
    offset.z += -(tilted.min.z + tilted.max.z) / 2;
  }
  return { tilt, offset };
}

/**
 * @param {object} placements from buildPlacements()
 * @param {{ showBodies?: boolean, showTiles?: boolean, showGrid?: boolean }} view
 * @returns {Promise<{ group: THREE.Group, missingKeys: string[] }>}
 */
export async function buildBlueprintGroup(placements, view = {}) {
  const show = { showBodies: true, showTiles: true, showGrid: true, ...view };
  const manifest = await loadManifest();
  const group = new THREE.Group();
  const { bounds } = placements;
  const cx = bounds.minX + bounds.w / 2;
  const cy = bounds.minY + bounds.h / 2;

  const heightOf = (key) => manifest.pieces?.[key]?.size?.[1] ?? 0;
  const plateH = Math.max(0, heightOf('grid/1x1') - TILE_INSET);
  const tileH = Math.max(0, heightOf('tile/empty') - BODY_INSET);

  // Group instances by (key, color).
  const buckets = new Map();
  for (const p of placements.pieces) {
    if (p.group === 'hardware') continue;
    if (p.group === 'body' && !show.showBodies) continue;
    if (p.group === 'tile' && !show.showTiles) continue;
    if (p.group === 'grid' && !show.showGrid) continue;
    const k = `${p.key}|${p.color}`;
    if (!buckets.has(k)) buckets.set(k, { key: p.key, color: p.color, group: p.group, items: [] });
    buckets.get(k).items.push(p);
  }

  const missing = new Set();
  const mWorld = new THREE.Matrix4();
  const mYaw = new THREE.Matrix4();
  const mOffset = new THREE.Matrix4();

  await Promise.all(
    [...buckets.values()].map(async (b) => {
      const geo = await getGeometry(b.key);
      if (!geo) {
        missing.add(b.key);
        return;
      }
      const mesh = new THREE.InstancedMesh(geo, materialFor(b.color, b.group === 'grid' ? { roughness: 0.95, metalness: 0 } : {}), b.items.length);
      mesh.castShadow = b.group !== 'grid';
      mesh.receiveShadow = true;

      let baseY = 0;
      if (b.group === 'tile') baseY = show.showGrid ? plateH : 0;
      else if (b.group === 'body') {
        baseY = (show.showGrid ? plateH : 0) + (show.showTiles ? tileH : 0);
        const under = STACK_ON[b.key];
        if (under) baseY += Math.max(0, heightOf(under.on) - (under.inset ?? 0));
      }
      const rotOffset = PIECE_ROTATION[b.key] ?? 0;
      const { tilt, offset } = localTransform(b.key, geo);
      mOffset.makeTranslation(offset.x, offset.y, offset.z);
      const local = new THREE.Matrix4().multiplyMatrices(mOffset, tilt);

      b.items.forEach((p, i) => {
        const yaw = -((p.rotation + rotOffset) / 16) * Math.PI * 2;
        mWorld.makeTranslation(p.x - cx, baseY, p.y - cy);
        mYaw.makeRotationY(yaw);
        const m = new THREE.Matrix4().multiplyMatrices(mWorld, mYaw).multiply(local);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData = { key: b.key, group: b.group };
      group.add(mesh);
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
