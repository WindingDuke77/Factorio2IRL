// Debug view (?gallery): every converted piece laid out on a grid with its key, at rotation 0,
// plus an arrow showing which way "north" (entity direction 0) points. Used to tune orientation.js.

import * as THREE from 'three';
import { getGeometry, loadManifest } from './models.js';
import { makeLabel, localTransform } from './build.js';
import { PIECE_ROTATION } from './orientation.js';

export async function runGallery(scene, filter = '') {
  const manifest = await loadManifest();
  const prefixes = filter.split(',').map((s) => s.trim()).filter(Boolean);
  const keys = Object.keys(manifest.pieces ?? {})
    .filter((k) => !prefixes.length || prefixes.some((p) => k.startsWith(p)))
    .sort();
  const group = new THREE.Group();
  const cols = keys.length <= 12 ? Math.max(1, Math.ceil(Math.sqrt(keys.length))) : Math.min(10, Math.ceil(Math.sqrt(keys.length * 1.5)));
  const spacing = prefixes.length ? 3 : 4.5;
  const mat = new THREE.MeshStandardMaterial({ color: 0xe39827, roughness: 0.7, metalness: 0.1, flatShading: true });

  // North arrow (direction 0 = −Z).
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-spacing, 0.1, spacing), 3, 0x7dcaed, 0.8, 0.5);
  group.add(arrow);
  const axes = new THREE.AxesHelper(2);
  axes.position.set(-spacing, 0.05, spacing);
  group.add(axes);

  await Promise.all(
    keys.map(async (key, i) => {
      const geo = await getGeometry(key);
      if (!geo) return;
      const x = (i % cols) * spacing;
      const z = Math.floor(i / cols) * spacing;
      const mesh = new THREE.Mesh(geo, mat);
      const rot = PIECE_ROTATION[key] ?? 0;
      const { tilt, offset } = localTransform(key, geo);
      const local = new THREE.Matrix4().makeTranslation(offset.x, offset.y, offset.z).multiply(tilt);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(-(rot / 16) * Math.PI * 2)).multiply(local);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      // Footprint outline of 1 tile for reference.
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
        new THREE.LineBasicMaterial({ color: 0x5eb663 }),
      );
      outline.rotation.x = -Math.PI / 2;
      outline.position.set(x, 0.01, z);
      group.add(outline);
      if (keys.length > 2) {
        const label = makeLabel(key);
        label.position.set(x, 2.2, z);
        label.scale.set(3.6, 0.9, 1);
        group.add(label);
      }
    }),
  );

  const w = cols * spacing;
  const h = Math.ceil(keys.length / cols) * spacing;
  group.position.set(-w / 2 + spacing / 2, 0, -h / 2 + spacing / 2);
  scene.setContent(group, { w, h });
  if (keys.length <= 2) {
    // Close-up: camera looks at the first piece from the south-east, north pointing away.
    const first = group.children.find((o) => o.isMesh && !o.isSprite);
    const box = first ? new THREE.Box3().setFromObject(first) : new THREE.Box3(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const d = Math.max(size.x, size.y, size.z, 0.5) * 2.2;
    const view = new URLSearchParams(location.search).get('view') || 'iso';
    scene.controls.target.copy(centre);
    if (view === 'top') {
      // Straight down, north (−Z) at the top of the screen.
      scene.camera.position.set(centre.x, centre.y + Math.max(size.x, size.z, 0.5) * 1.3, centre.z + 0.0001);
    } else if (view === 'front') {
      // From the south, looking north, slightly above.
      scene.camera.position.set(centre.x, centre.y + d * 0.35, centre.z + d * 1.1);
    } else if (view === 'bottom') {
      // From below (the ground plane is hidden for this).
      scene.scene.children.filter((o) => o.isMesh && o.geometry?.type === 'PlaneGeometry').forEach((o) => (o.visible = false));
      scene.controls.maxPolarAngle = Math.PI;
      scene.camera.position.set(centre.x + 0.0001, centre.y - d * 1.1, centre.z + 0.0001);
    } else {
      scene.camera.position.set(centre.x + d * 0.75, centre.y + d * 0.7, centre.z + d * 0.9);
    }
    scene.controls.update();
  } else {
    scene.frame({ w, h }, 'iso');
  }
  return group;
}
