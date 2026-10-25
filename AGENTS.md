# AGENTS.md

Instructions for anyone (human or AI) working in this repo.

## What this is

A browser-based parametric CAD application. The mental model is Autodesk Fusion 360's
core loop:

1. Draw a 2D sketch with geometric and dimensional constraints.
2. Turn it into 3D (extrude, revolve, ...).
3. Keep a **history** of operations.
4. Start new sketches on **faces of the resulting solid**.
5. Edit anything earlier in the history and have everything downstream rebuild.

This is a real B-rep modeler, not a mesh toy. Correctness of the history/rebuild
engine matters more than feature count.

## Status

**M0 complete + vertical-slice spike.** The app runs: a constrained sketch drives an
extrude through OCCT in a worker. What is real vs. deliberately fake:

- Real: `slvs` adapter, constrained dragging, DOF/diagnostics, sketch→profile→extrude,
  worker protocol, three.js viewport, exact volume/face counts, e2e test.
- Fake/temporary: one hard-coded sketch (`core/sketch/demo.ts`), explicit loop order,
  static feature tree, no persistence, no undo, no picking, no history replay.

Next milestone: **M1, the real sketcher**. Read `docs/PLAN.md` before starting work.
`docs/PLAN.md` is the source of truth for what is done.

## Stack (decided)

| Concern | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript, `strict` | No `any` in `src/core` without a comment. |
| Runtime | Node from `.nvmrc` (26.x) | `nvm use` before `npm install`. |
| Build | Vite | Worker format is ESM. |
| UI | React (current stable) + Zustand | Zustand holds the document + ephemeral editor state. |
| 3D view | three.js | Not react-three-fiber; keep the scene imperative. |
| 2D solver | `slvs` (SolveSpace WASM) | npm package, install `slvs@stable`. |
| 3D kernel | `brepjs` + `occt-wasm` | OCCT compiled to WASM, runs in a Web Worker. |
| Tests | Vitest + Playwright | `npm test` / `npm run e2e`. |

**License:** `slvs` is GPLv3, so this application is GPLv3. Do not add a dependency
whose license is incompatible with that. `brepjs` is Apache-2.0, `three` is MIT.

Rationale and alternatives are in `docs/ARCHITECTURE.md` and `docs/decisions/`.

## Commands

```bash
npm run dev        # vite dev server
npm run build      # typecheck + production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # vitest run
npm run e2e        # playwright (chromium); starts its own dev server
npm run verify     # typecheck + lint + test  <-- run this before saying you're done
```

## Repo map

```
src/
  app/            React shell: layout, toolbar, panel, viewport overlay
  viewer/         three.js: scene, camera, grid, meshing, framing
  sketch/         sketch-mode UI: SVG overlay, tools, dimension labels
  core/
    doc/          (M3) document types, schema version, migrations, undo/redo
    sketch/       sketch types, slvs adapter, geometry helpers, demo model
    features/     feature evaluators (extrude today)
    rebuild/      (M3) rebuild pipeline, caching, topological references
    kernel/       brepjs worker client + protocol
  workers/
    kernel.worker.ts
  ui/             shared UI primitives (hooks)
e2e/              Playwright smoke tests
docs/
  ARCHITECTURE.md
  PLAN.md
  decisions/      ADRs, numbered
```

## Invariants (do not break these)

1. **The document is plain JSON.** No kernel objects, no WASM handles, no `Shape`
   instances, no class instances that can't be `structuredClone`d. It must survive
   `JSON.stringify` → `JSON.parse` and still rebuild identically.
2. **Never store face/edge indices, triangle indices, or OCCT hashes** as references.
   Use `TopoRef` (a role + geometric hint), resolved at rebuild time. See
   `docs/ARCHITECTURE.md#7-topological-naming`.
3. **Rebuild is deterministic.** Same document in → same solid out. No dependence on
   selection order, iteration order of `Map`, wall clock, or randomness.
4. **All OCCT work happens in the worker.** The main thread must never import the
   kernel. The UI must stay interactive while a rebuild runs.
