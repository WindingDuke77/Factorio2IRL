// Dev model check (?dev): cycles through every entity type (and belt / wall configurations)
// as a tiny synthetic blueprint rendered through the normal pipeline, on its grid plate.
// Arrow keys step, R rotates. Deep-link with ?dev&i=<index>&d=<0|4|8|12>.

import { ENTITY_DEFS } from '../blueprint/entities.js';

const V2 = Number((2n << 48n) | (60n << 16n));

let n = 0;
const ent = (name, x, y, extra = {}) => ({ entity_number: ++n, name, position: { x, y }, ...extra });
const bp = (label, entities) => ({ blueprint: { item: 'blueprint', label, entities, version: V2 } });

/** Rotate a point (x,y) about the origin by a cardinal direction (clockwise, y down). */
function rot(x, y, d) {
  switch (d) {
    case 4: return [-y, x];
    case 8: return [-x, -y];
    case 12: return [y, -x];
    default: return [x, y];
  }
}

/** Build a scenario from an unrotated layout: [[name, x, y, dir?, extra?], ...]. `d` rotates the whole layout. */
function layout(label, rows) {
  return (d) => {
    n = 0;
    const entities = rows.map(([name, x, y, dir = 0, extra = {}]) => {
      const [rx, ry] = rot(x, y, d);
      const def = ENTITY_DEFS[name];
      const e = ent(name, rx, ry, { ...extra });
      if (def?.rotates) e.direction = (dir + d) % 16;
      return e;
    });
    return bp(label, entities);
  };
}

export function buildScenarios() {
  const scenarios = [];
  const add = (id, label, fn) => scenarios.push({ id, label, make: fn });

  // Belts and belt structures
  const tiers = [['transport-belt', 'underground-belt', 'splitter'], ['fast-transport-belt', 'fast-underground-belt', 'fast-splitter'], ['express-transport-belt', 'express-underground-belt', 'express-splitter']];
  for (const [belt, ug, sp] of tiers) {
    add(`${belt}-run`, `${belt}: straight run (start → end)`, layout(`${belt} run`, [[belt, 0.5, 1.5, 0], [belt, 0.5, 0.5, 0], [belt, 0.5, -0.5, 0]]));
    add(`${belt}-loop`, `${belt}: loop (4 turns)`, layout(`${belt} loop`, [
      [belt, -0.5, -0.5, 4], [belt, 0.5, -0.5, 8], [belt, 0.5, 0.5, 12], [belt, -0.5, 0.5, 0],
    ]));
    add(`${belt}-sideload`, `${belt}: side-load`, layout(`${belt} sideload`, [[belt, 0.5, 1.5, 0], [belt, 0.5, 0.5, 0], [belt, 0.5, -0.5, 0], [belt, 1.5, 0.5, 12]]));
    add(`${ug}`, `${ug}: pair`, layout(`${ug}`, [[belt, 0.5, 2.5, 0], [ug, 0.5, 1.5, 0, { type: 'input' }], [ug, 0.5, -1.5, 0, { type: 'output' }], [belt, 0.5, -2.5, 0]]));
    add(`${sp}`, `${sp}: with belts`, layout(`${sp}`, [[belt, 0.5, 1.5, 0], [belt, 1.5, 1.5, 0], [sp, 1, 0.5, 0], [belt, 0.5, -0.5, 0], [belt, 1.5, -0.5, 0]]));
  }

  // Inserters with a chest behind and a belt in front
  for (const name of ['burner-inserter', 'inserter', 'fast-inserter', 'long-handed-inserter', 'bulk-inserter', 'stack-inserter']) {
    const reach = name === 'long-handed-inserter' ? 2 : 1;
    add(name, `${name}: chest → belt`, layout(name, [[name, 0.5, 0.5, 0], ['iron-chest', 0.5, 0.5 - reach], ['transport-belt', 0.5, 0.5 + reach, 4]]));
  }

  // Everything else with a model, alone on its plate
  for (const def of Object.values(ENTITY_DEFS)) {
    if (!def.hasModel || ['belt', 'underground', 'splitter', 'inserter', 'wall'].includes(def.kind)) continue;
    add(def.name, `${def.name} (${def.size.w}×${def.size.h})`, layout(def.name, [[def.name, def.size.w / 2, def.size.h / 2, 0]]));
  }

  // Walls
  const wall = 'stone-wall';
  add('wall-single', 'stone-wall: single (pylon)', layout('wall pylon', [[wall, 0.5, 0.5]]));
  add('wall-run', 'stone-wall: straight run (endings)', layout('wall run', [[wall, 0.5, -0.5], [wall, 0.5, 0.5], [wall, 0.5, 1.5]]));
  add('wall-ring', 'stone-wall: 3×3 ring (corners)', layout('wall ring', [
    [wall, -0.5, -0.5], [wall, 0.5, -0.5], [wall, 1.5, -0.5], [wall, 1.5, 0.5], [wall, 1.5, 1.5], [wall, 0.5, 1.5], [wall, -0.5, 1.5], [wall, -0.5, 0.5],
  ]));
  add('wall-cross', 'stone-wall: cross (X + endings)', layout('wall cross', [[wall, 0.5, 0.5], [wall, -0.5, 0.5], [wall, 1.5, 0.5], [wall, 0.5, -0.5], [wall, 0.5, 1.5]]));
  add('wall-t', 'stone-wall: T junction', layout('wall T', [[wall, -0.5, 0.5], [wall, 0.5, 0.5], [wall, 1.5, 0.5], [wall, 0.5, 1.5]]));

  // Overview: every single model in a row
  add('all', 'ALL models in a row', (d) => {
    n = 0;
    const entities = [];
    let x = 0;
    for (const def of Object.values(ENTITY_DEFS)) {
      if (!def.hasModel || ['belt', 'underground', 'splitter'].includes(def.kind)) continue;
      const e = ent(def.name, x + def.size.w / 2, def.size.h / 2);
      if (def.rotates) e.direction = d;
      entities.push(e);
      x += def.size.w + 1;
    }
    for (const belt of ['transport-belt', 'fast-transport-belt', 'express-transport-belt']) {
      entities.push(ent(belt, x + 0.5, 0.5, { direction: d }));
      x += 2;
    }
    return bp('all models', entities);
  });

  return scenarios;
}

