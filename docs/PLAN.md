# Plan

## Strategy

Ship a **vertical slice** early: one sketch → one extrude → orbit the solid. That proves
the whole pipeline (solver → profiles → kernel → worker → renderer) and exposes the
integration problems while the codebase is still small. Depth comes after that: history,
then sketches on faces, then more features.

---

## Where we are (2026-10-25)

**M0 + the vertical slice are done.** The app runs a real, if narrow, pipeline:

- `slvs` loads lazily and solves the built-in sketch; dragging, DOF and diagnostics work.
- The solved profile (rectangle + exact circular hole) is extruded by OCCT in a worker.
- three.js renders the tessellated solid and its B-rep edges, Z-up.
- The e2e test asserts the *exact* volume, then drives a dimension and the extrude height
  and asserts the new volumes. `npm run verify` and `npm run e2e` are green.

Numbers from the running app: ~520 triangles, 7 faces, 26 387.3 mm³ for a 60×40×12 plate
with a Ø16 hole; ~47 ms rebuild round-trip after warm-up.

**Deliberately fake in the spike** (all scheduled below): the sketch is hard-coded
(`core/sketch/demo.ts`), the profile loop order is explicit, the feature tree is static,
there is no persistence or undo, no picking, and drags only follow axis-aligned
constraints.

---

## Done: M0 — Skeleton

- [x] Vite + React + TS (`strict`, `noUncheckedIndexedAccess`), ESLint, Prettier
- [x] Vitest + one real test suite; Playwright e2e with a web server
- [x] Folder structure from `AGENTS.md`
- [x] App shell: toolbar, sketch panel, viewport, viewport overlays
- [x] three.js viewport: Z-up camera, orbit/pan/zoom, grid, axes, framing
- [x] `npm run verify` green; GitHub Actions for verify + e2e
- [x] GPL-3.0 LICENSE, `.nvmrc`, first commit

## Done: spikes

- [x] **Solver A**: `slvs` in the browser, constrained rectangle + hole, drag at pointer
      rate. Findings: group 0 = fixed reference geometry, `dof - 6`, normals must be in
      group 0, infeasible drags are `INCONSISTENT`.
- [x] **Kernel B**: `brepjs`/`occt-wasm` in a worker, extrude with a hole, transferred
      typed arrays, exact volume. Findings: use `wireLoop` → `face` → `extrude`; validate
      holes that cross the boundary (OCCT silently returns the hole cylinder).
- [x] Wire it together: sketch edit → debounced rebuild → 3D update, with stats on screen.

---

## M1 — The real sketcher (6–9 days)

The most UX-sensitive milestone, and the biggest. The spike has the solver plumbing; this
milestone turns it into a tool.

- [ ] `core/doc`: document + feature types, commands, immutable updates, undo/redo
- [ ] Move sketch state into the document; node/feature ids; a real sketch feature
- [ ] Tools: line, polyline, rectangle, circle, arc, select, delete, construction toggle
- [ ] Auto-constraints while drawing: coincident endpoints, horizontal/vertical snap,
      tangent continuation, point snapping, grid snap
- [ ] Constraints UI: coincident, horizontal, vertical, parallel, perpendicular, tangent,
      equal, distance, radius/diameter, angle, point-on-line, symmetric, midpoint
- [ ] Dimension labels: draggable placement, inline editing, driving vs reference
- [ ] **Drag projection**: project the cursor delta onto the constraint tangent space
      (numeric Jacobian null space). Required for circles and angled lines; the axis-only
      fallback in `solveDrag` is not enough. This is the main solver task of M1.
- [ ] DOF readout, fully-constrained colouring, conflicting/redundant constraint highlights
- [ ] Sketch origin + projected reference geometry as group-0 fixed entities
- [ ] Zoom/fit affordances, snapping feedback, keyboard shortcuts

**Done when:** you can draw a rectangle from scratch, dimension it, drag it, see it become
fully constrained, break a constraint and see the exact conflict highlighted, then undo
everything back to empty — without touching the demo model.

## M2 — Profiles and solids (the spike covers ~70%)

- [x] Worker client + protocol, init handshake, latest-wins rebuilds
- [x] Extrude evaluator: polygon/circle loops → wire → face → solid, with validation
- [x] Tessellation via `toBufferGeometryData` / `meshEdges`, transferred to the main thread
- [x] Shaded solid + dark B-rep edges, Z-up, auto-framing
- [ ] `core/sketch/loop.ts`: planar graph → minimal cycles → nesting (outer + holes) with
      property tests; replaces the explicit demo loop
- [ ] Region picking in the sketch UI (click an enclosed area; `isInside2D`-style test)
- [ ] Multiple regions per sketch; holes derived from nesting, not from a magic id
- [ ] Rebuild goldens: several profiles → volume/bbox/face-count assertions
- [ ] Face/edge picking + hover/selection highlight (`faceGroups`/`edgeGroups` are already
      in the mesh payload but unused)

