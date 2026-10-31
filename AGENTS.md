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

**M1 is done and M2 region selection is in.** The app is an editable sketcher driving an exact extrude:

- Real: `slvs` adapter, tangent-space constrained dragging of points, whole lines, circles
  and arcs, line/rectangle/circle/three-point-arc tools and a parametric corner fillet,
  grid + point snapping, automatic horizontal/vertical constraints, exact profile
  extraction (line/arc loops or circles as the body, nested loops/circles as holes;
  arcs extrude as OCCT arc edges, not tessellated), click/shift-click selection,
  cascading delete, explicit region selection (click a filled region, Shift adds, All/Auto;
  multiple selected regions are extruded and fused), dimensions (point-point, point-line,
  angle, diameter, radius, driving or reference, inline edit/delete and draggable labels),
  a floating constraint bar
  (horizontal/vertical, parallel, perpendicular, equal, point-on-line, point-on-circle,
  tangent, symmetric, midpoint, coincident, fix) with construction geometry, a selectable
  fixed origin + X/Y axis reference frame, exact X/Y editing for a selected point,
  undo/redo, DOF/diagnostics, worker protocol, three.js viewport, exact volume/face counts,
  unit + e2e tests.
- UI: one main stage. The bottom timeline switches between the full-stage sketch editor
  and the 3D model; the sketch has floating tools, a DOF pill, and a floating selection /
  dimension inspector. No permanent sidebar.
- Temporary: auto mode still defaults to the largest region until a region is clicked;
  intersecting segments are not split into faces; face/edge picking is not implemented;
  the example sketch is hand-authored (`core/sketch/demo.ts`); **datum planes and
  sketch-on-face are not implemented (M4)**; the feature tree is static; nothing is
  persisted. Free 3D sketches, splines/text/images and drawing exports are out of scope.

Next: **finish M2** (split at intersections, face/edge picking), **M3** (document schema +
history), then **M4** (datum planes + face supports). Read `docs/PLAN.md`; it is the
source of truth for done.

**E2E**: tests reuse one worker-scoped page per worker and reset the app through its UI;
do not add `page.goto()` per test. The WASM stays warm, which takes the suite from ~1 min
to ~30 s locally (2 workers; 1 in CI). Reset modes, the demo and the height slider in the
shared `beforeEach`; if state leaks between tests, extend that reset.

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
    doc/          (M3) document types, schema version, migrations
    sketch/       types, slvs adapter, drag projection, create/edit, dimensions,
                  loop extraction
    features/     feature evaluators (extrude today)
    rebuild/      (M3) rebuild pipeline, caching, topological references
    kernel/       brepjs worker client + protocol
  workers/
    kernel.worker.ts
  ui/             useElementSize, useHistory (snapshot undo/redo)
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
- Pure model logic lives in `core/` and has no React or three.js imports. Drawing
  operations are pure functions in `core/sketch/create.ts`; the canvas only reports
  gestures.
- All sketch mutations go through `useHistory` (`ui/useHistory.ts`). One gesture = one
  undo entry: pass a `mergeKey` while dragging a point or slider and call `endMerge()`
  on pointer-up. Never push one entry per pointer-move.
- **Selection is ephemeral UI state, never document state.** It is not undoable, not
  persisted, and is cleared on tool change, Escape, and delete. Selection ids are checked
  against the current sketch before use (undo can remove them).
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
- **Reference dimensions are annotations.** `driving: false` must be skipped by the
  solver *and* by the drag Jacobian (`core/sketch/drag.ts`); otherwise a reference
  measurement silently constrains the geometry or lies about the DOF. Every new
  constraint type needs a residual/gradient there.
- Line drags pass **both endpoints as targets** (`solveDragTargets`); the projection may
  turn a translation into a stretch. A line/circle drag waits for a 3 px movement before
  applying, so click and shift-click do not nudge geometry. The origin marker must stay
  `pointerEvents="none"` — it is drawn above the curve hit targets and otherwise eats the
  grab.
- Dimension labels stop `pointerdown` propagation. Without that the SVG's pan handler
  captures the pointer on press and the label never receives a `dblclick`; this is subtle
  and easy to regress. Label dragging only captures the pointer after a 3 px movement, for
  the same reason.
- **Arcs are CCW from `start` to `end` around a group-0 +Z normal.** `addArc` flips the
  endpoints so the clicked through-point lies on that sweep; there is no `clockwise`
  flag. The solver's arc entity enforces equal radius, and the drag projection adds the
  same first-order row. Arc radii are derived from centre + start, not stored on the curve.
