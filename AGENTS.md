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

**M2 is complete, including region/void selection, paper/ink UI, split/trim, and 3D
face/edge picking. M3's document store and ordered rebuild are in progress.** The app is
an editable sketcher driving an exact extrude:

- Real: `slvs` adapter, tangent-space constrained dragging of points, whole lines, circles
  and arcs, line/point/rectangle/circle/three-point-arc tools and a parametric corner
  fillet,
  grid + point snapping, automatic horizontal/vertical constraints, exact profile
  extraction (line/arc loops or circles as the body, nested loops/circles as holes;
  arcs extrude as OCCT arc edges, not tessellated), click/shift-click selection,
  cascading delete, a non-destructive planar arrangement for profile faces (crossings and
  T-junctions split into real regions), trim by clicking a line/arc segment with undo,
  explicit region selection (click a filled region or a hole, Shift adds, All/Voids/Auto;
  multiple selected regions are extruded and fused), 3D face/edge picking with hover and
  selection highlights, dimensions (point-point, point-line,
  angle, diameter, radius, driving or reference, inline edit/delete and draggable labels),
  a floating constraint bar
  (horizontal/vertical, parallel, perpendicular, equal, point-on-line, point-on-circle,
  tangent, symmetric, midpoint, coincident, fix) with construction geometry, a selectable
  fixed origin + X/Y axis reference frame, exact X/Y editing for a selected point,
  undo/redo, DOF/diagnostics, worker protocol, three.js viewport, exact volume/face counts,
  unit + e2e tests. The part is a plain-JSON `Doc` with sketch/extrude features,
  schemaVersion + migrations, autosave to `localStorage`, and undoable feature parameters
  (extrude height and selected regions). The main-thread rebuild walks the feature list
  in order with a prefix cache and per-feature diagnostics. The worker receives the
  successful extrudes, caches prefix solids by cache key, and applies new/join/cut
  booleans with per-feature build statuses.
- UI: one main stage. The bottom timeline switches between the full-stage sketch editor
  and the 3D model. The shell follows the studies: a document header (filename,
  appearance), one stage status line (solver/kernel health, DOF, body stats, view
  controls), numbered timeline steps with a selected-step summary line, a draggable
  feature popover for parameters, a text tool line
  in sketch mode and a contextual selection popover. No permanent sidebar. The paper/ink
  theme has day/night modes and one highlighter colour (yellow/pink/blue/green), persisted
  in `localStorage`; the static studies in `docs/mockups/` are illustrative and are never
  imported, while their index/notes prose is the design contract in `docs/PLAN.md`.
- Temporary: existing extrudes with an empty region list still resolve to the largest
  material region (legacy documents); new extrude drafts require an explicit profile.
  Trim supports lines and arcs but not turning a circle into an arc; body
  selection starts a sketch on a planar face when `+ sketch` is used, and the
  supporting boundary is projected live as fixed dashed references. Offset and
  midplane datum features are in, with a support picker, 3D preview and ray-picking;
  face-backed datums follow source body edits, lost face support is visible with
  reselect/revert, face sketches can flip sides while keeping that side stable, and the
  support picker previews the chosen plane on a dimmed body. M4's core flow is in; only
  support-list detail copy and through-3-point planes remain. The example part is
  hand-authored (`core/sketch/demo.ts` + `core/doc/example.ts`, including a suppressed
  center-pin extrude from the same sketch and a suppressed mounting-holes cut); the
  timeline now lists the real feature history with select,
  inline rename, create, edit, drag-reorder, suppress, delete-cascade, rollback and
  per-feature status/diagnostics. `.cad` download/open/rename/new, blind/symmetric/
  through-all extrudes, a local file list with copy/delete/open/download/rename/new, and
  JSON-safe TopoRefs on face picks are in. Role tables now survive joins/cuts via
  `updateRoles`. Free 3D sketches, splines/text/images and drawing exports are out of
  scope.