**Done when:** an arbitrary multi-loop sketch can be extruded without hard-coded ids.

## M3 — History (4–6 days)

- [ ] `core/rebuild`: ordered evaluation, per-feature status, prefix cache, generation
      counters, cancellation of stale results
- [ ] Feature tree UI: select, rename, reorder (drag), suppress, delete
- [ ] Feature edit dialogs (extrude distance/symmetric/operation)
- [ ] Rebuild-on-edit with stale-while-rebuilding rendering
- [ ] Error states in the tree with clickable diagnostics
- [ ] Persistence: autosave to localStorage, `.cad.json` export/import, migrations
- [ ] Cut/join extrudes; a second feature on the same body
- [ ] First `TopoRef` plumbing: `assignRoles` on feature outputs, `captureHint` /
      `createRef` for selections, `updateRoles` on evolution records; refs stored as JSON
- [ ] Rebuild test: edit sketch 1, assert feature 2's volume changes and nothing else did

**Done when:** a two-feature part survives an edit to the first sketch, save/reload, and
undo/redo — with correct geometry every time.

## M4 — Sketches on faces (5–7 days)

- [ ] Face → `TopoRef` on selection; `PlaneRef.kind = "face"`
- [ ] Deterministic face frame (origin, x-axis) + cached frame fallback
- [ ] Sketch on a planar face of a solid; camera aligns to the face normal
- [ ] Project the supporting face's boundary into the sketch as fixed construction
      geometry (`drawFaceOutline`); project arbitrary edges (`drawProjection`)
- [ ] `resolveRef` on rebuild: exact → fallback → lost-ref error with "reselect"
- [ ] Handle flipped face normals and sketches created on the "back" of a face
- [ ] Topological-naming regression test: change base height, boss on top face follows
- [ ] UI: unsupported (curved) face → clear explanation, no broken state

**Done when:** extrude a plate, sketch on its top face, extrude a boss, edit the plate
height in history, and the boss stays on top and keeps its constraints.

## M5 — Refinement features (4–5 days)

- [ ] Fillet (constant radius) on selected edges, with failure handling
      (`filletWithEvolution` so downstream refs survive)
- [ ] Chamfer
- [ ] Shell (open faces) — maybe defer
- [ ] Selection UX: edge chain selection, box select where sensible, hover prehighlight
- [ ] Measure tool (distance, angle, radius) — small, high value
- [ ] Export STL + STEP from the worker

**Done when:** you can fillet the four vertical edges of a plate, then change the plate
size and the fillets survive.

## M6 — More shape (1–2 weeks, can reorder)

- [ ] Revolve
- [ ] Loft / sweep (profile + path)
- [ ] Linear and circular patterns
- [ ] Mirror (feature and body)
- [ ] Multi-region extrude (multiple disjoint profiles, holes)
- [ ] Construction geometry + reference planes/axes

## M7 — Parameters (3–4 days)

- [ ] Named parameters with units; `Expr` evaluation + dependency ordering
- [ ] Expression editing on every dimension field
- [ ] Parameter table UI, rename with reference updates
- [ ] Cycle detection with a clear error

## M8 — Later / maybe never

Assemblies and joints, drawings, STEP import, curved-face sketches, sheet metal,
collaboration, plugin API.

---

## Sequencing notes

- Do M3's `TopoRef` plumbing **before** M4 gets deep. Retrofitting stable references
  after features already store indices is painful.
- M5's fillet is a good forcing function for the error/diagnostics model.
- Keep a `fixtures/` set of documents per milestone and run them in tests. Every bug
  report becomes a fixture.
- The spike's `core/kernel/protocol.ts` is the contract between the UI and the kernel;
  evolve it deliberately, because the worker boundary is where debugging gets hard.

## Risks

| Risk | Mitigation |
| --- | --- |
| `brepjs` is young and its API may churn | Pin the version; keep the kernel adapter thin; keep `replicad` as the fallback (ADR-0001) |
| Topological naming edge cases | Use `shapeRef` from day one; design the "selection lost" recovery UI; heavy tests |
| Rebuild latency | Prefix cache, debounce, one rebuild at a time, generation-based cancellation |
| OCCT memory leaks | Disposal discipline (`withScope`) + a stress test that rebuilds 500× and checks memory |
| Sketcher UX takes longer than expected | It always does. Budget 1.5×; the drag projection alone is a day or two |
| WASM bundle size (8 MB + 21 MB) | Lazy-load both after first paint; gzip/brotli; loading state |
| GPLv3 obligations | Publish source; include the license and a link to it in the app's About box |

## Definition of done (every milestone)

1. `npm run verify` and `npm run e2e` pass.
2. New behaviour has tests (numeric assertions for geometry).
3. Works after reload (persisted document rebuilds identically), once persistence exists.
4. No new `any`, no kernel imports outside `core/kernel`, no OCCT calls on the main thread.
5. `docs/PLAN.md` checkboxes updated; new decisions recorded as ADRs.
