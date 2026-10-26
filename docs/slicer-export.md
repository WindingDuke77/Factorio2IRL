# Draft: getting a blueprint into the slicer faster

What exists today: the parts list with per-set Printables links, and Copy / CSV exports of the
counts. Everything below is a proposal, roughly in order of effort.

## 1. Print list with direct file links (small)

Extend the CSV / text export with one row per STL file: Printables model, file name, variant
folder, quantity, suggested colour. `scripts/catalog.json` already holds the Printables file ids,
so each row can carry a link to the model page's file list. The user downloads each file once and
knows how many to place.

## 2. STL pack per blueprint (small, local)

`npm run pack -- blueprint.txt` (or `--sample smelting`): a node script that takes the STLs
already fetched into `models-raw/` and writes `pack/<name>/` with one copy of every needed STL,
named `<qty>x <file>.stl`, plus `parts.csv`. Drag the folder into any slicer. No redistribution
problem since the files stay on the user's machine (the fetch script gets them from Printables).

## 3. 3MF project export (medium, local)

Same script writes a `.3mf` for PrusaSlicer / Bambu Studio / OrcaSlicer: one object per part,
`qty` build items with transforms, pre-arranged on plates by colour (yellow belt tops, grey
bases, tile colour, plate colour) for a chosen bed size (`--bed 256x256`). Parts that do not fit
go to the next plate. 3MF is a zip with a small XML, so this is a few hundred lines and needs no
slicer-specific code. Per-object colour can be written as 3MF material / extruder metadata, which
Bambu and Orca pick up for multi-colour printers.

## 4. Print batches in the app (medium)

A "Print plan" section under the parts list: pick a bed size and up to N colours, and the app
groups the parts into plates ("Plate 1: 24 x Straight Bottom, grey"), with an estimated count of
plates and total print time from a per-part estimate stored in the catalog. This is the same
packing as item 3, just shown in the browser without producing files.

## 5. Profile hints (small)

A short note per set: layer height, supports (walls and the pole need none; the drill head and
furnace body benefit from tree supports), which tile variant to pick, and the parts that are
printed flat and folded or glued (inserters, pole halves, furnace pipes, drill hoses).

## 6. Deep links to the Printables file downloads (uncertain)

The Printables GraphQL download mutation works without login from node, but browsers block it
(CORS). A `?dl=` button could still open the model page with the right file highlighted; direct
STL downloads from the app would need a tiny proxy, which the static site does not have.

Suggested order: 1 and 5 (an afternoon), then 2 and 3 together since they share the packing code,
then 4.
