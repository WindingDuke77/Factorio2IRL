import { PARTS, COMPOSITES, LEVELS } from './render/orientation.js';
import { loadSaved, saveState, clearSaved } from './persist.js';
import './style.css';
import * as THREE from 'three';
import samples from './data/samples.json' with { type: 'json' };
import { decodeBlueprintString } from './blueprint/decode.js';
import { flattenBook, normalizeBlueprint } from './blueprint/normalize.js';
import { buildPlacements, DEFAULT_OPTIONS } from './blueprint/placements.js';
import { buildBom, bomToText, bomToCsv } from './bom/bom.js';
import { createScene } from './render/scene.js';
import { buildBlueprintGroup, disposeGroup } from './render/build.js';
import { loadManifest } from './render/models.js';
import { renderBomPanel, renderHeaderStats } from './ui/bomPanel.js';
import { runGallery } from './render/gallery.js';
import { detectItems, BELT_ITEMS } from './blueprint/items.js';

const $ = (id) => document.getElementById(id);

const state = {
  decoded: null,
  flat: [],
  selected: 0,
  normalized: null,
  placements: null,
  bom: null,
  group: null,
  options: { ...DEFAULT_OPTIONS },
  variant: 'precision',
  view: { showBodies: true, showTiles: true, showGrid: true, showMissing: false }, // plate -> tile -> model, as in Wube's guide
  mmPerTile: 25,
  missingKeys: [],
  buildToken: 0,
  restoreSelected: null, // book entry to reselect after a reload
  restoreCamera: null, // camera to restore after a reload
};
let persistEnabled = false;

const scene = createScene($('view'));
// Debug handle (used by the dev tooling and browser console).
window.__f2i = { state, scene, THREE, rebuild: () => rebuildScene(false), PARTS, COMPOSITES, LEVELS };

// ---------------------------------------------------------------------------
// Piece gallery (?gallery) — every converted model laid out for inspection.
if (new URLSearchParams(location.search).has('gallery')) {
  document.title = 'Factorio2IRL — piece gallery';
  $('view-title').textContent = 'Piece gallery';
  $('view-empty').classList.add('hidden');
  runGallery(scene, new URLSearchParams(location.search).get('gallery') || '');
} else {
  init();
}

