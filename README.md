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

- A constrained sketch (rectangle + centred hole) solved by SolveSpace's `slvs`.
- Drag a corner; add width/height dimensions to make it fully constrained; drive the
  dimensions with sliders.
- Extrude in OCCT inside a Web Worker, rendered with three.js (Z-up, mm).
- Exact volume/face/triangle stats, and an e2e test that checks them numerically.

It is intentionally narrow: the sketch is currently hard-coded, the feature tree is a
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
