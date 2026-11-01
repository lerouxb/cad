# cad

A browser-based parametric CAD app: constrained 2D sketches → 3D features → an editable
history, including sketches made on faces of the resulting solid.

Think "the core loop of Fusion 360", not a mesh editor.

![The example sketch: constraints, the contextual selection popover and the feature history](docs/images/spike.png)

## Run it

```bash
nvm use          # Node from .nvmrc
npm install
npm run dev
```

The first load pulls ~1.6 MB gzip of solver and ~7 MB gzip of OCCT. Both load lazily;
the app shows `solver ready` / `kernel ready` badges when they are up.

```bash
npm run verify   # typecheck + lint + typography audit + unit tests
npm run e2e      # Playwright: exact-volume smoke test
npm run build
```

## What works today

The main stage toggles between the **model** and a full-stage **sketch editor** via the
timeline at the bottom. Sketch mode has a floating tool strip, a DOF pill, and a floating
selection/dimension inspector; there is no permanent sidebar.

- Draw with the **line**, **point**, **rectangle**, **circle**, and **three-point arc**
  tools. Standalone points are real solver geometry (drag, constrain, dimension, edit
  X/Y) but never form a profile on their own. The grid is the snap grid: its step adapts
  to the zoom, accepts any free-form mm value, has a scale bar, and zoom presets are
  fit / 50% / 100% / 200%. Grid and point snapping; axis inference
  adds horizontal/vertical constraints; chains close on their first point. Select two
  adjacent lines to round the corner with a parametric **fillet**.
- Drag points, whole lines, circles, and arcs: the cursor delta is projected onto the
  constraint tangent space, so points slide along lines and circles and lines translate
  (or stretch, if their endpoints are constrained differently). Fully constrained
  geometry refuses to move.
- Dimension distances, point-to-line distances, angles, diameters, and radii; driving or
  reference. Dimension and trim are contextual: select the line/circle/points first, then
  use the selection popover. Applied constraints appear as active chips; click one to
  remove it (H/V, parallel, equal, ...). Double-click a value to edit it inline; drag a
  label along a line or radially. The selection popover also adds
  perpendicular/parallel/equal/tangent/symmetric/midpoint/point-on-
  line/point-on-circle/coincident/fix and toggles construction geometry.
- A selectable fixed **origin and X/Y axes** are always available for constraints and
  dimensions. Select a point to type exact **X/Y** coordinates; the same constraint
  projection as dragging applies.
- Extrude any closed region: a plate, a cylinder from a lone circle, a tube from two
  concentric circles, an arbitrary face with nested cutouts, or a mixed line/arc profile.
  Click filled regions to choose one or more profiles (Shift adds; All, Voids and Auto are
  in the corner panel); selected regions are fused into one body. A hole is selectable
  too: it is the parent's cutout and, when clicked, a positive disk/void profile of its
  own. A line or arc that crosses a circle splits it into selectable faces (a chord
  through a hole yields two plate pieces and two half-disks). Arc edges stay exact
  through the kernel. OCCT runs in a Web Worker; three.js renders the solid with its B-rep
  edges (Z-up, mm). While an extrude is active, its source sketch is drawn on its plane in
  3D as a highlighter mark with an ink centerline (construction dashed), so the sketch
  plane and the one-sided vs symmetric direction are readable.
- **Select and delete**: click a curve or point, Shift-click to multi-select, Delete to
  remove. In sketch mode, **B** box-selects fully-enclosed profile regions and **G**
  lasso-selects profiles it touches (Shift toggles, a plain gesture replaces, an empty
  marquee is a no-op) for multi-region extrudes. Deletion cascades through
  dependent curves/constraints; undo restores it. In the 3D view, hover and click faces
  or edges for a highlighter selection readout; the selection is ephemeral UI state,
  cleared by Escape or a new mesh.
- **Undo/redo** with gesture grouping (`Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`), `Esc` to cancel a
  draft and clear the selection, `V/L/R/C/A/D` and `T` for tools. While drawing a line,
  **Enter** (or a double-click) finishes the open chain; with no draft, Enter finishes
  the sketch.