async function init() {
  const manifest = await loadManifest();
  if (manifest.mmPerTile) {
    state.mmPerTile = manifest.mmPerTile;
    $('mm-per-tile').textContent = String(manifest.mmPerTile);
  }

  // Samples dropdown
  const sel = $('sample-select');
  for (const s of samples) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label;
    sel.appendChild(opt);
  }
  $('btn-sample').addEventListener('click', () => loadSample(sel.value));
  const menu = $('sample-menu');
  for (const s of samples) {
    const a = document.createElement('a');
    a.className = 'button';
    a.href = `?sample=${s.id}`;
    a.textContent = s.label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      sel.value = s.id;
      loadSample(s.id);
      history.replaceState(null, '', `?sample=${s.id}`);
    });
    menu.appendChild(a);
  }

  $('btn-render').addEventListener('click', () => renderFromText($('bp-input').value));
  $('bp-input').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') renderFromText($('bp-input').value);
  });
  $('btn-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      $('bp-input').value = text;
      renderFromText(text);
    } catch (err) {
      showError('Could not read the clipboard. Paste into the box instead (Ctrl+V), then press Render.');
    }
  });
  $('btn-clear').addEventListener('click', () => {
    $('bp-input').value = '';
    hideError();
    clearSaved();
  });

  // Options
  for (const radio of document.querySelectorAll('input[name="variant"]')) {
    radio.addEventListener('change', () => {
      state.variant = radio.value;
      rebuild({ sceneToo: false });
      persist();
    });
  }
  bindOption('opt-endStyle', 'endStyle', (v) => v);
  bindOption('opt-inserterHand', 'inserterHand', (v) => v);
  bindOption('opt-beltItems', 'beltItems', (v) => v);
  bindOption('opt-chests', 'chestsOpen', (v) => v === 'open');
  bindOption('opt-pad', 'pad', (v) => Math.max(0, Math.min(10, Number(v) || 0)));
  bindOption('opt-fillEmpty', 'fillEmpty', (v, el) => el.checked);
  bindOption('opt-includeGrid', 'includeGrid', (v, el) => el.checked);
  bindOption('opt-compactPlates', 'compactPlates', (v, el) => el.checked);

  bindView('view-bodies', 'showBodies');
  bindView('view-tiles', 'showTiles');
  bindView('view-grid', 'showGrid');
  bindView('view-missing', 'showMissing');

  for (const view of ['iso', 'top', 'front']) {
    $(`btn-view-${view}`).addEventListener('click', (e) => {
      e.preventDefault();
      scene.frame(state.placements?.bounds, view);
      for (const v of ['iso', 'top', 'front']) $(`btn-view-${v}`).classList.toggle('active', v === view);
    });
  }

  $('btn-copy-text').addEventListener('click', async () => {
    if (!state.bom) return;
    const text = bomToText(state.bom, currentLabel());
    try {
      await navigator.clipboard.writeText(text);
      flash($('btn-copy-text'), 'Copied!');
    } catch {
      window.prompt('Copy the parts list:', text);
    }
  });
  $('btn-download-csv').addEventListener('click', () => {
    if (!state.bom) return;
    const blob = new Blob([bomToCsv(state.bom)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug(currentLabel() || 'blueprint')}-parts.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // Deep links: ?sample=<id>, ?dev
  const params = new URLSearchParams(location.search);
  if (params.has('dev')) {
    const { installDevCycler } = await import('./dev/cycler.js');
    const { installTuner } = await import('./dev/tune.js');
    installDevCycler({ onLoad: (json) => renderFromText(JSON.stringify(json)) });
    installTuner({ state, rebuild: () => rebuildScene(false) });
  } else if (params.get('sample')) {
    sel.value = params.get('sample');
    loadSample(params.get('sample'));
  } else {
    const saved = loadSaved();
    if (saved?.text) restoreSaved(saved);
  }
  persistEnabled = !params.has('dev') && !params.has('gallery');
  scene.controls.addEventListener('change', persist);
}

/** Put the saved options back into the controls and render the saved blueprint. */
function restoreSaved(saved) {
  state.options = { ...DEFAULT_OPTIONS, ...(saved.options ?? {}) };
  state.variant = saved.variant === 'clearance' ? 'clearance' : 'precision';
  state.view = { ...state.view, ...(saved.view ?? {}) };
  state.restoreSelected = Number.isInteger(saved.selected) ? saved.selected : null;
  state.restoreCamera = saved.camera ?? null;
  syncControls();
  $('bp-input').value = saved.text;
  renderFromText(saved.text);
}

function syncControls() {
  const o = state.options;
  $('opt-endStyle').value = o.endStyle;
  $('opt-inserterHand').value = o.inserterHand;
  $('opt-beltItems').value = o.beltItems;
  $('opt-chests').value = o.chestsOpen ? 'open' : 'closed';
  $('opt-pad').value = String(o.pad ?? 0);
  $('opt-fillEmpty').checked = Boolean(o.fillEmpty);
  $('opt-includeGrid').checked = Boolean(o.includeGrid);
  $('opt-compactPlates').checked = Boolean(o.compactPlates);
  for (const r of document.querySelectorAll('input[name="variant"]')) r.checked = r.value === state.variant;
  $('view-bodies').checked = state.view.showBodies;
  $('view-tiles').checked = state.view.showTiles;
  $('view-grid').checked = state.view.showGrid;
  $('view-missing').checked = state.view.showMissing;
}

let persistTimer = null;
/** Save the blueprint, options, selection and camera (debounced; not in dev/gallery mode). */
function persist() {
  if (!persistEnabled) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const text = $('bp-input').value;
    if (!text.trim()) return;
    saveState({
      text,
      selected: state.selected,
      options: state.options,
      variant: state.variant,
      view: state.view,
      camera: {
        pos: scene.camera.position.toArray(),
        target: scene.controls.target.toArray(),
        bounds: state.placements ? { minX: state.placements.bounds.minX, minY: state.placements.bounds.minY, w: state.placements.bounds.w, h: state.placements.bounds.h } : null,
      },
    });
  }, 400);
}

function bindOption(id, key, parse) {
  const el = $(id);
  el.addEventListener('change', () => {
    state.options[key] = parse(el.value, el);
    rebuild();
    persist();
  });
}
function bindView(id, key) {
  const el = $(id);
  el.addEventListener('change', () => {
    state.view[key] = el.checked;
    rebuildScene();
    persist();
  });
}

function loadSample(id) {
  const s = samples.find((x) => x.id === id) ?? samples[0];
  $('bp-input').value = s.string;
  renderFromText(s.string);
}

