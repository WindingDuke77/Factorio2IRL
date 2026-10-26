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
**Render**. The blueprint, the selected book entry, the print and view options and the camera are
kept in the browser's local storage, so a reload comes back to the same view (Clear forgets them). `npm run build` writes a static site to `dist/`.

`?gallery` shows every converted piece laid out for inspection; `?gallery=belt/&view=top` filters
by key prefix and picks a camera (`iso`, `top`, `front`, `bottom`). `?dev` ("Model check" in the
top bar) cycles through every entity type and belt/wall configuration as a tiny blueprint on its
grid plate, through the normal pipeline: Prev/Next/Rotate, arrow keys and R, `&i=<n>&d=<dir>` to
deep-link, `&view=top` for a top-down camera. The three `transport-belt: … ends` entries switch the
belt-end option so each end style can be tuned. In `?dev` a **Tune parts** panel lists every piece
in the current scene and lets you change its placement live and save it (see *Tuning parts*).

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
  shaped *Tile*, which pins into a *Grid* base plate. The parts list counts one Grid PIN for every tile along a seam between two plates, and one Splitter Pin
  print (the file holds the pair) per splitter. "Compact plates" puts plates (and Empty Tiles) only where
  cells are occupied instead of filling the whole rectangle.
  The 3D view draws the same stack: grid plate, tiles (shaped ones under models, Empty Tiles
  elsewhere), models on top. Tiles can be hidden with the "Show tiles" toggle.
- Three STLs are print plates of loose parts, split into connected components by `convert-models`
  and assembled by `src/config/composites/*.json` (positions and rotations per part, tunable in
  `?dev`): the electric mining drill (frame, auger, drive rod, head, two leg housings with chain
  struts, two hoses, hydraulic pistons, peg, bracket), the steel furnace (body plus three pipes, each
  printed as two D-profile halves which the converter mirrors into a round pipe) and the small
  electric pole (base plus two different half-shells, `pole/profile` and `pole/profile-b`, stood up
  from their own crossarm ends so they meet at their flat faces). Wall pieces are modelled around
  their tile, so they are placed by their raw offset rather than their bounding-box centre.
- Inserter arms are printed flat and folded at two hex hinges (see Wube's assembly guide); the
  loader folds them the same way (`foldArm` in `src/render/models.js`). The stack inserter plate
  also carries a second hand, which the converter stacks on the arm's own hand for the double claw.
- Belt items (gear, circuit, copper cable, plate, steel plate, science bottle) are placed two per
  lane on straight belts. "Auto" picks the item from the blueprint's recipes, filters, logistic
  requests and icons; you can also force one item or a mix.
- Wall corners, T- and X-junctions each take one "Walls Fill-In" plug.
- Stacking heights come from the STLs: the grid plate is a 2 mm slab with a 1.5 mm rim, tiles
  (2 mm) drop into that pocket, shaped tiles have a 1 mm pocket the model base sits in, and the
  belt top rests on the 4.75 mm plateau inside its base, so the plus pegs slot into the plate.
- Print options has a **Printer** search box (`src/data/printers.json`, add your own) and a **Print scale**.
  Picking a printer caps the grid base plates to what fits its bed (25 mm per tile at 100%, 3 mm
  margins; a 180 mm bed gets plates up to 6×6) and pre-fills the Pack dialog's bed size. The scale
  applies to the parts list's mm sizes, the plate cap and the 3MF plates; STL copies stay at 100%.
- Belt ends default to the integrated "long" end piece; "short" puts the rounded cap on the free tile
  before/after the belt (with its End Short Tile), "medium" the medium piece on its End Medium Tile,
  "none" leaves plain straights.
- Chests can be drawn closed (one piece) or open (body + lid propped at the back hinge); logistic
  chests always carry their separate lid plate. Both are counted in the parts list.
- How each model is oriented in its own file (belts flow east, turn pieces pivot at the NW corner,
  underground hoods are modelled standing on their mouth, inserter arms are flat side profiles,
  "Ending N" walls have the free end facing north) is captured per piece in `src/config/parts/`.

## Tuning parts

Every converted piece has a JSON file in `src/config/parts/` (the key with `/` replaced by `__`,
so `belt/underground-in-top` is `belt__underground-in-top.json`). Units are tiles (1 = 25 mm)
and degrees:

| field | meaning |
|---|---|
| `rotation` | 0/4/8/12 = 0/90/180/270° added to the entity direction so the model faces north |
| `tilt` | degrees about the piece's own X/Y/Z, for pieces modelled in a printing pose (hoods, lids, the splitter base) |
| `offset` | tiles, added after the piece is centred on its tile; `y` raises it, `x`/`z` slide it (z negative = towards the front of the tile) |
| `stackOn` | key of the piece it sits on (belt top on belt bottom, lid on chest, arm on inserter base) |
| `inset` | how far (tiles) it sinks into that piece; `0` rests on its top |
| `rawFrame` | keep the STL's raw offset instead of centring (walls are modelled around their tile) |
| `notes` | free text |

`src/config/levels.json` holds the stacking heights of the base-plate system (grid plate pocket
floor, tile thickness, shaped-tile pocket). `src/config/composites/<entity>.json` lists the parts
of the drill, the steel furnace and the pole with a position and rotation each (or an anchor line
for the drill legs and rails).

The quickest way to adjust them is the **Tune parts** panel in `?dev`: pick a scenario with
Prev/Next, open a piece, change a number and the scene rebuilds at once; **Save** writes the
file through the dev server, **Reset** goes back to the saved values. Editing the JSON by hand
works too (the dev server reloads it). What to check for each piece, against Wube's assembly
photos:

- it sits on the right part (`stackOn`) at the right height: no gap underneath and not sunk
  into it (`inset`, or `offset.y` for a one-off nudge);
- it faces the right way for direction north (`rotation`), and belts/hoods face their neighbours
  once rotated (check in `&d=4` too);
- it lies the right way up (`tilt`) and is centred on its tile (`offset.x`/`offset.z`).

## Slicer export

The **Pack** button next to the parts list opens a dialog (STL files and/or 3MF plates, bed size
presets or custom, plates grouped by colour, strictly by colour, by part type or mixed, gap and
margin) and downloads a zip with one copy of every needed STL named with its quantity, the parts
list, and one 3MF per print plate with the instances arranged on the bed. Parts larger than the
bed get a plate of their own. It is built in the browser from the original STLs, which the dev server serves from `models-raw/` at `/stl/…` and
`vite build` copies into `dist/stl` (`npm run fetch-models` first; set `NO_STL=1` to skip the copy).
`npm run pack -- --sample smelting` (or `--file my-blueprint.txt`) writes the same pack to a folder
from the command line, with flags for bed size, gap, plate grouping and the print options (header of
`scripts/pack.mjs`). The shared code lives in `src/export/`.
[docs/slicer-export.md](docs/slicer-export.md) has the remaining ideas (file links, print batches).

## Project layout

```
src/blueprint/   decode.js, normalize.js, entities.js, belts.js, walls.js, grid.js, placements.js
src/render/      scene.js, models.js, build.js, orientation.js (loads src/config), gallery.js
src/config/      parts/*.json (one per piece), composites/*.json, levels.json
src/dev/         cycler.js (model check), tune.js (tuning panel + save via vite.config.js)
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