- **`slvs` tangency is only arc↔line sharing an endpoint** (and cubic↔line). Use
  `addConstraint(C_ARC_LINE_TANGENT, …, arc, line, …, other)` — `s.tangent()` aborts the
  WASM instance when its endpoint-equality check fails. `other` is true when the shared
  endpoint is `arc.end`.
- **Angle dimension values are degrees** in the `slvs` API. `C_SYMMETRIC_LINE` takes the
  two points in `ptA`/`ptB` and the axis line in `entityA`; the npm helper has a different
  signature from its `.d.ts`.
- The fillet creates two new tangent points that are shared by the arc and the two lines,
  then adds tangent constraints and a driving **diameter** dimension. If no other curve
  uses the old corner, it is removed. If another curve, dimension or anchor still uses it
  (the demo's construction diagonal and origin coincidence), the point is kept at the
  sharp intersection as a **construction point** and constrained with point-on-line to
  both trimmed lines. The diagonal and the origin coincidence stay exactly where they
  were; the boundary uses the arc. The old corner is marked construction when every
  remaining curve that uses it is construction. Constraints that referred to the
  pre-trim segments are replaced; all other constraints, including Fix and fixed-point
  coincidences, are preserved.
- `ProfileLoop.kind = "path"` carries exact line/arc segments plus a sampled polygon for
  containment/validation. The kernel assembles `threePointArc` edges; the sampled points
  are never used to extrude. `ensureCounterClockwise` must reverse the segments, not just
  the points.
- **Regions are faces, not every cycle.** `regionsFromSketch` drops a cycle when a smaller
  cycle sharing one of its curves sits inside it (rectangle + diagonal → two triangles),
  then builds a containment tree: even depth is material, odd depth is a hole. Region ids
  hash the outer + direct-hole curve ids. `profileFromSketch` is the legacy "largest loop"
  helper used by old tests; the app uses regions.
- **`ExtrudeParams` is `{ regions, height }`**, not one outer + holes. The worker extrudes
  each region and `fuseAll`s multiple solids. Region fills use `data-region-id` and
  `data-region-bounds` (the latter replaces the old outer polygon for e2e bounds).
- **Reference geometry is separate from user geometry.** `Sketch.references` holds the
  fixed origin and the X/Y axes; they are not in `sketch.points/curves`, so profiles,
  point indices and deletion stay clean. Use `allPoints(sketch)` / `allCurves(sketch)`
  whenever code may need to resolve an id that can be the origin or an axis. The solver
  adds reference points as group-0 anchors and reference lines with fixed endpoints; they
  contribute no DOF.
- Reference axes use `data-reference-id`, not `data-geometry-id`, so e2e geometry
  locators do not count them. The origin hit target sits above the axes but below user
  geometry, so grabbing a curve/point at (0,0) still wins; select the origin where no user
  geometry overlaps it.
- The point coordinate editor calls `solveDrag` with the typed X/Y, exactly like dropping
  the cursor there. An unconstrained point moves exactly; a constrained point projects
  onto its feasible set; a fully constrained point returns `null` and stays put.
- Every new constraint type also needs a row in `core/sketch/drag.ts`: arc equal-radius,
  point-on-circle, point-line distance, angle, tangent, symmetric, and fixed points (which
  are omitted from the parameter vector). If it is missing, the solver still cleans up,
  but the drag visibly fights the constraint.
- **Never pin the dragged point at the cursor.** Any off-manifold target (a circle, an
  angled line) makes the constraint system `INCONSISTENT`. `solveDrag()` instead projects
  the cursor delta onto the constraint tangent space (`core/sketch/drag.ts`), applies it
  to all points, and lets the solver clean up the second-order error. A fully constrained
  sketch legitimately returns `null` (no movement).
- Profile extraction is currently "the largest closed region" where a region is a line
  loop **or** a circle. Every other closed region strictly inside it becomes a hole,
  except loops that share edges with the outer (those are subdivisions, not holes).
  Construction geometry is excluded. One nesting level only (an island inside a hole is
  ignored). Two disjoint loops → the larger wins. Explicit region selection is M2; do not
  pretend this is general.
- The kernel validates hole clearances. A hole that crosses the boundary is reported as an
  error (and the last good mesh stays visible), not silently dropped.
- Build faces with `addHoles(face(outer), holes)`, **not** `face(outer, holes)`. The
  latter silently returns the wrong solid when a circular outer has a line-loop hole.
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
