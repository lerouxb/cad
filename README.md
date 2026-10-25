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

- Draw with the **line**, **rectangle**, and **circle** tools. Grid and point snapping;
  axis inference adds horizontal/vertical constraints; chains close on their first point.
- Drag points: the cursor delta is projected onto the constraint tangent space, so points
  slide along lines and circles. Fully constrained geometry refuses to move.
- Extrude any closed region: a plate, a cylinder from a lone circle, a tube from two
  concentric circles, or an arbitrary face with nested line/circle cutouts. OCCT runs in
  a Web Worker; three.js renders the solid with its B-rep edges (Z-up, mm).
- **Select and delete**: click a curve or point, Shift-click to multi-select, Delete to
  remove. Deletion cascades through dependent curves/constraints; undo restores it.
- **Undo/redo** with gesture grouping (`Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`), `Esc` to cancel a
  draft and clear the selection, `V/L/R/C` for tools.
- Exact volume/face/triangle stats, and e2e tests that check them numerically while
  dragging, dimensioning, drawing, selecting/deleting, and undoing.

It is intentionally narrow: profile selection is "largest closed loop", dimensions only
exist on the example, there is no dimension/constraint tool yet, the feature tree is a
preview, and nothing is persisted yet. See `docs/PLAN.md` for what comes next.

## The stack in one line

TypeScript + React + three.js in the browser; SolveSpace's `slvs` as the 2D constraint
solver; OCCT (via `brepjs` + `occt-wasm`) in a Web Worker as the B-rep kernel.

Because `slvs` is GPLv3, this project is GPLv3.

## Docs

- [`AGENTS.md`](AGENTS.md) — stack, invariants, conventions, commands, gotchas
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how it works and why
- [`docs/PLAN.md`](docs/PLAN.md) — milestones and the next concrete tasks
- [`docs/decisions/`](docs/decisions/) — architecture decision records
