// three.js scene setup: renderer, camera, lights, ground, orbit controls.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1410);
  scene.fog = new THREE.Fog(0x1a1410, 60, 160);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 500);
  camera.position.set(12, 14, 16);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 1.5;
  controls.maxDistance = 150;
  controls.zoomToCursor = true;
  controls.target.set(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xfff2dc, 0x3a3028, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(18, 30, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0x8fb8ff, 0.5);
  fill.position.set(-14, 10, -10);
  scene.add(fill);

  // Ground + grid helper (1 tile spacing).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x2a2118, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  let gridHelper = null;
  const content = new THREE.Group();
  scene.add(content);

  function setGrid(bounds) {
    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.geometry.dispose();
      gridHelper.material.dispose();
      gridHelper = null;
    }
    const size = Math.max(10, Math.ceil(Math.max(bounds.w, bounds.h) * 1.6));
    const even = size % 2 === 0 ? size : size + 1;
    gridHelper = new THREE.GridHelper(even, even, 0x5a4a30, 0x2f2820);
    gridHelper.position.y = 0;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.55;
    scene.add(gridHelper);
  }

  function setContent(group, bounds) {
    content.clear();
    if (group) content.add(group);
    if (bounds) setGrid(bounds);
  }

  function frame(bounds, view = 'iso') {
    const w = Math.max(bounds?.w ?? 6, 1);
    const h = Math.max(bounds?.h ?? 6, 1);
    const radius = Math.max(w, h) * 0.58 + 1.5;
    const vFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const hFov = Math.atan(Math.tan(vFov) * Math.max(camera.aspect, 0.2));
    const dist = Math.max(radius / Math.tan(vFov), radius / Math.tan(hFov));
    controls.target.set(0, 0.4, 0);
    if (view === 'top') {
      // Straight down with north (−Z) at the top of the screen.
      camera.position.set(0, dist, 0.0001);
    } else if (view === 'front') {
      camera.position.set(0, dist * 0.45, dist * 0.9);
    } else {
      camera.position.set(dist * 0.55, dist * 0.6, dist * 0.65);
    }
    const shadowRange = Math.max(w, h) * 0.8 + 4;
    sun.shadow.camera.left = -shadowRange;
    sun.shadow.camera.right = shadowRange;
    sun.shadow.camera.top = shadowRange;
    sun.shadow.camera.bottom = -shadowRange;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.updateProjectionMatrix();
    controls.update();
  }

  function resize() {
    const parent = canvas.parentElement;
    const width = parent?.clientWidth || canvas.clientWidth || 1;
    const height = parent?.clientHeight || canvas.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement ?? canvas);
  resize();

  let running = true;
  function loop() {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    scene,
    camera,
    controls,
    renderer,
    setContent,
    frame,
    resize,
    dispose() {
      running = false;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}
