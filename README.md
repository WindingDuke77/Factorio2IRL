# Factorio2IRL

Paste a Factorio blueprint string, see it rendered in 3D out of Wube Software's **official
3D-printable models**, and get the list of parts you need to print to build it for real.

- Decodes blueprint strings (1.x and 2.0) and blueprint books, or raw blueprint JSON.
- Resolves belt shapes (straight / turn / start / end / underground / splitter) and wall
  junctions the same way the game does, then picks the matching printed piece.
- Blueprint books: every blueprint in the book (nested books too) is listed; the book's active
  entry opens first. Planner entries are ignored.
- Puts Wube's printable belt items on the belts, auto-detected from the blueprint when possible.
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
by key prefix and picks a camera (`iso`, `top`, `front`, `bottom`). `?dev` ("Model check" in the
top bar) cycles through every entity type and belt/wall configuration as a tiny blueprint on its
grid plate, through the normal pipeline: Prev/Next/Rotate, arrow keys and R, `&i=<n>&d=<dir>` to
deep-link, `&view=top` for a top-down camera.

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
  The 3D view draws the same stack: grid plate, tiles (shaped ones under models, Empty Tiles
  elsewhere), models on top. Tiles can be hidden with the "Show tiles" toggle.
- Three STLs are print plates of loose parts: the electric mining drill (frame, drill bit, rod,
  head, legs, rails, pipes), the steel furnace (body + six pipes) and the small electric pole
  (base + two identical half-shells glued back to back). `convert-models` splits them into connected
  components (`drill/*`, `steel-furnace/body`, `pole/*`) and `src/render/orientation.js` assembles
  them. Wall pieces are modelled around their tile, so they are placed by their raw offset rather
  than their bounding-box centre.
- Inserter arms are printed flat and folded at two hex hinges (see Wube's assembly guide); the
  loader folds them the same way (`foldArm` in `src/render/models.js`).
- Belt items (gear, circuit, copper cable, plate, steel plate, science bottle) are placed two per
  lane on straight belts. "Auto" picks the item from the blueprint's recipes, filters, logistic
  requests and icons; you can also force one item or a mix.
- Wall corners, T- and X-junctions each take one "Walls Fill-In" plug.
- Stacking heights come from the STLs: the grid plate is a 2 mm slab with a 1.5 mm rim, tiles
  (2 mm) drop into that pocket, shaped tiles have a 1 mm pocket the model base sits in, and the
  belt top rests on the 4.75 mm plateau inside its base, so the plus pegs slot into the plate.
- Belt ends are optional (default none): "short" puts the rounded cap on the free tile before/after
  the belt (with its End Short Tile), "long" uses the integrated end piece, "medium" uses the
  medium piece plus the cap within the belt's tile.
- Chests can be drawn closed (one piece) or open (body + lid propped at the back hinge); logistic
  chests always carry their separate lid plate. Both are counted in the parts list.
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