Next: **M5** (or M4's remaining support-list detail copy first): fillet/chamfer/shell,
Offset Faces, selection filters, section analysis and export; through-3-point planes wait
for M6 datum axes/points. Then **M6.0** (re-editable sketch
pattern/mirror/offset, ADR-0004). Read `docs/PLAN.md`; it is the source of truth
for done. Unsupported geometry/features (ellipses, conics, B-splines, free
3D sketches, 3D fillets, lofts/sweeps, patterns/mirror, drafts, shelling/offsets,
expressions, threads) and the upstream SolveSpace/OCCT work are documented in **PLAN M9**.
Scripted features (editable code behind a sketch/feature) and the command/AI layer are
planned in **M8.5 / ADR-0005**.

**E2E**: tests reuse one worker-scoped page per worker and reset the app through its UI;
do not add `page.goto()` per test. The WASM stays warm, which takes the suite from ~1 min
to ~30 s locally (2 workers; 1 in CI). Reset modes, the demo and the height slider in the
shared `beforeEach`; if state leaks between tests, extend that reset. That reset now
includes day mode and the yellow highlighter (both persist in `localStorage`), plus the
sketch grid step (auto), snap on, and zoom fit, since those are ephemeral view controls.
The shared-page reset leaks are what made the crossing-diagonals test flaky: a previous
test left snap off, so the diagonals no longer snapped to the rectangle corners.

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
npm run check:typography  # typography token audit (mockups + src/app/app.css)
npm test           # vitest run
npm run e2e        # playwright (chromium); starts its own dev server
npm run verify     # typecheck + lint + typography audit + test  <-- run this before saying you're done
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
  applying, so click and shift-click do not nudge geometry. A slightly-off grab near a
  free line endpoint still drags that endpoint (within 2.2× the point hit radius);
  otherwise it starts a whole-line translation and both points appear to move together.
  The drag projection also re-pins points with no constraint path to the dragged point:
  SolveSpace drifts unrelated free variables while converging, so a point on one
  projected edge would otherwise creep when dragging a point on another edge. The origin
  marker must stay
  `pointerEvents="none"` — it is drawn above the curve hit targets and otherwise eats the
  grab.
- Dimension labels stop `pointerdown` propagation. Without that the SVG's pan handler
  captures the pointer on press and the label never receives a `dblclick`; this is subtle
  and easy to regress. Label dragging only captures the pointer after a 3 px movement, for
  the same reason. Dimension groups use a `grab` cursor and a `<title>` because the
  labels are draggable; don't change that to `text` without keeping the affordance.
- **Finishing a sketch line:** Enter commits an open polyline with at least two points;
  double-click also commits; Escape cancels. The Enter listener lives in `SketchCanvas`
  because the draft is canvas-local. Touchpad pinch is `ctrl+wheel` with small deltas;
  the SVG zoom clamps that case separately from a mouse wheel.
- The fixed origin/reference points are included in the arrangement's position map: a
  user can start a line or centre a circle on the origin, and the graph must still
  connect it. Circle centres that are reference points still get synthetic arc nodes.
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
- **The document is the source of truth.** `Doc` holds only plain JSON: schemaVersion,
  id/name, and typed `SketchFeature` / `ExtrudeFeature` records. Solver output is derived
  UI state, never persisted. `core/doc/migrations.ts` migrates on load and rejects
  malformed or newer documents; `core/doc/persistence.ts` autosaves under `cad.doc`.
  `primarySketch` / `primaryExtrudeFeature` / `updatePrimarySketch` are the selectors
  App uses so component state does not become a second document.
- **Rebuild is ordered, cached and explicit.** `core/rebuild` walks `doc.features` in
  order. `cacheKey = hash(canonical(feature), upstreamKey)`, so a height/region edit reuses
  the solved sketch and a sketch edit invalidates the extrude. Every feature returns
  `status` + diagnostics; App extracts the successful extrudes and sends them to the
  worker. The cache is bounded and in-memory. `selectExtrudeRegions` is shared by App and
  the engine so the auto/largest material fallback cannot drift.
- **The worker builds an ordered single body.** `KernelFeature[]` carries each extrude's
  cacheKey, params and operation. The worker caches the prefix solid per cacheKey, applies
  new/join/cut, and returns `FeatureBuildStatus[]`. A failed feature is skipped and later
  features use the last good base; a failed first feature returns an error with statuses.
  The first feature may be new or join; cut needs a base; new after a base is an error.
  Any worker feature error clears the prefix cache after the last-good mesh is produced,
  so a later successful retry cannot reuse downstream solids built past a skipped feature.
- **Worker solids are cloned out of their disposal scope.** `buildSolid` uses
  `withScope` for wires/faces/originals and returns `clone(solid)`; the cache owns those
  clones and disposes them on eviction. Do not return a scoped handle.
- **Cached solids and mesh buffers:** call `clearMeshCache()` before meshing a cached
  solid. A previous request transferred the mesh's ArrayBuffers, which detaches them;
  re-meshing the same cached solid without clearing the mesh cache throws "detached
  ArrayBuffer" on postMessage. This showed up as a volume that did not update after undo.
- **Body picking is group-based and ephemeral.** `faceGroups` carry index ranges plus
  `faceId`/`origin`; `edgeGroups` carry `edgeId` ranges. `src/viewer/picking.ts` maps a
  triangle index to a face group and a LineSegments vertex index to an edge group.
  `edgeGroups` may be segment- or vertex-indexed depending on the kernel build; call
  `edgeUnitForMesh`. Edges win only when their ray hit is not behind the face, so hidden
  back edges cannot steal a face click. Hover and selected overlays are separate groups;
  `BodyPick` is UI state, never `Doc`, and is cleared on mesh rebuild and Escape. e2e
  picking coordinates rely on Fit view; call it before hovering.
- **`BodyStats.bounds` is tessellation bounds.** It is exact for axis-aligned planar
  profiles but curved meshes sample inside the true circle; round golden comparisons.
- **Regions are faces, not every cycle.** `planarArrangement` splits line/arc segments at
  crossings, T-junctions and circle crossings without touching the document. A circle with
  at least two contacts is replaced by arc segments around the same centre (so a chord
  through a hole becomes two half-disks); an untouched circle stays a whole circle
  candidate. `findLoops` is a **half-edge walk** over the split graph: it keeps bounded
  CCW faces and discards the unbounded CW face. Do not reintroduce simple-cycle
  enumeration or the old "smaller cycle sharing a curve means subdivision" filter — that
  dropped real material faces when a line cut a hole (see the
  `circle-through-hole.cad.json` regression). A containment tree is only needed for
  disconnected nested loops/circles. **Every depth is a selectable profile**: even depth
  is material, odd depth is the negative space of its parent, and each region's direct
  children are its holes. A circle inside a rectangle is therefore both the rectangle's
  hole and a disk-shaped void profile. Auto falls back to the largest *material* region;
  **All** selects material regions, **Voids** selects the negative-space profiles, and
  clicking inside a hole selects it. Region ids hash the outer + direct-hole curve ids; a
  split piece gets `${sourceId}~${index}`. Void fills are transparent until selected;
  `data-region-kind` exposes the parity for tests.
  `profileFromSketch` is the legacy "largest loop" helper used by old tests; the app uses
  regions.
- **Trim materializes only the cuts it keeps.** `trimCurveAt` uses the arrangement to pick
  the clicked piece, creates real points at the kept boundaries, replaces the source curve
  with the kept pieces, and remaps constraints. Two kept line pieces get a parallel
  constraint (collinearity); two kept arcs get point-on-circle links from the second
  piece to the first so the radii stay equal. A constraint that cannot be carried over is
  removed explicitly and reported in the trim status line.
- `pruneSketch` removes orphaned points/constraints after structural edits. Both
  `deleteEntities` and `pruneSketch` must keep `pointOnLine`; missing that case silently
  drops valid constraints.
- Reference axes intercept clicks along x = 0 / y = 0 before region fills; e2e region
  clicks must be off-axis.
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
- **Standalone points are real solver geometry, not reference geometry.**
  `SketchPoint.standalone` (schema v2) is set by the point tool so `deleteEntities` and
  `pruneSketch` keep a point that no curve uses. They are normal points (selectable,
  draggable, constrainable, dimensionable, hollow-styled) and are ignored by
  `regionsFromSketch`. Do not mark them `fixed` or `construction`: both are hidden from
  selection/snapping. Clicking an existing point with the point tool must not stack a
  duplicate.
- The point coordinate editor calls `solveDrag` with the typed X/Y, exactly like dropping
  the cursor there. An unconstrained point moves exactly; a constrained point projects
  onto its feasible set; a fully constrained point returns `null` and stays put.
- **The sketch grid is adaptive and the snap grid.** `core/sketch/grid.ts` picks a
  1/2/5 × 10ⁿ step so minor cells stay roughly 16–40 px; the stage-foot input overrides
  it with any mm value and `auto` restores it. Snap is independent of grid visibility.
  Do not reintroduce a fixed 10 mm grid.
- **Feature forms live in the draggable popover, not the timeline.** `FeaturePopover`
  holds the extrude sketch picker, height, direction, operation and end; the timeline
  detail is a summary plus actions (`extrude`, edit, rename, select profiles, open sketch,
  roll back, suppress, delete). The popover footer is a summary + quiet `cancel` + primary
  `apply`; editing reopens the same controls and `cancel` restores the feature as it was
  when the popover opened. A **new extrude is a UI-only draft** (`extrudeDraft`) started
  from the selected sketch step: it is not written to the document and its `extrude`
  primary stays disabled until at least one profile is picked. The draft's own test ids
  are `extrude-draft-popover`, `extrude-apply` and `extrude-cancel`; existing features
  keep `feature-popover-apply` / `...-cancel`.
- **Creation is contextual, never a header default.** `+ sketch` at the end of the
  timeline opens `SupportPopover`; it shows the support explicitly (world XY/XZ/YZ,
  planar faces and existing datum planes) and the primary is `new-sketch`.
  `+ plane` opens the datum-plane draft popover. `new-extrude` lives on the selected
  sketch step. There is no header New Sketch/New Extrude button and no implicit XY or
  first-consumer fallback.
- **A sketch step never owns region editing.** `activeExtrudeFor` returns null for a
  sketch. Select an extrude step to edit its existing regions, or start an extrude draft
  from the sketch step. Without an active extrude or draft, region fills are read-only
  and the hint explains how to start. A click on a filled region with a non-empty geometry
  selection clears that selection first; with nothing selected the same click starts an
  explicit extrude draft.
- **Selection opens a popover, not a bottom line.** `SelectionPopover` uses the same
  `StagePopover` chrome: kicker/title, selected rows, a `.sc-chip` palette for immediate
  constraints/construction/dimension/trim/fillet, and a footer summary + quiet delete.
  Applied constraints are included as active chips with their constraint id; clicking one
  removes it (this is how H/V, parallel, equal, etc. are released). A constraint that
  would make the sketch inconsistent is shown as a checked **preview** chip but is not
  written to the document; clicking it releases the conflict, and changing selection or
  tool discards it. Its body is
  click-through except for the header and controls, so floating over the sketch does not
  steal point/axis picks. There is no selection card or constraint bar.
- **Dimension and trim are contextual.** The top tool line only holds selection and
  creation modes. A selected line, circle/arc or pair of points/lines exposes the
  dimension chip (and a radius chip for a circle/arc); a selected line/arc exposes trim.
  Selecting a dimension opens the inline editor at its label: value + unit + driving/
  reference, Enter commits, Escape or click outside cancels, no apply/cancel pair. Point
  X/Y uses the same inline shape at the point.
- **Active-extrude overlay is the used profile, not the whole sketch.** In model mode,
  `modelSketchOverlay` draws and shades only the region loops the active extrude uses
  (outer + holes, hole left open). Construction/unused curves and points are hidden until
  profile-selection mode, where all regions are visible.
- **Dimension label placement is document state.** Linear labels store `offset` + `along`
  (fraction between the anchors); radial labels store `angle` + `distance` (leader length
  beyond the circle). Schema v4 adds these optional fields; do not reset them on unrelated
  edits.
- **Face sketch supports carry a `TopoRef` and a cached frame.** Schema v5's
  `PlaneRef.kind = "face"` stores the JSON-safe ref plus a deterministic right-handed
  `PlaneFrame` (`frameFromHint`: world X projected into the face plane, fallback cross).
  The worker applies that frame to the local XY extrude solid (`applyMatrix`), and
  `Viewport` applies the same frame to the overlay geometry. Through-all measures the
  body extent along the frame normal, not world Z. Live updates use `stabilizeFrame`:
  when the face normal flips but the plane is parallel, the stored side wins, so a sketch
  never mirrors or reverses its extrude direction. `flip side` in the support popover
  reverses the frame at creation; later updates keep the chosen side.
- **Datum planes are history features, not sketch properties.** Schema v7 adds
  `DatumPlaneFeature` (`type: "datum"`) with an `offset` or `midplane` definition and a
  cached `PlaneFrame`; `PlaneRef.kind = "datum"` points at the feature id and caches the
  label/frame for display. The rebuild resolves bases through earlier feature results in
  history order, so dependent sketches/extrudes follow edits. Offset keeps the base axes
  and moves along its normal; midplane requires parallel normals and uses the first's
  axes. `updateSketchFeature`/extrude consumers use the resolved output frame, not the
  cached support frame. Deleting a datum cascades dependent sketches, extrudes and datum
  chains. Renaming one relabels cached supports. Datum quads are ray-picked as
  `BodyPick.kind = "datum"` (with the feature id) and selected from the same support
  popover. Face-backed datum frames are refreshed from the source prefix solid and
  propagated through the datum chain by `refreshDatumFrames`; this is derived state, no
  undo step. The worker resolves stored `TopoRef`s with `resolveRef` (exact roles first,
  then geometric hint fallback) against the source prefix, never the final body.
- **Lost face support is derived input, not document state.** The live effects put
  `faceRefKey(ref)` into `RebuildInputs.lostFaceRefs` when the source feature is missing/
  skipped or the worker says the face was not found. `rebuildDocument` folds those keys
  into its root cache key (so a cached success cannot mask a loss), keeps the cached frame
  in the output, and adds a `support-lost` diagnostic. The timeline shows
  `lost · cached frame` plus reselect/open sketch/revert. `reselect` uses the currently
  picked planar face for a face sketch, or opens the datum editor for a datum base.
  Transient "prefix solid no longer cached" errors must not be treated as lost.
- **Projected face boundaries are live fixed references.** Schema v6 adds
  `SketchFeature.projections` (the cached projected loops) and materializes them in
  `Sketch.references` as fixed points/lines with `projectionId`/`referenceLabel`, so
  they solve in group 0 and constraints can target them. Point/line ids are
  deterministic from projection id + loop/index; a topology change keeps the cached
  geometry and marks the projection `stale` instead of silently rewiring constraints.
  The live effect requests the face from the worker's cached prefix solid by `cacheKey`,
  `source` and `role`, so downstream booleans cannot move or split the reference
  outline. Projected points and edges are snap targets; snapping a new vertex to a
  projected edge adds an ordinary `pointOnLine` constraint, so the drawn geometry stays
  attached when the body changes. `faceBoundary` chains wire edges by endpoint before
  returning a loop; never trust kernel edge order/orientation or a side face can project
  as two stray lines. Exact `resolveRef` and lost-support recovery are still
  pending M4 work.
- **Box/lasso selection is a sketch tool, not a pan gesture.** `tool === "box"` uses
  `regionsFullyInside` (fully enclosed); `tool === "lasso"` uses
  `regionsIntersectingPolygon` (touched/crossing, including a freehand loop inside a
  profile's corner). A lasso entirely inside a hole selects the void profile, not the
  parent material. Both select profile regions only, not curves/points. Shift toggles, a
  plain gesture replaces, and an **empty marquee is a no-op** — committing an empty list
  would fall back to auto/largest and look like the wrong profile was selected. Do not
  steal select-drag panning for this.
- **Enter finishes the sketch after a line draft.** The SketchCanvas window listener
  commits a 2+ point draft first; with no draft it calls `onFinishSketch`. Do not add a
  second global Enter handler or it will race the line commit.
- **The active-extrude sketch overlay is a highlighter mark plus ink.** The model view
  draws the source sketch on its plane with a thick highlighter underlay and a dark ink
  centerline (`Viewport.setSketchOverlay`, `Line2` because WebGL ignores
  `LineBasicMaterial.linewidth`). Highlighter alone was unreadable over the body; keep
  the centerline. Construction is dashed. It is `depthTest:false`, does not participate
  in picking, and is hidden in sketch mode/suppressed sketches.
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