/**
 * Mounts the dev panel above the Blueprint panel.
 * @param {{ onLoad: (json: object, label: string) => void }} opts
 */
export function installDevCycler({ onLoad }) {
  const scenarios = buildScenarios();
  const params = new URLSearchParams(location.search);
  let index = Math.min(scenarios.length - 1, Math.max(0, Number(params.get('i') ?? 0) || 0));
  let dir = [0, 4, 8, 12].includes(Number(params.get('d'))) ? Number(params.get('d')) : 0;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <h2>Model check <span class="text-f-muted" style="font-weight:400">(dev)</span></h2>
    <select id="dev-select" class="f-select"></select>
    <div class="mt-2 flex flex-wrap items-center gap-y-2">
      <button id="dev-prev" class="button button-small" type="button" title="Left arrow">◀ Prev</button>
      <button id="dev-next" class="button button-small" type="button" title="Right arrow">Next ▶</button>
      <button id="dev-rot" class="button button-small" type="button" title="R">Rotate <span id="dev-dir">N</span></button>
      <span id="dev-pos" class="ml-auto text-xs text-f-muted"></span>
    </div>
    <p class="mt-2 text-xs text-f-muted">Each entry is a tiny blueprint rendered through the normal pipeline on its grid plate. ← → step, R rotates.</p>`;
  const anchor = document.getElementById('bp-input')?.closest('.panel');
  anchor?.parentElement?.insertBefore(panel, anchor);

  const select = panel.querySelector('#dev-select');
  scenarios.forEach((s, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${i + 1}. ${s.label}`;
    select.appendChild(o);
  });

  const DIR_NAME = { 0: 'N', 4: 'E', 8: 'S', 12: 'W' };
  const show = () => {
    const s = scenarios[index];
    select.value = String(index);
    panel.querySelector('#dev-dir').textContent = DIR_NAME[dir];
    panel.querySelector('#dev-pos').textContent = `${index + 1} / ${scenarios.length}`;
    const url = new URL(location.href);
    url.searchParams.set('dev', '');
    url.searchParams.set('i', String(index));
    url.searchParams.set('d', String(dir));
    history.replaceState(null, '', url);
    onLoad(s.make(dir), s.label);
  };
  const step = (delta) => {
    index = (index + delta + scenarios.length) % scenarios.length;
    show();
  };
  select.addEventListener('change', () => {
    index = Number(select.value);
    show();
  });
  panel.querySelector('#dev-prev').addEventListener('click', () => step(-1));
  panel.querySelector('#dev-next').addEventListener('click', () => step(1));
  panel.querySelector('#dev-rot').addEventListener('click', () => {
    dir = (dir + 4) % 16;
    show();
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'r' || e.key === 'R') {
      dir = (dir + 4) % 16;
      show();
    }
  });
  show();
}
