# Factorio2IRL

Paste a Factorio blueprint string, see it rendered in 3D out of Wube Software's **official
3D-printable models**, and get the list of parts you need to print to build it for real.

- Decodes blueprint strings (1.x and 2.0) and blueprint books, or raw blueprint JSON.
- Resolves belt shapes (straight / turn / start / end / underground / splitter) and wall
  junctions the same way the game does, then picks the matching printed piece.
- Renders everything with three.js using Wube's STLs converted to compact GLB files.
- Produces a parts list grouped by Printables model set: entity models, shaped tiles, grid base
  plates and pins, with the High Precision / High Clearance variant you choose, plus a list of
  entities that have no official model yet (shown as placeholders in 3D).
- Styled after factorio.com.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173, paste a blueprint string (or load a sample) and press
**Render**. `npm run build` writes a static site to `dist/`.

`?gallery` shows every converted piece laid out for inspection; `?gallery=belt/&view=top` filters
by key prefix and picks a camera (`iso`, `top`, `front`, `bottom`).

## Models

The models come from Wube's Printables profile: https://www.printables.com/@WubeSoftware/models
(CC BY-NC). The converted GLBs in `public/models/` are committed so the app works straight after
cloning. To refresh them:

```bash
npm run models        # = fetch-models + convert-models
```

- `scripts/build-catalog.mjs` queries the Printables API and writes `scripts/catalog.json`,
  mapping every one of the 247 STL files to a stable key (`belt/straight-top`, `tile/inserter`,
  `grid/4x6`, …). Only pieces used for rendering are marked `render: true`.
- `scripts/fetch-models.mjs` downloads those STLs into `models-raw/` (git-ignored, ~120 MB).
- `scripts/convert-models.mjs` converts STL → GLB (Y-up, 1 tile = 1 unit, simplified to
  ≤ 40k triangles, meshopt-compressed) and writes `public/models/manifest.json`.

### Scale and assembly facts

- One Factorio tile is **25 mm** (the grid plates are exactly 25 mm × N); the shaped tiles are
  23.9 mm so they drop into the plates.
- Every belt tile is a *Bottom* (base with rollers) plus a *Top* (chevron surface), snapped into a
  shaped *Tile*, which pins into a *Grid* base plate. Pin counts in the parts list are estimates.
- The small electric pole STL is a print plate of loose parts, so the 3D view draws a simple
  stand-in for it; the parts list still names the real file.
- `src/render/orientation.js` documents how each model is oriented in its own file (belts flow
  east, turn pieces pivot at the NW corner, underground hoods are modelled standing on their
  mouth, inserter arms are flat side profiles, "Ending N" walls have the free end facing north).

## Project layout

```
src/blueprint/   decode.js, normalize.js, entities.js, belts.js, walls.js, grid.js, placements.js
src/render/      scene.js, models.js, build.js, orientation.js, gallery.js
src/bom/         bom.js (parts list + text/CSV export)
src/ui/          bomPanel.js
scripts/         Printables API, catalog, fetch and convert scripts, sample generator
test/            node --test unit tests (decode, directions, belt shapes, walls, grid tiling)
```

`npm test` runs the unit tests. `node scripts/make-samples.mjs` regenerates the sample strings in
`src/data/samples.json`.

## GitHub Pages

The repo is private, so Pages is not set up. To publish later: make the repo public (or use a
plan that allows Pages on private repos), then build with the sub-path and deploy `dist/`:

```bash
BASE_PATH=/Factorio2IRL/ npm run build
```

## Credits

3D models © Wube Software, released on Printables under CC BY-NC. Factorio is a trademark of Wube
Software. This is an unofficial fan tool. See [ATTRIBUTION.md](ATTRIBUTION.md).
