// Renders the parts list (bill of materials) panel and the header stats.

const $ = (id) => document.getElementById(id);

const GROUP_LABEL = { body: 'Models', item: 'Items on belts', hardware: 'Pins & plugs', tile: 'Tiles', grid: 'Grid plates' };

export function renderHeaderStats({ bom, entities }) {
  const el = $('header-stats');
  el.innerHTML = '';
  const stats = [
    [entities, 'entities'],
    [bom.totals.pieces, 'pieces to print'],
    [bom.physical ? `${Math.round(bom.physical.wMm)}×${Math.round(bom.physical.hMm)}` : '—', 'mm footprint'],
  ];
  for (const [value, label] of stats) {
    const div = document.createElement('div');
    div.className = 'f-stat';
    div.innerHTML = `<div class="value">${value}</div><div class="label">${label}</div>`;
    el.appendChild(div);
  }
}

export function renderBomPanel({ bom, label, missingKeys = [] }) {
  const summary = $('bom-summary');
  summary.innerHTML = '';
  for (const [value, text] of [
    [bom.totals.bodies, 'model parts'],
    [bom.totals.tiles, 'tiles'],
    [bom.totals.plates, 'grid plates'],
  ]) {
    const div = document.createElement('div');
    div.className = 'f-stat';
    div.innerHTML = `<div class="value">${value}</div><div class="label">${text}</div>`;
    summary.appendChild(div);
  }

  const body = $('bom-body');
  body.innerHTML = '';

  const intro = document.createElement('div');
  intro.className = 'f-note';
  intro.innerHTML = `Print the <b>High ${bom.variant === 'precision' ? 'Precision' : 'Clearance'}</b> versions. Footprint ${bom.bounds.w} × ${bom.bounds.h} tiles${
    bom.physical ? ` (~${Math.round(bom.physical.wMm)} × ${Math.round(bom.physical.hMm)} mm)` : ''
  }. Pin counts are estimates.`;
  body.appendChild(intro);

  if (!bom.sets.length) {
    const p = document.createElement('p');
    p.className = 'text-f-muted';
    p.textContent = 'No printable parts for this blueprint.';
    body.appendChild(p);
  }

  for (const set of bom.sets) {
    const details = document.createElement('details');
    details.open = true;
    details.className = 'panel-inset m-0';
    const sum = document.createElement('summary');
    sum.className = 'flex items-center justify-between gap-2';
    sum.innerHTML = `<span><span class="chev"></span><b class="text-f-cream">${escapeHtml(set.setName.replace(/^Factorio /, ''))}</b> <span class="text-f-muted">· ${set.total} parts</span></span>
      <a class="text-xs" href="${set.url}" target="_blank" rel="noopener" title="Open on Printables">Printables ↗</a>`;
    details.appendChild(sum);

    const table = document.createElement('table');
    table.className = 'panel-hole mt-2';
    let lastGroup = null;
    for (const row of set.rows) {
      if (row.group !== lastGroup) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<th colspan="2">${GROUP_LABEL[row.group] ?? row.group}</th>`;
        table.appendChild(tr);
        lastGroup = row.group;
      }
      const tr = document.createElement('tr');
      const missing = missingKeys.includes(row.key);
      tr.innerHTML = `<td class="qty">${row.qty}×</td><td>${escapeHtml(row.filename.replace(/\.stl$/i, ''))}${
        row.folder ? `<div class="text-xs text-f-muted">${escapeHtml(row.folder)}</div>` : ''
      }${missing ? '<div class="text-xs text-f-red">not shown in 3D (model missing)</div>' : ''}</td>`;
      table.appendChild(tr);
    }
    details.appendChild(table);
    body.appendChild(details);
  }

  if (bom.missing.length) {
    const details = document.createElement('details');
    details.open = true;
    details.className = 'panel-inset m-0';
    details.innerHTML = `<summary><span class="chev"></span><b class="text-f-red">No official model yet</b> <span class="text-f-muted">· shown as placeholders</span></summary>`;
    const table = document.createElement('table');
    table.className = 'panel-hole mt-2';
    for (const m of bom.missing) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td class="qty">${m.count}×</td><td>${escapeHtml(m.label)} <span class="text-xs text-f-muted">${m.w}×${m.h}${m.unknown ? ' · unknown entity' : ''}</span></td>`;
      table.appendChild(tr);
    }
    details.appendChild(table);
    body.appendChild(details);
  }

  if (bom.unknownKeys.length) {
    const p = document.createElement('p');
    p.className = 'text-xs text-f-red';
    p.textContent = `Internal: no catalog entry for ${bom.unknownKeys.map((k) => k.key).join(', ')}`;
    body.appendChild(p);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