5. **slvs entity handles are ephemeral.** They are only valid until the next
   `clearSketch()`. Never persist them; rebuild the solver input from our own model on
   every solve and throw the handles away.
6. **Sketch geometry is 2D and plane-local.** Placement lives in the sketch's plane
   frame, never in the points. No 3D coordinates in sketch entities.
7. **Millimetres, Z-up, right-handed.** Model space is Z-up (CAD convention, matches
   OCCT). Set `camera.up = (0,0,1)` and keep one convention end to end. Never convert
   units implicitly.
8. **Any document schema change bumps `schemaVersion` and adds a migration** in
   `core/doc/migrations.ts`. Old files must keep opening.
9. **A feature that fails must be visible.** Mark it errored, skip it, and tell the
   user which feature broke and why. Never silently drop geometry.
10. **Dispose kernel memory.** OCCT is manual-memory C++. Use `using` / `Symbol.dispose`,
    and never dispose a shape the kernel still owns (for example a result borrowed from a
    `csg.Evaluator` cache). A leak kills the tab.

## Conventions

- Feature/entity/constraint IDs are opaque strings (nanoid), generated at creation.
  They are stable for the life of the document. Renaming/reordering never changes them.
- All user-visible lengths in mm, angles in degrees (convert at the solver boundary).
- Pure model logic lives in `core/` and has no React or three.js imports.
- The worker protocol is a discriminated union in `core/kernel/protocol.ts`. Both
  sides import the same types.
- Prefer small, explicit functions over clever abstractions. This domain is already
  hard enough.

## Domain gotchas

- `slvs`'s API takes **entity objects**, not handles, and every unused argument slot
  must be the module's `slvs.E_NONE` object (not a hand-made `{h:0}`). Read
  `node_modules/slvs/slvs.d.ts` before calling it.
- **Bad slvs arguments abort the whole WASM instance** (`Platform::FatalError`), and that
  is not catchable. Validate entity types in the adapter before calling; be able to
  re-instantiate the module if it dies. Notably `addCircle`/`addArc` require a **3D**
  normal (`addNormal3D(g, 1, 0, 0, 0)`), not `addNormal2D`.
- **Group 0 is free reference geometry.** `Slvs_SolveSketch` only adds parameters from
  the group it solves, so entities created in group 0 are constants. Use that for the
  sketch origin / projected edges (real anchors), and for 2D circle/arc normals — a
  normal in the solved group adds 3 phantom DOF.
- `solveSketch().dof` includes **6** DOF from the base workplane's rigid-body frame.
  Subtract 6 for the sketch's in-plane DOF. Measured: empty = 6, one free point = 8,
  rectangle (h/v + anchored corner) = 8 → 2 (width + height).
- Pinning a point at an infeasible cursor position makes the system **inconsistent**, so
  drags must be retried along feasible directions. `solveDrag()` does x-only/y-only
  fallback; angled lines and circles need a real tangent-space projection (M1).
- The `slvs` npm package has no `latest` dist-tag. Use `slvs@stable`.
- The solver chunk is ~8 MB (~1.6 MB gzip) because the WASM is inlined. It is lazy-loaded
  by `core/sketch/solver.ts`; never import it from the entry chunk.
- OCCT **silently returns the wrong solid** when a hole crosses the outer boundary (it
  keeps the hole's cylinder). Validate profiles in the worker before building.
- Fillets are the most fragile OCCT operation. Always handle failure as a normal result.
- Curved faces are **not** valid sketch supports in v1 (planar faces only). Say so in
  the UI instead of failing weirdly.
- The kernel is a worker: send typed arrays with `transfer`, and never send a `Shape`.

## Working style

- One milestone task at a time. Keep changes reviewable.
- Add a test with every behaviour change in `core/`. Kernel tests assert numbers
  (volume, bbox, face count), not snapshots.
- If you change a design decision, update `docs/ARCHITECTURE.md` and add an ADR.
- Update the checkbox list in `docs/PLAN.md` as tasks land.
- Ask before adding a dependency over ~100 kB, a second kernel, or a second solver.
