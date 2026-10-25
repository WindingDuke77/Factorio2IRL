// Dev tuning panel (?dev): edit each part's rotation / tilt / offset / stacking live and save it
// back to src/config/*.json through the Vite dev server (see vite.config.js).

import { PARTS, COMPOSITES, LEVELS, ensurePart, partFileName } from '../render/orientation.js';

const $ = (id) => document.getElementById(id);

export function installTuner({ state, rebuild }) {
  const originals = {};
  for (const [k, v] of Object.entries(PARTS)) originals[k] = structuredClone(v);
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <h2>Tune parts <span class="text-f-muted" style="font-weight:400">(dev)</span></h2>
    <p class="text-xs text-f-muted">Units: tiles (1 = 25 mm), degrees. Changes apply live; Save writes the JSON file in <code>src/config/</code>.</p>
    <div id="tune-levels" class="panel-inset m-0 mt-2"></div>
    <div id="tune-parts" class="mt-2 flex flex-col gap-2"></div>
    <div id="tune-composites" class="mt-2 flex flex-col gap-2"></div>
    <div id="tune-status" class="mt-2 text-xs text-f-muted"></div>`;
  const anchor = $('bp-input')?.closest('.panel');
  anchor?.parentElement?.insertBefore(panel, anchor);

  const status = (msg, ok = true) => {
    const el = $('tune-status');
    el.textContent = msg;
    el.className = `mt-2 text-xs ${ok ? 'text-f-green' : 'text-f-red'}`;
  };

  async function save(kind, name, data) {
    try {
      const r = await fetch('/__f2i/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, name, data }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      status(`Saved ${j.file}`);
    } catch (e) {
      status(`Save failed: ${e.message}`, false);
    }
  }

  const num = (value, step, onChange, width = 'w-16') => {
    const i = document.createElement('input');
    i.type = 'number';
    i.step = String(step);
    i.value = String(value ?? 0);
    i.className = `f-input ${width} px-1`;
    i.style.height = '26px';
    i.addEventListener('input', () => onChange(Number(i.value) || 0));
    return i;
  };
  const labelled = (text, el) => {
    const w = document.createElement('label');
    w.className = 'flex items-center gap-1 text-xs';
    w.append(text, el);
    return w;
  };

  function renderLevels() {
    const box = $('tune-levels');
    box.innerHTML = '<div class="f-label">Levels (plate pocket floor / tile thickness / tile pocket)</div>';
    const row = document.createElement('div');
    row.className = 'flex flex-wrap items-center gap-2';
    for (const k of ['tileFloor', 'tileThick', 'tilePocket']) {
      row.appendChild(labelled(k, num(LEVELS[k], 0.005, (v) => { LEVELS[k] = v; rebuild(); })));
    }
    const b = document.createElement('button');
    b.className = 'button button-small';
    b.type = 'button';
    b.textContent = 'Save';
    b.addEventListener('click', () => save('levels', 'levels', LEVELS));
    row.appendChild(b);
    box.appendChild(row);
  }

  function partRow(key) {
    const cfg = ensurePart(key);
    const summaryText = () => `rot ${cfg.rotation} · on ${cfg.stackOn ?? '—'} · inset ${cfg.inset}`;
    const det = document.createElement('details');
    det.className = 'panel-inset m-0';
    det.innerHTML = `<summary class="text-sm"><span class="chev"></span><b class="text-f-cream">${key}</b> <span class="text-f-muted">${summaryText()}</span></summary>`;
    const sum = det.querySelector('summary span.text-f-muted');
    const apply = () => { sum.textContent = summaryText(); rebuild(); };
    const body = document.createElement('div');
    body.className = 'mt-2 flex flex-col gap-1';

    const r1 = document.createElement('div');
    r1.className = 'flex flex-wrap items-center gap-2';
    const rotSel = document.createElement('select');
    rotSel.className = 'f-select w-20';
    rotSel.style.height = '26px';
    for (const v of [0, 4, 8, 12]) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = `${v} (${['N', 'E', 'S', 'W'][v / 4]})`;
      rotSel.appendChild(o);
    }
    rotSel.value = String(cfg.rotation ?? 0);
    rotSel.addEventListener('change', () => { cfg.rotation = Number(rotSel.value); apply(); });
    r1.appendChild(labelled('rotation', rotSel));
    for (const a of ['x', 'y', 'z']) r1.appendChild(labelled(`tilt ${a}`, num(cfg.tilt[a], 5, (v) => { cfg.tilt[a] = v; apply(); })));
    body.appendChild(r1);

    const r2 = document.createElement('div');
    r2.className = 'flex flex-wrap items-center gap-2';
    for (const a of ['x', 'y', 'z']) r2.appendChild(labelled(`offset ${a}`, num(cfg.offset[a], 0.01, (v) => { cfg.offset[a] = v; apply(); })));
    body.appendChild(r2);

    const r3 = document.createElement('div');
    r3.className = 'flex flex-wrap items-center gap-2';
    const on = document.createElement('input');
    on.className = 'f-input w-44 px-1';
    on.style.height = '26px';
    on.value = cfg.stackOn ?? '';
    on.placeholder = 'stack on (key)';
    on.addEventListener('change', () => { cfg.stackOn = on.value.trim() || null; apply(); });
    r3.appendChild(labelled('on', on));
    r3.appendChild(labelled('inset', num(cfg.inset, 0.005, (v) => { cfg.inset = v; apply(); })));
    const raw = document.createElement('input');
    raw.type = 'checkbox';
    raw.checked = Boolean(cfg.rawFrame);
    raw.addEventListener('change', () => { cfg.rawFrame = raw.checked; apply(); });
    r3.appendChild(labelled('raw frame', raw));
    const b = document.createElement('button');
    b.className = 'button button-small';
    b.type = 'button';
    b.textContent = 'Save';
    b.addEventListener('click', () => save('part', partFileName(key), cfg));
    r3.appendChild(b);
    const reset = document.createElement('button');
    reset.className = 'button button-small';
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.title = 'Back to the values loaded from the JSON file';
    reset.addEventListener('click', () => {
      const o = originals[key];
      for (const k of Object.keys(cfg)) if (k !== 'key') delete cfg[k];
      Object.assign(cfg, structuredClone(o ?? { rotation: 0, tilt: { x: 0, y: 0, z: 0 }, offset: { x: 0, y: 0, z: 0 }, stackOn: null, inset: 0, rawFrame: false, notes: '' }));
      const fresh = partRow(key);
      fresh.open = true;
      det.replaceWith(fresh);
      rebuild();
    });
    r3.appendChild(reset);
    body.appendChild(r3);
    if (cfg.notes) {
      const n = document.createElement('div');
      n.className = 'text-xs text-f-muted';
      n.textContent = cfg.notes;
      body.appendChild(n);
    }
    det.appendChild(body);
    return det;
  }

  function compositeRow(entity, parts) {
    const det = document.createElement('details');
    det.className = 'panel-inset m-0';
    det.innerHTML = `<summary class="text-sm"><span class="chev"></span><b class="text-f-cream">${entity}</b> <span class="text-f-muted">assembly · ${parts.length} parts</span></summary>`;
    const body = document.createElement('div');
    body.className = 'mt-2 flex flex-col gap-1';
    parts.forEach((part, i) => {
      const row = document.createElement('div');
      row.className = 'flex flex-wrap items-center gap-2';
      row.append(Object.assign(document.createElement('span'), { className: 'text-xs w-28', textContent: `${i}. ${part.key}` }));
      if (part.from) {
        row.append(Object.assign(document.createElement('span'), { className: 'text-xs text-f-muted', textContent: `${JSON.stringify(part.from)} → ${JSON.stringify(part.to)}` }));
        row.appendChild(labelled('t', num(part.t ?? 0.5, 0.02, (v) => { part.t = v; rebuild(); })));
      } else {
        part.pos ??= [0, 0, 0];
        part.rot ??= [0, 0, 0];
        ['x', 'y', 'z'].forEach((a, k) => row.appendChild(labelled(`pos ${a}`, num(part.pos[k], 0.01, (v) => { part.pos[k] = v; rebuild(); }))));
        ['x', 'y', 'z'].forEach((a, k) => row.appendChild(labelled(`rot ${a}`, num(part.rot[k], 5, (v) => { part.rot[k] = v; rebuild(); }))));
      }
      body.appendChild(row);
    });
    const b = document.createElement('button');
    b.className = 'button button-small';
    b.type = 'button';
    b.textContent = 'Save assembly';
    b.addEventListener('click', () => save('composite', entity, { entity, parts }));
    body.appendChild(b);
    det.appendChild(body);
    return det;
  }

  function refresh() {
    renderLevels();
    const partsBox = $('tune-parts');
    partsBox.innerHTML = '<div class="f-label">Parts in this scene</div>';
    const keys = new Set();
    for (const p of state.placements?.pieces ?? []) {
      if (p.group === 'grid' || p.group === 'hardware') continue;
      if (COMPOSITES[p.key]) for (const part of COMPOSITES[p.key]) keys.add(part.key);
      else keys.add(p.key);
    }
    for (const k of [...keys].sort()) partsBox.appendChild(partRow(k));
    const compBox = $('tune-composites');
    compBox.innerHTML = '';
    const ents = new Set((state.placements?.pieces ?? []).map((p) => p.key).filter((k) => COMPOSITES[k]));
    if (ents.size) compBox.innerHTML = '<div class="f-label">Assemblies in this scene</div>';
    for (const e of ents) compBox.appendChild(compositeRow(e, COMPOSITES[e]));
  }

  // Refresh when the scene changes (the cycler loads a new scenario).
  let last = null;
  setInterval(() => {
    const sig = state.flat[state.selected]?.label ?? null;
    if (sig !== last) {
      last = sig;
      refresh();
    }
  }, 500);
  refresh();
}
