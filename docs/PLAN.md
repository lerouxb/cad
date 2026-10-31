# Plan

## Strategy

Ship a **vertical slice** early: one sketch → one extrude → orbit the solid. That proves
the whole pipeline (solver → profiles → kernel → worker → renderer) and exposes the
integration problems while the codebase is still small. Depth comes after that: history,
then sketches on faces, then more features.

---

## Where we are (2026-10-25)

**M0 and the M1 core are done.** The app is an editable parametric sketcher:

- `slvs` loads lazily and solves real sketches. Dragging projects the cursor delta onto
  the constraint tangent space, so points slide along lines and circles instead of the
  drag being rejected.
- Draw with line (chain, closes on first point), rectangle (drag), and circle
  (centre + radius). Grid and point snapping; automatic horizontal/vertical constraints;
  coincident endpoints come from shared points.
- Closed profiles are extracted from the graph: the largest region (a line loop or a
  circle) becomes the body, nested loops/circles become holes. Extruded by OCCT in a
  worker; three.js renders the solid and its B-rep edges, Z-up.
- Undo/redo with gesture grouping (`Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`); one drag or slider
  gesture is one step. `Esc` cancels a draft and clears the selection.
- Click curves/points to select them, Shift-click to multi-select, and Delete/Backspace to
  remove. Deletion cascades to dependent curves and constraints, and leaves no orphaned
  references. A selection card reports length/diameter/position.
- The example sketch can be loaded, cleared, edited, or replaced by drawing.
- `npm run verify` (31 unit tests) and `npm run e2e` are green. The e2e asserts exact
  volumes, drags, dimensions, draws, selects/deletes, and undoes.

Numbers from the running app: a drawn 115×75×12 plate with a Ø30 hole is
95 017.7 mm³ and rebuilds in ~35 ms after warm-up.

**Still temporary** (all scheduled below): profile selection is "largest loop"; line
loops cannot be holes; dimensions exist only on the example and are edited with sliders;
there is no dimension or constraint tool yet; the feature tree is static; nothing is
persisted.

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

## M1 — The real sketcher (core done)

The most UX-sensitive milestone. The solver plumbing, the drawing loop, selection,
dimensions and the common constraints work; what is left is refinement.

- [x] Tools: line (chain), rectangle, circle; select mode; grid + point snapping;
      automatic coincident endpoints (shared points) and horizontal/vertical constraints
- [x] **Drag projection**: cursor delta projected onto the constraint tangent space
      (analytic Jacobian + weighted Kaczmarz), so points slide along circles and angled
      lines. A fully constrained sketch refuses to move.
- [x] Undo/redo with gesture grouping; DOF readout and fully-constrained colouring;
      conflict display
- [x] Sketch origin as a group-0 fixed entity; construction geometry
- [x] Zoom (wheel), pan (middle/right, or select-drag on empty space), double-click fit
- [x] Drag primitives: points, whole lines (both endpoints), circles (grab offset, radius
      fixed); 3 px threshold so a click does not nudge them
- [x] Keyboard: `V/L/R/C`, `Esc`, `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`
- [x] **Selection + deletion**: click curves/points, delete, multi-select, then entity
      property panel. Selection is ephemeral UI state; deletion is a pure sketch edit in
      `core/sketch/edit.ts` and is covered by unit + e2e tests.
- [x] **Dimension tool**: click two points, a line, or a circle → place the dimension;
      inline edit and delete; driving vs reference. The example's sliders now drive real
      dimensions, not special-cased annotations.
- [ ] Reposition an existing dimension label (placement currently happens at creation)
- [ ] Angular and point-to-line dimensions; radius (not just diameter)
- [x] **Constraint bar**: parallel, perpendicular, equal, point-on-line, coincident,
      horizontal/vertical, plus construction geometry, applied from the floating selection
      card and shown as badges
- [ ] Angle, tangent and symmetric constraints; radius (as opposed to diameter)
- [ ] Endpoint *coincident constraints* for points that are near but not identical
      (currently only shared points)
- [ ] Arc tool (three-point + tangent), plus arc loops in profile extraction
- [ ] `core/doc`: feature/document schema, ids, migrations — before history lands
- [ ] Move the sketch out of component state into the document store

**Done when:** you can draw a rectangle from scratch, dimension it with real dimension
annotations, drag it, see it become fully constrained, delete an entity, then undo
everything back to empty. (All of that works today except creating the remaining
constraint types via UI, and the conflict state is only reachable through inconsistent
edits, not through a "break this constraint" interaction.)

## M2 — Profiles and solids (the spike covers ~70%)

- [x] Worker client + protocol, init handshake, latest-wins rebuilds
- [x] Extrude evaluator: polygon/circle loops → wire → face → solid, with validation
- [x] Tessellation via `toBufferGeometryData` / `meshEdges`, transferred to the main thread
- [x] Shaded solid + dark B-rep edges, Z-up, auto-framing
- [x] `core/sketch/loops.ts`: graph → simple cycles → largest region (line loop or
      circle) → nested loops and circles as holes, with tests
- [ ] Region picking in the sketch UI (click an enclosed area). A **region** is a face of
      the sketch: an outer loop plus the holes directly inside it. Build the containment
      tree, treat even depth as solid and odd depth as holes, and let the user pick one or
      more. Highlight the picked regions and preview the extrude.
- [ ] `regionId = hash(sorted curve ids)` so a selection survives edits and can be stored
      in a feature (same idea as `TopoRef`, one level down). A region that disappears marks
      the feature as errored instead of silently changing the profile.
- [ ] Multiple regions per extrude (Fusion extrudes each selected profile), and prepare for
      one sketch feeding several features in M3.
- [ ] Deeper nesting (islands inside holes); currently one level
- [ ] Replace cycle enumeration with planar face traversal (intersecting segments, nested
      loops, disjoint regions)
- [ ] Rebuild goldens: several profiles → volume/bbox/face-count assertions
- [ ] Face/edge picking + hover/selection highlight (`faceGroups`/`edgeGroups` are already
      in the mesh payload but unused)

**Done when:** an arbitrary multi-region sketch can be extruded, with holes, without the
"largest region" rule.

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
