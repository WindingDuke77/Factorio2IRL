// Belt items: Wube's "Belt Items" set has six small prints that sit on the belt tops.
// This module maps Factorio item/recipe names to those prints and guesses which one a
// blueprint carries from its recipes, filters, requests and icons.

export const BELT_ITEMS = {
  gear: { key: 'item/gear', label: 'Gear', color: 0xb3b3b3 },
  circuit: { key: 'item/circuit', label: 'Circuit', color: 0x3f9d5a },
  cable: { key: 'item/copper-cable', label: 'Copper cable', color: 0xd2793a },
  plate: { key: 'item/iron-or-copper-plate', label: 'Iron / copper plate', color: 0xa9b1b8 },
  copper: { key: 'item/iron-or-copper-plate', label: 'Copper plate', color: 0xc9772f },
  steel: { key: 'item/steel-plate', label: 'Steel plate', color: 0x8c99a6 },
  science: { key: 'item/science-bottle', label: 'Science bottle', color: 0xd9342b },
};

export const ITEM_ORDER = ['gear', 'circuit', 'cable', 'plate', 'copper', 'steel', 'science'];

const NAME_TO_ITEM = {
  'iron-gear-wheel': 'gear',
  'electronic-circuit': 'circuit',
  'advanced-circuit': 'circuit',
  'processing-unit': 'circuit',
  'copper-cable': 'cable',
  'iron-plate': 'plate',
  'copper-plate': 'copper',
  'steel-plate': 'steel',
  'iron-ore': 'plate',
  'copper-ore': 'copper',
  'stone-furnace': 'plate',
  'steel-furnace': 'plate',
};

/** Map a Factorio item or recipe name to one of our item ids (or null). */
export function itemFor(name) {
  if (!name) return null;
  if (NAME_TO_ITEM[name]) return NAME_TO_ITEM[name];
  if (/science-pack$/.test(name)) return 'science';
  return null;
}

/**
 * Look through a normalised blueprint for hints about what travels on its belts.
 * @returns {{ best: string|null, found: Array<{item: string, name: string, source: string, count: number}> }}
 */
export function detectItems(normalized) {
  const tally = new Map();
  const add = (name, source, weight = 1) => {
    const item = itemFor(name);
    if (!item) return;
    const k = `${item}|${name}|${source}`;
    const cur = tally.get(k) ?? { item, name, source, count: 0 };
    cur.count += weight;
    tally.set(k, cur);
  };

  for (const e of normalized.entities) {
    const raw = e.raw ?? {};
    if (raw.recipe) add(typeof raw.recipe === 'string' ? raw.recipe : raw.recipe?.name, 'recipe', 3);
    // Inserter / splitter filters (1.x and 2.0 shapes).
    for (const f of raw.filters ?? []) add(f?.name ?? f, 'filter', 2);
    if (raw.filter) add(typeof raw.filter === 'string' ? raw.filter : raw.filter?.name, 'filter', 2);
    // Logistic requests.
    const rf = raw.request_filters;
    if (Array.isArray(rf)) for (const f of rf) add(f?.name, 'request', 1);
    else if (rf?.sections) for (const s of rf.sections) for (const f of s.filters ?? []) add(f?.name, 'request', 1);
    // Furnace / drill outputs are plates or ore in practice.
    if (e.name === 'stone-furnace' || e.name === 'steel-furnace') add('iron-plate', 'furnace', 0.5);
  }
  for (const ic of normalized.icons ?? []) add(ic?.signal?.name, 'icon', 1);

  const found = [...tally.values()].sort((a, b) => b.count - a.count);
  const byItem = new Map();
  for (const f of found) byItem.set(f.item, (byItem.get(f.item) ?? 0) + f.count);
  const best = [...byItem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { best, found };
}
