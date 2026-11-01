# cad

A browser-based parametric CAD app: constrained 2D sketches → 3D features → an editable
history, including sketches made on faces of the resulting solid.

Think "the core loop of Fusion 360", not a mesh editor.

![The current spike: a constrained sketch driving an extrude](docs/images/spike.png)

## Run it

```bash
nvm use          # Node from .nvmrc
npm install
npm run dev
```

The first load pulls ~1.6 MB gzip of solver and ~7 MB gzip of OCCT. Both load lazily;
the app shows `solver ready` / `kernel ready` badges when they are up.

```bash
npm run verify   # typecheck + lint + unit tests
npm run e2e      # Playwright: exact-volume smoke test
npm run build
```

## What works today

The main stage toggles between the **model** and a full-stage **sketch editor** via the
timeline at the bottom. Sketch mode has a floating tool strip, a DOF pill, and a floating
selection/dimension inspector; there is no permanent sidebar.

- Draw with the **line**, **rectangle**, **circle**, and **three-point arc** tools.
  Grid and point snapping; axis inference adds horizontal/vertical constraints; chains
  close on their first point. Select two adjacent lines to round the corner with a
  parametric **fillet**.
- Drag points, whole lines, circles, and arcs: the cursor delta is projected onto the
  constraint tangent space, so points slide along lines and circles and lines translate
  (or stretch, if their endpoints are constrained differently). Fully constrained
  geometry refuses to move.
- Dimension distances, point-to-line distances, angles, diameters, and radii; driving or
  reference; double-click to edit and drag the label anywhere out of the way. The floating
  constraint bar adds perpendicular/parallel/equal/tangent/symmetric/midpoint/point-on-
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
  through the kernel. OCCT runs in a Web Worker; three.js renders the solid with its B-rep edges
  (Z-up, mm).
- **Select and delete**: click a curve or point, Shift-click to multi-select, Delete to
  remove. Deletion cascades through dependent curves/constraints; undo restores it. In
  the 3D view, hover and click faces or edges for a highlighter selection readout; the
  selection is ephemeral UI state, cleared by Escape or a new mesh.
- **Undo/redo** with gesture grouping (`Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`), `Esc` to cancel a
  draft and clear the selection, `V/L/R/C/A/D` and `T` for tools. While drawing a line,
  **Enter** (or a double-click) finishes the open chain.
- **Split profiles and trim**: region extraction runs on a planar arrangement of the
  sketch, so crossing segments and T-junctions become real faces (two crossing diagonals
  produce four selectable triangles). The trim tool removes the clicked line/arc segment
  between intersections, with undo; constraints that cannot survive a split are reported.
- **A real document**: the sketch, extrude feature and selected regions live in a
  plain-JSON `Doc` with a schema version and migrations. The part autosaves to local
  storage and reopens with the same solid; the extrude height and region selection are
  undoable feature parameters. The ordered rebuild evaluates features on the main thread,
  caches the sketch prefix, and sends the extrude chain to the worker, which caches prefix
  solids and applies new/join/cut booleans with per-feature status.
- Exact volume/face/triangle stats, and e2e tests that check them numerically while
  dragging, dimensioning, drawing, selecting/deleting, and undoing.
- A typography-first **paper-and-ink** interface with day/night themes and one
  highlighter colour (yellow, pink, blue, or green). The appearance is saved locally and
  survives reload; it follows the static studies in [`docs/mockups/`](docs/mockups/),
  which are design targets only and are never imported by `src/`.

It is intentionally narrow: auto mode defaults to the largest region until you click one,
split/trim works on lines and arcs (trimming a circle into an arc is still unsupported),
and datum planes and sketches on faces are M4. Join/cut and multi-feature rebuilds work
for saved documents, but the timeline is still the fixed two-step list and cannot create
or edit a second feature yet. Ellipses/conics/B-splines, free 3D sketches, 3D fillets, lofts/sweeps,
patterns/mirror, drafts, shelling/offsets, expressions and threads are tracked in the
**M9 TODO/limitations backlog** in `docs/PLAN.md`, with workarounds and the upstream
SolveSpace/OCCT work each would need.

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
- [`docs/decisions/`](docs/decisions/) — architecture decision records