- **Split profiles and trim**: region extraction runs on a planar arrangement of the
  sketch, so crossing segments and T-junctions become real faces (two crossing diagonals
  produce four selectable triangles). The trim tool removes the clicked line/arc segment
  between intersections, with undo; constraints that cannot survive a split are reported.
- **A real document**: the sketch, extrude feature and selected regions live in a
  plain-JSON `Doc` with a schema version and migrations. The part autosaves to local
  storage and reopens with the same solid; the extrude height and region selection are
  undoable feature parameters. The ordered rebuild evaluates features on the main thread,
  caches the sketch prefix, and sends the extrude chain to the worker, which caches prefix
  solids and applies new/join/cut booleans with per-feature status. The history is the
  workspace: numbered steps, a selected-step summary line, a draggable parameter popover
  with a summary + `cancel`/`apply` footer, click to edit, double-click to rename, and
  per-feature status/diagnostics. **New sketch** is added from the timeline `+ sketch`
  support popover; **extrude** on the selected sketch starts a draft with no profile
  selected and only creates the history feature when applied. The built-in example
  includes a second **Mounting holes** sketch
  with a suppressed through-all cut, plus a suppressed **Center pin** extrude that reuses
  the original sketch's hole region — unsuppress either to see the holes or the cylinder.
  The
  shell follows the paper/ink studies: a document header, one stage status line, a grouped
  text tool line in sketch mode, a contextual selection popover, and one draggable
  parameter popover rather than a permanent inspector.
- Exact volume/face/triangle stats, and e2e tests that check them numerically while
  dragging, dimensioning, drawing, selecting/deleting, and undoing.
- A typography-first **paper-and-ink** interface with day/night themes and one
  highlighter colour (yellow, pink, blue, or green). The appearance is saved locally and
  survives reload; it follows the static studies in [`docs/mockups/`](docs/mockups/),
  which are design targets only and are never imported by `src/`.

It is intentionally narrow: auto mode defaults to the largest region until you click one,
split/trim works on lines and arcs (trimming a circle into an arc is still unsupported),
and datum planes and sketches on faces are M4. M3 is done: the history supports
create/edit, drag-reorder, suppress, delete-cascade, rollback/roll-forward, `.cad`
download/open/rename/new, a local file list with copy and delete, blind/symmetric/through-all
extrudes, and JSON-safe face refs whose roles now survive joins/cuts. Storing those refs
on features and projected face-boundary geometry are the first M4 tasks. Sketch pattern,
mirror and offset are planned as
**re-editable parametric operations** (M6.0, ADR-0004), not one-shot copies;
feature/body patterns/mirror are M6. Ellipses/conics/B-splines, free 3D sketches, 3D
fillets, lofts/sweeps, drafts, shelling/offsets, expressions and threads are tracked in
the **M9 TODO/limitations backlog** in `docs/PLAN.md`, with workarounds and the upstream
SolveSpace/OCCT work each would need. Editing the code behind a sketch/feature and the
command layer that lets a headless runner or AI drive the app are planned in **M8.5**
(ADR-0005).

## The stack in one line

TypeScript + React + three.js in the browser; SolveSpace's `slvs` as the 2D constraint
solver; OCCT (via `brepjs` + `occt-wasm`) in a Web Worker as the B-rep kernel.

Because `slvs` is GPLv3, this project is GPLv3.

## Docs

- [`AGENTS.md`](AGENTS.md) — stack, invariants, conventions, commands, gotchas
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how it works and why
- [`docs/PLAN.md`](docs/PLAN.md) — milestones and the next concrete tasks
- [`docs/mockups/`](docs/mockups/) — static paper-and-ink UI studies and visual rules;
  design targets, not application code
- [`docs/showcase/`](docs/showcase/) — sketch pattern/mirror/offset interaction studies
  (M6/M9 targets), also static
- [`docs/decisions/`](docs/decisions/) — architecture decision records