async function renderFromText(text) {
  hideError();
  let decoded;
  try {
    decoded = await decodeBlueprintString(text);
  } catch (err) {
    showError(err.message);
    return;
  }
  state.decoded = decoded;
  state.flat = flattenBook(decoded);
  if (!state.flat.length) {
    showError('This blueprint book is empty.');
    return;
  }
  renderBookList();
  let start = state.flat.findIndex((f) => f.active);
  if (state.restoreSelected != null) {
    if (state.restoreSelected < state.flat.length) start = state.restoreSelected;
    state.restoreSelected = null;
  }
  selectBlueprint(start >= 0 ? start : 0);
}

function renderBookList() {
  const panel = $('book-panel');
  const list = $('book-list');
  list.innerHTML = '';
  if (state.flat.length <= 1) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  state.flat.forEach((entry, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'f-book-item';
    btn.dataset.index = String(i);
    const count = entry.blueprint.entities?.length ?? 0;
    btn.innerHTML = `<span class="font-bold">${escapeHtml(entry.label)}</span> <span class="text-f-muted">· ${count} entities</span>`;
    btn.addEventListener('click', () => selectBlueprint(i));
    list.appendChild(btn);
  });
  highlightBook();
}
function highlightBook() {
  for (const b of $('book-list').querySelectorAll('button')) {
    const active = Number(b.dataset.index) === state.selected;
    b.classList.toggle('active', active);
  }
}

function selectBlueprint(i) {
  state.selected = i;
  highlightBook();
  const entry = state.flat[i];
  state.normalized = normalizeBlueprint(entry.blueprint);
  $('view-title').textContent = entry.label || '3D view';
  rebuild({ frame: true });
  persist();
}

function currentLabel() {
  return state.flat[state.selected]?.label ?? '';
}

function rebuild({ sceneToo = true, frame = false } = {}) {
  if (!state.normalized) return;
  state.detected = detectItems(state.normalized);
  state.placements = buildPlacements(state.normalized, { ...state.options, detectedItem: state.detected.best });
  state.bom = buildBom(state.placements, { variant: state.variant, mmPerTile: state.mmPerTile });
  renderBomPanel({ bom: state.bom, label: currentLabel(), missingKeys: state.missingKeys });
  renderHeaderStats({ bom: state.bom, entities: state.normalized.entities.length });
  if (sceneToo) rebuildScene(frame);
}

async function rebuildScene(frame = false) {
  if (!state.placements) return;
  const token = ++state.buildToken;
  $('view-loading').classList.remove('hidden');
  const { group, missingKeys } = await buildBlueprintGroup(state.placements, state.view);
  if (token !== state.buildToken) {
    disposeGroup(group);
    return;
  }
  if (state.group) disposeGroup(state.group);
  state.group = group;
  state.missingKeys = missingKeys;
  scene.setContent(group, state.placements.bounds);
  if (frame) {
    const restore = state.restoreCamera;
    state.restoreCamera = null;
    const b = state.placements.bounds;
    const sameFootprint = restore?.bounds && ['minX', 'minY', 'w', 'h'].every((k) => restore.bounds[k] === b[k]);
    scene.frame(b, new URLSearchParams(location.search).get('view') || 'iso', sameFootprint ? restore : null);
  }
  $('view-loading').classList.add('hidden');
  $('view-empty').classList.add('hidden');
  renderNotes();
  if (missingKeys.length) renderBomPanel({ bom: state.bom, label: currentLabel(), missingKeys });
}

function renderNotes() {
  const notes = $('view-notes');
  notes.innerHTML = '';
  const b = state.placements.bounds;
  const chips = [
    `${b.w} × ${b.h} tiles`,
    `≈ ${Math.round(b.w * state.mmPerTile)} × ${Math.round(b.h * state.mmPerTile)} mm`,
    `${state.placements.placeholders.length} placeholder${state.placements.placeholders.length === 1 ? '' : 's'}`,
  ];
  if (state.options.beltItems === 'auto') {
    const d = state.detected;
    chips.push(d?.best ? `items: ${BELT_ITEMS[d.best].label} (from ${d.found[0].source} "${d.found[0].name}")` : 'items: none found in blueprint');
  } else if (state.options.beltItems !== 'none') {
    chips.push(`items: ${state.options.beltItems === 'mixed' ? 'mixed' : BELT_ITEMS[state.options.beltItems]?.label}`);
  }
  if (state.missingKeys.length) chips.push(`${state.missingKeys.length} piece type(s) have no converted model yet`);
  for (const c of chips) {
    const span = document.createElement('span');
    span.className = 'rounded bg-black/40 px-2 py-0.5';
    span.textContent = c;
    notes.appendChild(span);
  }
}

function showError(msg) {
  const el = $('bp-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideError() {
  $('bp-error').classList.add('hidden');
}
function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = old), 1200);
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'blueprint';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
