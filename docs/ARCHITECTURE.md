# Architecture

## 1. Goals

A Fusion-like parametric modeler in the browser:

- 2D sketches with real geometric + dimensional constraints.
- Feature history: extrude, revolve, fillet, chamfer, shell, boolean-ish operations.
- Sketches that live on faces of solids and follow those faces when history changes.
- Exact B-rep geometry (STEP export, real fillets), not tessellation.
- Fast enough that dragging a dimension feels live.

### Non-goals for v1

Assemblies, drawings, sheet metal, surfacing/NURBS patch modeling, CAM, simulation,
collaboration, mobile, curved-face sketches, multi-body documents, expressions/parameters
(coming in M7, but the model is designed for it).

Also deferred or unsupported (see `docs/PLAN.md` M9 for the split between `slvs` gaps and
OCCT/kernel gaps):

- free 3D sketch entities/constraints — the document and solver are 2D-plane;
- ellipses, parabolic/hyperbolic conics and general B-splines/NURBS — not in `slvs`;
- cubic Bézier exposure — `slvs` has `E_CUBIC`, but our document/tool/profile/kernel path
  does not;
- sketch text/images and drawing exports (DXF/SVG/PDF, trace, step-dimension).

3D fillet/chamfer, loft, sweep, draft, shell/thickness/offset, patterns/mirror and
threads are **OCCT/`brepjs` features**, not `slvs` gaps; they are scheduled in M5/M6 or
tracked in M9. Expressions are app-level (M7) and are evaluated before calling `slvs`.

## 2. Stack and why

**2D constraint solver: SolveSpace `slvs`.** SolveSpace's solver is the best
free constraint solver for this job: it handles lines, arcs, circles, and a rich set of
constraints, and it is battle-tested by SolveSpace itself. Upstream now builds a WASM
module (`src/slvs/jslib.cpp`, emscripten `MODULARIZE`, single-file) and publishes it as
the npm package `slvs`. We do not have to compile anything to start.

Cost: **GPLv3**. This application is therefore GPLv3. That was an explicit decision.

**3D kernel: OCCT via `brepjs`.** Real B-rep with booleans, fillets, STEP export, in
WASM, in a worker. `brepjs` is a TypeScript wrapper over OCCT (`occt-wasm`) with a
crucial extra: `brepjs/shapeRef`, a stable-reference layer for faces/edges that survives
rebuilds. That is the single hardest part of this project, so we buy it instead of
building it. Alternative considered: `replicad` (more mature, larger community, MIT, no
stable-reference layer) — see `docs/decisions/0001-kernel-and-solver.md`.

Rejected: mesh booleans (Manifold) — no true fillets, no STEP, faceted circles.
Rejected: building on SolveSpace's own NURBS kernel — not exposed as a library, and the
whole point is to not write a kernel.

**Rendering: three.js.** Meshes and edge polylines come from the kernel; three.js only
draws. We do not use react-three-fiber: the scene has imperative hot paths (picking,
sketch drag at 60 fps) that are simpler outside React's render loop.

**State: Zustand + immutable document.** One `Doc` object, replaced on every edit.
Undo is snapshot-based (documents are small). Transient drag state is kept outside the
document and committed once on pointer-up.

## 3. Layers

```
┌──────────────────────────────────────────────────────────────┐
│ app/      React UI: feature tree, toolbars, dialogs          │
├──────────────────────────────────────────────────────────────┤
│ sketch/   SVG overlay: draw, snap, dimension, drag           │
│ viewer/   three.js: camera, grid, solids, edges, picking     │
├──────────────────────────────────────────────────────────────┤
│ core/doc       document + commands + undo + persistence      │
│ core/sketch    entities, constraints, loop finding, solver   │
│ core/features  feature definitions + evaluators              │
│ core/rebuild   ordered rebuild, cache, topo-ref resolution    │
├──────────────────────────────────────────────────────────────┤
│ core/kernel    thin adapter over brepjs + worker client       │
├──────────────────────────────────────────────────────────────┤
│ workers/kernel.worker.ts   OCCT / WASM (off main thread)     │
└──────────────────────────────────────────────────────────────┘
```

The main thread runs `slvs` (synchronous, fast, needed at pointer-move rate).
Everything OCCT runs in the worker (slow, can take 100s of ms).

## 4. Document model

```ts
type Id = string; // nanoid, opaque, stable forever

interface Doc {
  schemaVersion: 5;
  units: "mm";
  name: string;
  features: Feature[];        // ordered history, single body in v1
  params: Record<string, Expr>; // reserved for M7
}

type Expr =
  | number
  | { param: string }
  | { op: "+" | "-" | "*" | "/"; a: Expr; b: Expr };

interface FeatureBase {
  id: Id;
  name: string;
  suppressed?: boolean;
}

type Feature =
  | DatumPlaneFeature
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature;

/** A construction/datum plane. A history step, but it has no body. */
interface DatumPlaneFeature extends FeatureBase {
  type: "plane";
  definition:
    | { kind: "offset"; base: PlaneRef; distance: Expr }
    | { kind: "midplane"; a: PlaneRef; b: PlaneRef };
  /** Last successfully resolved frame, for recovery when a base reference dies. */
  frame?: Frame;
}

interface SketchFeature extends FeatureBase {
  type: "sketch";
  plane: PlaneRef;
  points: Record<Id, SketchPoint>;
  curves: Record<Id, SketchCurve>;
  constraints: Record<Id, SketchConstraint>;
}

interface SketchPoint {
  id: Id;
  x: number;
  y: number;
  construction?: boolean;
  /** User-placed point not used by a curve; kept by pruning, ignored by profiles. */
  standalone?: boolean;
}

type SketchCurve =
  | { id: Id; type: "line"; a: Id; b: Id }                      // point ids
  | { id: Id; type: "circle"; center: Id; radius: number }       // radius param lives on the curve
  | { id: Id; type: "arc"; center: Id; start: Id; end: Id; ccw: boolean };

type SketchConstraint =
  | { id: Id; type: "coincident"; a: Id; b: Id }
  | { id: Id; type: "distance"; a: Id; b: Id; value: Expr;
      driving?: boolean; offset?: number }                       // point-point
  | { id: Id; type: "horizontal" | "vertical"; line: Id }
  | { id: Id; type: "parallel" | "perpendicular"; a: Id; b: Id }
  | { id: Id; type: "tangent"; a: Id; b: Id }
  | { id: Id; type: "equal"; a: Id; b: Id }
  | { id: Id; type: "angle"; a: Id; b: Id; value: Expr }
  | { id: Id; type: "radius" | "diameter"; curve: Id; value: Expr;
      driving?: boolean; angle?: number }
  | { id: Id; type: "pointOnLine"; point: Id; line: Id }
  | { id: Id; type: "symmetric"; a: Id; b: Id; about: Id };
```

Implemented today: coincident, horizontal, vertical, parallel, perpendicular, equal,
point-on-line, midpoint, distance and diameter. Planned: tangent, angle, radius,
symmetric.

Placement is deliberately separate from geometry:

```ts
type PlaneRef =
  | { kind: "world"; plane: "XY" | "XZ" | "YZ" }
  | { kind: "face"; ref: TopoRef; frame: PlaneFrame } // cached last-known placement
  | { kind: "datum"; feature: Id; frame: PlaneFrame }; // a DatumPlaneFeature

interface PlaneFrame {
  origin: [number, number, number];
  normal: [number, number, number]; // unit
  xAxis: [number, number, number];  // unit
  yAxis: [number, number, number];  // unit, normal = xAxis × yAxis
}
```

3D features reference a sketch plus the specific closed **regions** to use:

```ts
interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  sketch: Id;
  regions: string[];      // region ids, derived from the sorted curve ids that form the loop
  height: number;
  /** blind uses height; throughAll cuts through the current body (M3). */
  end: "blind" | "throughAll"; // M4 adds up-to-face TopoRef
  symmetric: boolean;                 // two-sided; the sketch plane is the midplane
  operation: "new" | "join" | "cut";
}
```

`regionId = hash(sortedCurveIds.join(","))` — stable as long as the loop's curves are
unchanged, and re-derivable on every rebuild without storing geometry.

## 5. Sketching

### Entities → solver

The solver has no document concept: every solve starts from an empty sketch and is
rebuilt from our model. Mapping:

Exact upstream signatures (they take `Slvs_Entity` structs, not handles; every unused
slot is `slvs.E_NONE`):

| Ours | slvs |
| --- | --- |
| point | `addPoint2D(g, u, v, wp)` → `E_POINT_IN_2D` |
| line | `addLine2D(g, ptA, ptB, wp)` → `E_LINE_SEGMENT` |
| arc | `addArc(g, fixed +Z normal, center, start, end, wp)`, always CCW start→end |
| circle | `addCircle(g, normal, center, radius, wp)` where `radius = addDistance(g, r, wp)` |
| coincident | `coincident(g, entityA, entityB, wp)` |
| point–point distance | `distance(g, ptA, ptB, mm, wp)` |
| point–line distance | `addConstraint(g, C_PT_LINE_DISTANCE, wp, mm, point, E_NONE, line, …)` |
| horizontal / vertical | `horizontal(g, line, wp, E_NONE)` / `vertical(…)` |
| parallel / perpendicular | `parallel(g, a, b, wp)` / `perpendicular(g, a, b, wp, false)` |
| equal (lines or circles) | `equal(g, a, b, wp)` — picks length or radius by entity type |
| point on line / circle | `addConstraint(g, C_PT_ON_LINE / C_PT_ON_CIRCLE, …)` |
| tangent (arc ↔ line) | `addConstraint(g, C_ARC_LINE_TANGENT, …, arc, line, …, other)` |
| symmetric (two points, axis line) | `addConstraint(g, C_SYMMETRIC_LINE, …, ptA, ptB, line)` |
| midpoint | `midpoint(g, point, line, wp)` (npm wrapper takes the line, not two points) |
| angle (two lines) | `angle(g, a, b, degrees, wp, false)` |
| diameter / radius | `diameter(g, circleOrArc, 2R)` — no workplane argument |
| fix point | `dragged(g, point, wp)` |

The table is the only place that should know these signatures. Two wrapper quirks are
deliberate: `tangent` is built with `addConstraint` (the helper aborts the WASM instance
when it cannot prove the endpoint is shared), and `symmetric` uses `C_SYMMETRIC_LINE`
(the helper's `.d.ts` signature is wrong). The C API expects `other`/`other2` as booleans
in the JS wrapper.

Circle radius is a solver variable (`E_DISTANCE` param). An arc's radius is **not** a
separate entity: it is `|start - centre|`, so the adapter reads it back from the solved
points, and a diameter dimension on an arc constrains through `C_DIAMETER`.

The adapter lives in `core/sketch/solver.ts` and is the **only** file that imports
`slvs`. Everything else speaks our types.

### Sketch coordinate frame

Every sketch owns a `references` block: a fixed origin point and two construction axis
lines (X and Y). They are **separate** from `points`/`curves` so point indices, profiles,
entities and deletion stay free of reference geometry. `allPoints()` / `allCurves()`
resolve either kind by id.

- Solver: reference points are group-0 anchors; axis lines are added with fixed endpoints
  and contribute no DOF. A user line/circle/arc may use `origin` as an endpoint/centre.
- Selection: the origin and axes are selectable in select and dimension modes. The axis
  hit targets sit below user geometry, and the origin sits between the axes and user
  geometry, so a curve/point at the same place still wins.
- Constraints/dimensions: a free point can be coincident with the origin, on an axis, or
  measured from an axis. A line can be parallel/perpendicular to an axis. Reference
  geometry itself cannot be deleted or have its construction state toggled.
- Profiles: `findLoops`/`sketchGeometry` include reference points for coordinates, but
  reference lines are construction and never part of a loop.
- Exact point editing: the inline X/Y editor at the point calls the same `solveDrag`
  target used by pointer dragging, so the result respects every constraint (and a fully
  constrained point is a no-op).

### Solving

```ts
solve(sketch, drag?: { pointId: Id; x: number; y: number }) → {
  ok: boolean;
  dof: number;                    // real remaining DOF (see below)
  points: Record<Id, {x,y}>;      // solved positions
  diagnostics: Diagnostic[];      // conflicting / redundant constraint ids
}
```

Rules:

- `clearSketch()` → rebuild all entities → add constraints → mark dragged point →
  `solveSketch(g, true)` → read back every point param. Never incremental.
- Pass the previous solved positions as the starting guess, so consecutive drags
  converge to the nearest branch.
- While dragging, add `C_WHERE_DRAGGED` for the point under the cursor. Without it the
  solver may pick a mirrored/rotated solution and the sketch "jumps".
- `result` codes: `OKAY` and `REDUNDANT_OKAY` are acceptable; `INCONSISTENT` means
  conflicting constraints; `DIDNT_CONVERGE` means give up after N restarts. `bad` is the
  list of constraint handles to highlight.
- **DOF**: `Slvs_SolveSketch` solves exactly one group with every parameter free,
  including the base workplane frame, which is a free rigid body in 3D (3 translation +
  3 rotation). So the reported `dof` is **6 too high**. Report `max(0, dof - 6)`.
  Measured: empty base2D = 6, one free point = 8, line + horizontal = 9, rectangle with
  H/V + an anchored corner = 8 (i.e. the 2 in-plane translation DOF Fusion would also
  show). "Fully constrained" = 0. Keep these numbers as tests in M1.
- **Anchoring uses solver group 0.** `Slvs_SolveSketch` only adds parameters belonging to
  the group being solved, so entities created with `grouph = 0` are constants. Create the
  sketch origin (and any projected reference geometry) as group-0 points and constrain
  normal geometry to them. This is a real anchor: unlike `C_WHERE_DRAGGED`, it counts
  toward the rank, so the DOF number is honest. It is how SolveSpace's own groups work.
- **Reference dimensions are not constraints.** A dimension with `driving: false` is
  skipped by the solver and by the drag Jacobian; it is an annotation whose displayed
  value comes from the solved geometry. This is the "measure only" mode of the dimension
  tool.
- **Circle/arc normals also go in group 0.** A 2D circle needs an `E_NORMAL_IN_3D`
  argument (`addNormal2D` is rejected), and if that normal lives in the solved group it
  contributes 3 meaningless rotational DOF. Create one fixed group-0 normal and share it.
- **Dragging uses tangent-space projection.** Pinning the dragged point at the cursor
  makes the system inconsistent as soon as the cursor leaves the feasible set: a point on
  a circle can only move along the circle. Instead `core/sketch/drag.ts` linearises the
  constraints at the current solution (an analytic Jacobian for every supported
  constraint), then projects the cursor delta onto its null space with weighted cyclic
  orthogonal projections (von Neumann/Kaczmarz). The dragged point gets a tiny mobility
  (1e-9) so it is the thing that follows the cursor, while the rest of the sketch absorbs
  the correction. The projected positions are applied to *all* points and the solver
  removes the second-order error; if it rejects the step, shorter steps are tried. A
  full-rank sketch projects to zero and `solveDrag()` returns `null`, so a fully
  constrained sketch simply does not move. This is also why `dragged()` is **not** used:
  it pins, and pinning is the bug.
- **Multi-target drags:** `solveDragTargets` accepts a set of target positions. A line
  supplies both endpoints with the same delta, which translates it; because each endpoint
  is projected independently, constraints can turn that translation into a stretch or a
  rotation. Circles drag by their centre with the grab offset preserved.

### Arcs and fillets

An arc is three point ids: `center`, `start`, `end`. It is **counter-clockwise from start
to end** around a group-0 +Z normal; there is no separate sweep flag. `addArc` computes
the circumcentre of the clicked start/end/through points and swaps the endpoints when the
through-point lies on the complementary arc, so the stored direction always contains the
point the user clicked.

Dragging an arc moves its centre, start and end together (the same multi-target path as a
line). The drag Jacobian includes the arc's internal equal-radius equation
`|start-centre|² = |end-centre|²`; without it the endpoints would drift off the circle.
The solver owns the same relation in the arc entity.

A **fillet** is a structural sketch edit, not a 3D feature: `addFillet` finds two lines
that share a point, computes the tangent points at the requested radius, shortens the
lines to those points, inserts a CCW arc between them, and adds two `tangent` constraints
plus a driving diameter. The tangent points are shared point ids across the line and the
arc, which is what makes `C_ARC_LINE_TANGENT` applicable.

If another curve, dimension or anchor still uses the old corner point (for example the
demo's construction diagonal and origin coincidence), the point is kept at the sharp
intersection and constrained with **point-on-line against both trimmed lines**. The
solver treats a line as infinite, so this is exactly the intersection of the two
supporting lines: the diagonal and any origin/Fix anchor stay put, while the visible
boundary uses the arc. The point is marked construction when every remaining curve that
uses it is construction. Constraints that referred to the pre-trim segments are
replaced; Fix and fixed-point coincidences are preserved. The corner's diameter label is
placed at the visible arc's midpoint, not at the default 45° point on its full circle.

### Regions and profiles

`core/sketch/loops.ts` extracts selectable **regions**, not one "largest loop":

1. Build a planar arrangement of non-construction line/arc segments: split at
   line/line, line/arc and arc/arc crossings, at T-junctions, and where a line/arc meets
   a circle. A circle with at least two contacts is replaced by arc segments around the
   same centre; an untouched circle remains a closed circle candidate. This is derived
   geometry; the document keeps the curves the user drew.
2. Walk the **directed half-edges** of the split graph. At each node, outgoing edges are
   sorted by tangent; the next edge in a face is the one immediately clockwise from the
   reverse edge. Bounded faces come out CCW; the unbounded CW outside is discarded. This
   handles faces that share an edge (a line through a circular hole) without a
   cycle/subdivision heuristic.
3. Build a containment tree from the bounded faces and untouched circles. **Every face is
   a selectable profile**: even depth is material, odd depth is the negative space of its
   parent, and each region uses its **direct** children as holes. This yields both sides
   of every boundary:
   - rectangle + circle → the plate with a hole, plus a void disk,
   - a line through that circle → two plate faces plus two half-disks,
   - two disjoint rectangles → two material regions,
   - concentric circles → a tube, plus the inner void disk,
   - an island inside a hole → outer plate, void annulus, and island.
4. `regionId = hash(sorted outer + direct-hole curve ids)`. It is stable across dimension
   and constraint edits and invalidates when a boundary changes. The selected ids live in
   UI state (not the document) until M3 stores them on an extrude feature.

The app defaults to the largest **material** region when no explicit selection exists;
clicking any filled face (including a hole, which is its own void profile) replaces the
selection, Shift toggles, **All** selects all material faces, **Voids** selects all
negative-space faces, and **Auto** returns to the largest material face. Void fills stay
transparent until selected but remain hit-testable, so a hole is both the parent's cutout
and a positive profile of its own. Regions are drawn as even-odd SVG paths.

`ExtrudeParams` carries `regions: { outer, holes }[]`; the worker builds one solid per
region and fuses them with `fuseAll`, so multiple selected profiles produce one body.
`ProfileLoop.kind = "path"` still carries exact line/arc edges for the kernel; the sampled
polygon is only for containment/validation. `profileFromSketch` remains as the legacy
single-largest-loop helper used by older tests.

**M2.6 split/trim** closes the old M2 boundary. Region extraction runs on the planar
arrangement, so two crossing diagonals become four faces. A line through a circular hole
splits the circle into arcs; the half-edge walk returns both plate faces and both
half-disks. The reported circle-through-hole part is a regression fixture.
`trimCurveAt` uses the same pieces to remove the clicked segment; it materializes only the kept boundaries, replaces
the source curve, remaps constraints that still apply, adds collinearity/equal-radius
links between kept pieces, and reports constraints it had to remove. Circles still act as
whole closed loops; turning one into an arc is tracked in M9.

### Sketch layout operations (M6.0, ADR-0004)

Pattern, mirror and offset are **stored parametric sketch operations**, not materialised
copies. `SketchFeature` will carry operation records (source ids + kind-specific params);
the derived instances are regenerated from the solved source on every rebuild and then
feed region extraction/extrude. They are fixed derived geometry like projected
references: not individually draggable or constrainable in v1, so the user constrains the
source and re-edits the operation itself. The sketch stays one history step. Feature/body
patterns and mirror (M6) are separate B-rep operations and reuse the same popup/preview
grammar rather than this engine.

## 5.5 Document and persistence

`Doc` is the source of truth for a part: `schemaVersion`, an opaque document id, a name,
and an ordered `features` array. M3 has two feature types, `SketchFeature` (support plane
+ sketch) and `ExtrudeFeature` (source sketch, selected region ids, height, operation,
symmetric). The sketch is no longer React component state.

- **Plain JSON only.** Solver output (`SolveOutcome`), meshes and kernel handles are
  derived UI/kernel state. `Doc` must survive `JSON.stringify` -> `JSON.parse` and still
  rebuild identically.
- **Migrate on open.** `migrateDoc` accepts the current schema (v2), upgrades the
  shape-compatible v1 documents, migrates the legacy `{ sketch, height }` shape, and
  returns `null` for malformed or newer documents. App falls back to a fresh example
  rather than opening a corrupt part. v2 adds the optional `SketchPoint.standalone` flag
  used by the point tool.
- **Autosave.** `persistence.ts` writes `cad.doc` on every committed document change.
  The next load re-solves the active sketch, so derived geometry never enters storage.
- **Feature parameters are undoable.** Extrude height and selected region ids are
  feature fields; changing them goes through the same `useHistory` snapshot store as
  sketch edits. Region ids can invalidate when a boundary changes, so the UI filters
  stored ids against the current regions and falls back to auto/largest.
- **Ordered main-thread rebuild is in.** `core/rebuild/engine.ts` walks features in
  order, solves/derives the sketch, resolves an extrude's source sketch and regions, and
  returns a `FeatureResult` with status and diagnostics. `cacheKey =
  hash(canonical(feature) + upstreamKey)` gives prefix reuse: height/region edits keep the
  sketch result; sketch edits invalidate the extrude. The cache is bounded and in-memory.
  `selectExtrudeRegions` is the single source of the auto/largest-material fallback.
- **Worker multi-feature rebuild is in.** The kernel request carries the ordered successful
  extrudes as `KernelFeature[]` (cacheKey, params, operation). The worker caches the
  prefix solid per cacheKey, applies new/join/cut, and returns per-feature build
  statuses. It is still a single body: `new` after a base is an error, a first `join` or
  `cut` with no base is an error ("Nothing exists to join/cut"), and multiple bodies are
  later. No operation silently falls back to a different one.
- **The history is a real feature tree.** The timeline renders `doc.features` in order.
  Clicking a feature makes it active and opens its editor: a sketch opens the sketch
  canvas, an extrude opens the model plus its `FeaturePopover`, and a datum plane opens
  `DatumPlanePopover`. There is no separate edit command. The active step is also the
  **history cursor**: `buildDoc` slices the feature list through it, so the stage renders
  only that prefix and later steps are visibly paused. There is no roll-back or
  roll-forward control. Editing a sketch updates that
  feature by id (not the first sketch). A sketch step never owns region editing: select
  an extrude step to edit its existing regions, or start a new extrude draft from the
  sketch step. A shared sketch therefore cannot silently rewrite another extrude's
  profiles. Double-click renames through `renameFeature` as one undo
  entry. Each row shows its rebuild/worker status, diagnostic tooltip and paused/
  suppressed state. The timeline's leading/insert gaps open `SupportPopover` and
  create a sketch on the explicit support (world XY/XZ/YZ or a planar face; datum
  planes too). `extrude`
  on a selected sketch starts a UI-only `extrudeDraft` with no profile selected; it
  becomes a history feature only when at least one profile and the parameters are
  applied. The draft defaults to `new` unless an unsuppressed body exists; a first
  `join` is a visible worker error, never an implicit body. A draggable popover
  (`FeaturePopover`) edits height/symmetric/operation/end over the stage; its footer is a
  one-line summary plus quiet `cancel` and primary `apply`, and cancel restores an
  existing feature as it was when the popover opened. Profile selection is a button in
  that popover, not a timeline action. Double-click renames. The detail line is a
  readout, not a summary: the lost-support message, the remaining actions (extrude on a
  sketch, open sketch, suppress, delete) and the autosave note. A datum plane's visibility
  is the eye split control on its output chip, not a footer action. Paused,
  suppressed, hidden and build status are carried by dimming/underline/classes, never by
  meta text, so a step keeps its width as the cursor and visibility change. The track scrolls only horizontally (a vertical wheel
  maps onto it, `overflow-y` is hidden); native scrollbars are left native rather than
  replaced with a fake overlay. Steps are
  drag-reordered; an invalid order (extrude before its sketch) is refused with a notice.
  The stage builds only the prefix through the active step; downstream steps are paused
  until selected. The file menu handles `.cad` download/open/rename/new; the local file list supports open,
  copy and a two-step delete, and the built-in example keeps a stable id so reloading
  updates one entry.

## 6. Rebuild engine

Input: `Doc`. Output: the final solid, its tessellation, and per-feature status.

Current split: the main thread evaluates sketches and produces ordered `KernelFeature`s;
the worker builds a single body with a prefix-solid cache, booleans and fillets.

```
main thread: features in order
  ├─ evaluate sketch: solve -> regions
  ├─ evaluate extrude: source sketch -> selected regions -> ExtrudeParams
  ├─ evaluate fillet/chamfer: size + stable EdgeRefs -> KernelFillet|ChamferFeature
  ├─ cache output keyed by hash(feature, upstream key)
  └─ record { featureId, status, output, diagnostics }
       ↓ successful solid features only, in history order
worker: KernelFeature[]  (extrude | fillet | chamfer, discriminated)
  ├─ prefix cache: cacheKey -> Solid (operations already applied through this feature)
  ├─ cache hit: reuse the solid and its face origins
  ├─ cache miss extrude: build tool -> fuse/cut -> cache the result
  ├─ cache miss blend: resolve EdgeRefs on the prefix -> fillet/chamferWithEvolution
  │                      -> re-derive roles geometrically -> cache the result
  └─ mesh the last good base -> BodyMesh + per-feature statuses
```

A failed fillet/chamfer is skipped exactly like a failed boolean: later features use the last good
base and the step carries the error. App previews a **new** fillet/chamfer by appending a synthetic
`fillet-draft` / `chamfer-draft` feature to this list; it is never written to `Doc` until apply.

The worker cache owns cloned solids. Cached solids cannot be meshed twice with the same
mesh cache: the first request transfers the mesh ArrayBuffers, detaching them, so call
`clearMeshCache()` before tessellating a cached prefix. A worker feature error clears the
whole solid cache after the last-good mesh is computed: downstream prefixes that skipped
the failed feature must not be reused if a retry succeeds.

- **Prefix caching.** `cacheKey = hash(canonical(feature), upstreamCacheKey)`. Editing
  the last feature reuses everything before it. The cache lives in the worker and is
  dropped on reload.
- **Staleness.** Every rebuild carries a generation number. Results with an old
  generation are discarded. Edits while a rebuild is in flight must not corrupt the view.
- **Failures are per-feature.** A broken feature is skipped, downstream features still
  run against the last good solid, and the feature tree shows an error. This matches how
  Fusion behaves and is much better than a global failure.
- **Empty results.** Cutting everything away is legal (empty body); treat it as a state,
  not an error.

## 7. Topological naming

The classic "topological naming problem": after an upstream edit, OCCT rebuilds the
solid and every face has a new identity. If a fillet remembered "face index 7", it now
fillets the wrong face.

Design:

```ts
interface TopoRef {
  source: Id;                 // feature whose output the selection was made against
  kind: "face" | "edge" | "vertex";
  role: string;               // semantic name, e.g. "extrude:end", "extrude:side:3"
  hint: GeometricHint;        // surface type, normal, centroid, area / curve type, endpoints
}
```

- Every feature output gets named faces via `brepjs` `assignRoles(solid, scheme)`:
  `extrude:start`, `extrude:end`, `extrude:side:<i>`, `box:top`, `fillet:<n>`, etc.
- Selections store a `TopoRef` (JSON), never a handle or an index. `captureHint` +
  `createRef` produce it; `resolveRef` re-finds it (confidence `exact` or
  `geometric-fallback`).
- Face **lineage** is tracked through operations with `fuseWithEvolution`,
  `cutWithEvolution`, `filletWithEvolution` and friends, which return a
  `ShapeEvolution` from input faces to output faces. `updateRoles(refs, evolution)`
  propagates the role table across a rebuild. `getFaceOrigins` / `setShapeOrigin` expose
  the underlying origin tracking. Use this machinery; do not invent a parallel one.
- On rebuild, resolve each ref against the **new output of `source`**, then re-run the
  dependent feature with the resolved entity. `resolveRefParams` does this for a whole
  params bag (recursing into arrays and nested objects).
- An edge is named by the two faces it bounds; a vertex by the ≥3 faces that meet there.
  Generated faces (fillet rounds) are named by the two faces they bridge.
- Failure is a first-class outcome: `not-found` → feature errored with "selection lost,
  reselect"; `ambiguous` → warning, pick the best candidate and tell the user.

Rules:

- Never write a kernel hash, an array index, or a triangle id into `Doc`.
- Role assignment must be deterministic: sort by geometric position, never by kernel
  iteration order.
- Face normals can flip during booleans; compare directions up to sign where sensible.

**First plumbing (M3).** The worker keeps a `RoleTable` per cached prefix solid. It
assigns roles to each tool with `assignRoles(tool, "extrude")`, uses
`fuseWithEvolution`/`cutWithEvolution`, and advances every origin's roles with
`updateRoles` before caching the prefix. `updateRoles` deliberately ignores
`evolution.generated` (on OCCT those hashes refer to an intermediate shape), so the
worker then adopts anonymous result faces by matching sample points to the tool faces
they lie on. A cut's new hole wall and the exposed wall of a joined cylinder therefore
still get a role, a stable `TopoRef`, and feature attribution. `captureHint`/`createRef` then produce JSON-safe
`TopoRef`s for the final body's faces; `FaceGroup.ref` and `BodyPick.ref` carry them to
the main thread. Schema v5 stores a face `TopoRef` plus its cached `PlaneFrame` on
`SketchFeature.support`; schema v6 adds cached face-boundary projections, schema v7 adds
datum-plane features/supports, schema v8 adds datum-plane visibility (`hidden`), and
schema v9 adds constant-radius fillets, and schema v10 adds constant-distance chamfers. The
worker maps the local extrude solid through that frame, and resolves a projected boundary
from the cached prefix solid that owns the face (never from a downstream boolean). The
worker resolves stored `TopoRef`s with
`resolveRef`: exact role hashes first, then a geometric hint fallback, then a visible
lost-support error. An exact role is only trusted when its face still agrees with the
stored hint normal; positional roles can survive an upstream edit while now naming a
different face (for example after a split), and the hint fallback then takes over.

Face roles also carry their **introducing feature id** in `TopoRef.source`. The viewer
uses that attribution for the selected-feature highlight, so it never has to guess which
faces came from which history step.

**Fillet edges and generated rounds.** An edge is not named by its own hash; it is the
intersection of its two adjacent faces, so `EdgeRef` stores two face `TopoRef`s plus a
length/midpoint hint. The worker resolves both faces (role first, geometric fallback) and
takes their `sharedEdges`; the hint breaks a tie when the faces meet along more than one
edge. A plate resize therefore keeps the fillet attached without storing a kernel hash.

Fillets do **not** use `updateRoles`: OCCT returns an empty evolution for
`filletWithEvolution` (no modified/generated/deleted faces). After each fillet the worker
re-derives the table geometrically — surface type, outward normal, and sampled
containment map each old face to the trimmed result face that continues it — then names
the generated rounds under the fillet feature (`fillet:round:<index>`) by finding the new
face adjacent to both pre-fillet faces. The step highlight, downstream `EdgeRef`s, and
face picks all depend on that re-derivation.

This is the part to test hardest. Every kernel test that edits an upstream feature and
re-runs a downstream fillet is a topological-naming regression test.

## 8. Sketch supports: faces and datum planes

A sketch on a world or datum plane has no supporting face to project, so the sketch
canvas draws the rendered prefix body's `mesh.edgePositions` projected into the sketch
frame as faint dotted reference lines (`bodyReference`). They are derived from the
selection cursor and are never document data, pickable or snappable. Face sketches keep
their live supporting boundary instead, so the two references are not duplicated.

A sketch is not "on XY" or "on a face"; it has a `PlaneRef` that resolves to a `Frame`
(origin + x + y, normal = x × y). The same machinery serves world planes, planar faces,
and datum planes.

### Resolution and recovery

1. Resolve the ref in history order. A face ref resolves through `TopoRef`/`resolveRef`;
   a datum ref resolves through its `DatumPlaneFeature`, whose bases are themselves refs.
2. A resolved datum plane reports a deterministic frame; the sketch and the plane feature
   both keep a last-known frame. If the reference dies, use the cached frame, mark the
   feature errored, and keep the geometry visible so the user can reselect.
3. Frame determinism on a bare plane: take the normal `n`, pick the world axis least
   parallel to `n`, project it into the plane, normalize, and tie-break on axis order.
   A datum plane inherits its base frame's x/y, so offset planes are stable under small
   model changes (and do not spin).
4. A planar face is the only face type that can be a support in v1. A curved face produces
   a clear "unsupported support" error, not a broken sketch.

### Datum planes

- **Offset**: `origin = base.origin + base.normal * distance`, axes copied from the base.
  The base can be a world plane, a face, or another datum plane, so chains and
  "sketch in thin air" at `XY + 25 mm` work. Distance is an `Expr` (M7 parameters).
- **Midplane**: resolve both bases; they must be parallel. Use the first normal `n`, and
  `origin = originA + n * dot(originB - originA, n) / 2`, axes from A. Non-parallel bases
  are a feature error.
- Planes are features in the timeline: they can be edited, suppressed, and reused by
  several sketches. They do not produce a body; a rebuild records their frame and errors.
- Render them as translucent quads with axes, pickable in 3D. While sketching, show only
  the active support (and the model, dimmed) to keep the sketch readable. Quads + axes are
  rendered and ray-picked as an ephemeral datum pick today; support-list hover preview
  and lost-ref recovery are still pending.
- A lost base face/plane errors the plane feature; every dependent sketch/feature shows
  "support lost" and uses its cached frame until reselected. Datum bases resolve through
  earlier rebuild results, and face-backed datum frames refresh from the source prefix
  solid. Lost refs are derived `RebuildInputs.lostFaceRefs`, and the step offers
  reselect/open sketch/revert. Exact `resolveRef` fallback is still pending.

### Projected reference geometry ("On Face / On Line")

SolveSpace lets a sketch point be constrained directly to a solid face or edge. Our 2D
solver cannot see 3D, so we do the equivalent: **project the referenced face/edge into the
sketch as fixed construction geometry**, then use the ordinary 2D point-on-line,
point-on-point or coincident constraints against it.

- A projected entity stores the `TopoRef` it came from and a cached loop list, not just
  the resulting 2D coordinates. The live effect asks the worker for the boundary of that
  face on the cached prefix solid that owns it, then re-materializes the fixed points and
  lines. The source prefix matters: a downstream cut/join must not move or split a
  reference outline.
- Projected geometry is fixed reference geometry: it is not editable, not a solver
  unknown, and is excluded from profile extraction. It uses the same group-0 treatment
  as the origin in the `slvs` adapter, but its points/lines are selectable as references
  so constraints can target them.
- Projected point/line ids are deterministic from the projection id and loop/index. A
  topology change keeps the last known geometry and marks the projection `stale` rather
  than silently rewiring user constraints.
- The supporting face's outer and inner wires are projected by default. Straight edges
  keep their corner points; curved edges are sampled deterministically. Arbitrary
  edges/faces can use the same protocol later (`brepjs` provides `drawProjection`,
  `drawFaceOutline` and `makeProjectedEdges`).
- A lost reference errors the sketch (or marks the projection stale) and keeps the last
  known projection visible, rather than silently detaching the geometry.
- A sketch does not have to be *on* a face to reference one: the gusset demo draws in the
  body's symmetry/midplane and projects the inner corner edge and both inner faces into
  that plane. That is how a sketch "between surfaces" stays welded to the walls.

### Sketches in empty space

"Thin air" sketches are the offset-of-a-world-plane case (`XY` at +25 mm) and the
midplane case. Free 3D sketch entities are a different feature and are out of scope; the
solver has no 3D sketch representation.

## 9. Rendering and picking

- **Model space is Z-up.** `camera.up.set(0, 0, 1)`. OrbitControls handles an arbitrary
  up vector.
- Kernel output per body: triangle positions + normals, `faceGroups` (index range +
  `faceId`/`origin`) and `edgeGroups` (range + `edgeId`). All transferred as typed arrays.
- **Face picking:** raycast the mesh, take `intersection.faceIndex` (triangle index), and
  look it up in `faceGroups` via `src/viewer/picking.ts`. No per-face meshes or GPU id
  buffer needed.
- **Edge picking:** raycast the `LineSegments` and map the hit's vertex index to an
  `edgeGroup`. Kernel edge groups may be segment- or vertex-indexed; `edgeUnitForMesh`
  detects the convention from the data. Edges win over the face only when their hit is
  not behind the face, so hidden back edges do not steal a click.
- **Highlight:** overlay geometries contain only the selected face's triangle indices or
  the selected edge's line positions. They use the highlighter colour and are disposed
  when the pick changes. Hover and selection are separate overlay groups.
- **Body selection is ephemeral.** `BodyPick` lives in App UI state, uses `faceId`/`origin`
  or `edgeId` rather than array indices, and never enters the document or undo history.
  It is cleared when a new mesh arrives and by Escape.
- **Feature highlight.** The active extrude step washes every final-body face whose
  `TopoRef.source` is that feature (including faces adopted from anonymous boolean
  results, so a joined pin lights its whole exposed wall, not just its cap). Roles travel through `updateRoles`, so a join or cut
  highlights the faces it added (a new cap, a hole wall), not the whole body; a first
  extrude consequently owns every face. The overlay follows the final mesh, so geometry
  removed by a later feature is not shown. It is not part of picking and is cleared for
  sketch steps, suppressed features, and open support/draft popovers.
- **Active-extrude sketch overlay.** In model mode, the active extrude's source sketch
  is drawn on its plane with a thick highlighter underlay plus a dark ink centerline
  (`Line2`). Only the region loops that extrude uses are drawn, and their outer/hole
  loops are also shaded with a transparent highlighter fill (the hole stays open).
  A face-supported sketch transforms the whole overlay through its `PlaneFrame`
  (`Matrix4.makeBasis`). Construction/unused curves and all points are hidden until
  profile-selection mode, where the full sketch and every region return. It is
  depth-tested in world space, so the body occludes a sketch that lies inside or behind
  it (a bottom sketch no longer draws over the body from above). `polygonOffset` on the
  fill and `Line2` quad materials wins the depth test against the coincident face the
  sketch was drawn on without pulling it through unrelated geometry. It is separate
  from the mesh/raycast groups and is hidden in sketch mode and for a suppressed source
  sketch.
- **Sketch mode:** a full-stage 2D surface rather than a sidebar. The timeline switches
  between this and the 3D model; the 3D renderer is paused while the sketch is active.
  `slvs` stays on the main thread, and a **separate SVG surface** carries sketch curves,
  dimensions, and constraint badges, with floating HTML controls over it. SVG gives crisp lines, trivial hit-testing, and
  real text for dimension labels. Recompute the overlay's viewBox from the camera on
  zoom/pan. If entity counts ever get large, swap the curve layer to Canvas2D and keep
  SVG for labels.
- **Sketch selection is ephemeral.** `selected: string[]` lives in `App`, is resolved
  against the current sketch every render, and never enters the document or undo history.
  Curves get transparent wide-stroke hit targets; point hit circles are rendered last so
  they win over curves. Labels have `pointer-events: none` so they never steal a click.
  Deletion is a pure `core/sketch/edit.ts` operation that removes dependent curves,
  orphaned points, and constraints that reference anything removed.
- Geometry constants: ~1 px curves for sketch lines, ~1 px solid edges, darker
  silhouette-ish edges, flat-ish shading with a headlight + hemisphere light.

## 10. Worker protocol

```ts
// main → worker
type Request =
  | { type: "init" }
  | { type: "rebuild"; gen: number; params: ExtrudeParams };

// worker → main
type Response =
  | { type: "ready"; kernel: string }
  | { type: "result"; gen: number; mesh: BodyMesh }
  | { type: "error"; gen: number; message: string };
```

`BodyMesh` carries positions/normals/indices, `faceGroups` (start/count/faceId/origin),
`edgePositions`, `edgeGroups` (start/count/edgeId) and stats. A future `export` request
adds STEP/STL. Typed arrays are transferred, not copied. The worker owns OCCT shapes
between messages; the main thread only receives numbers. Never send a `Shape` across.

Rebuilds are **latest-wins**: while a build is in flight, newer requests replace each
other and results for older generations are dropped. That keeps a slider drag from
queueing dozens of booleans.

Rebuild latency target: < 150 ms for a 10-feature model. If exceeded, debounce slider
edits and show stale geometry with a spinner rather than blocking.

## 11. Undo / redo, persistence

- **Undo:** snapshot history (`ui/useHistory.ts`) over the sketch document state
  (`{ sketch, solved, kind }`), capped at 100 entries. The mutable store is the source of
  truth for event handlers; a shallow view is mirrored into React state for rendering.
- **Grouping:** a gesture is one undo entry. Drags and sliders pass a `mergeKey`
  (`drag:p1`, `demo-size`, `hole`) so consecutive commits replace the top entry; the
  canvas calls `endMerge()` on pointer-up (sliders do the same on pointer-up/blur).
  Drawing a shape is a single commit.
- **Persistence:** `localStorage` autosave (debounced) and migrate-on-load are in;
  `.cad.json` export/import is still to come. The schema version and migrations guard the
  stored shape, and an unparseable document falls back to a fresh example rather than a
  blank screen.

## 12. Errors and diagnostics

Every fallible operation returns a result, not an exception:

```ts
type KernelResult<T> = { ok: true; value: T } | { ok: false; error: KernelError };
```

`KernelError` carries `code`, human `message`, and the `featureId`/`constraintIds`
involved. `brepjs` already returns `Result`; do not convert it to exceptions. Booleans
that produce an invalid solid, lost references, and unsolvable constraints all surface
in the feature tree with a clickable "why".

## 13. Testing

- **Unit (vitest):** document commands, undo, loop finding, expr evaluation, region ids.
- **Solver:** known sketches with expected solved coordinates, DOF, conflicting
  constraint detection, branch stability under repeated drags.
- **Kernel (numeric goldens):** build a feature chain and assert volume, bbox, face
  count, edge count within tolerance (1e-6 relative). These catch almost every regression.
- **Topological naming:** edit an upstream parameter, assert the downstream feature still
  targets the same logical face (compare resulting face area/normal/centroid).
- **E2E (Playwright, later):** draw → constrain → extrude → edit → still one body.

## 14. Known hard problems (in order of danger)

1. **Topological naming.** Mitigated by `brepjs/shapeRef`, but the fallback is heuristic.
   Expect to spend real time here. Design the UI to recover from lost refs.
2. **Rebuild latency and cancellation.** OCCT booleans are not interruptible. Keep the
   model small, cache prefixes, debounce, and never run two rebuilds concurrently.
3. **Sketcher UX.** Constraint inference and dimension placement are what separate "toy"
   from "usable". Budget more time than you think.
4. **WASM memory.** OCCT leaks are fatal. Establish disposal discipline on day one.
5. **Solver branch selection.** Dragging can flip a sketch. Always seed with the previous
   solution and add the dragged constraint.

## 15. Future (explicitly deferred)

Parameters/expressions UI (M7), patterns/mirror/sweep/loft (M6), multi-body and
components, assemblies, drawings, STEP import, curved-face sketches, direct editing.

### Scripted features and AI access (M8.5, ADR-0005)

The planned machine surface is a serializable **command/query layer** in `core/commands`.
The UI becomes a client of it, and so do a headless `cad` runner and an AI bridge; no
client drives the DOM or receives kernel handles. A sketch or feature gets a generated
**code view** (canonical builder calls, stable ids, mm/degrees) that can be edited and
applied as one undoable replace. Normal features keep JSON as the source of truth; only a
distinct `script` feature stores source as its truth and derives geometry on rebuild. Code
runs in an isolated deterministic worker/iframe with no DOM, kernel, network, clock or
randomness; failures are per-feature diagnostics, never a crashed tab. The code editor is
a stage mode (not a permanent panel) and follows the same summary + `cancel`/`apply`
footer as the popover. Scenario files built from the same commands can create demo parts
and drive camera/recording. The sandbox choice and builder syntax remain open; see
ADR-0005.

## 16. What the spike actually implements

This document describes the target design. The current code is a vertical slice; here is
the honest map, so nobody assumes a layer exists because it is described above.

| Layer | Status |
| --- | --- |
| `core/doc` | Real: `Doc` schema with sketch/extrude/datum/fillet/chamfer features, selectors, migrations, schema v9 face/datum sketch supports (`TopoRef`/feature id + cached `PlaneFrame`), datum visibility, face-boundary projections, fillet/chamfer `EdgeRef`s, and `localStorage` autosave. |
| `core/sketch` | Real: types, `slvs` adapter, tangent-space `solveDrag`, pure drawing edits, loop extraction, geometry helpers, tests. `demo.ts` is the loadable example. |
| `core/features` | Real: region selection + extrude params, including face/datum-plane frames mapped in the worker. The worker supports ordered new/join/cut, constant-radius fillets and constant-distance chamfers; projected face-boundary references live in the sketch-support path. |
| `core/rebuild` | Real: ordered sketch/datum/extrude/fillet evaluation, prefix cache, per-feature diagnostics. Worker solid cache + new/join/cut/fillet/chamfer are in. |
| `core/kernel` | Real: typed protocol, worker client, OCCT worker, feature cache, face-frame extrude transforms, cached-prefix face-boundary requests, stable face/edge refs, hole validation, exact stats + bounds. |
| `viewer` | Real: Z-up scene, framing, meshing, edges, face/edge raycast picking, multi-edge selection, hover/selection highlights. |
| `sketch` UI | Real: full-stage sketch editor with a grouped text tool line, stage-foot DOF/status, contextual selection popover, adaptive/free-form grid, scale bar and fit/50/100/200 zoom. Select/drag, box-select profile regions, line/point/rectangle/circle/arc, fillet, explicit region fills (material and void, with All/Voids/Auto), contextual dimension/trim chips, inline dimension and point editors, construction toggle, snapping, auto H/V, Enter-to-finish, undo/redo. Standalone points are normal solver geometry but never profiles. |
| Feature tree | Real: lists all `doc.features` (sketches, datum planes, extrudes), selects/renames/creates/edits, drag-reorders, suppresses, deletes with cascade, rolls back/forward, and shows per-feature status/diagnostics. |
| Persistence | Autosave to `localStorage` with migration-on-load, a local file index/list (open/copy/delete/download/rename/new), and `.cad` import/export. |

Known shortcuts, all scheduled: existing extrude features with an empty region list still
resolve to the largest material region for legacy documents, while new extrude drafts
require an explicit profile; support-list detail copy and through-3-point planes are not
implemented yet (M4/M6). Sketches on planar faces, live projected boundaries, offset/
midplane datum features, datum picking, live face-base datum resolution, lost-support
recovery, flipped normals, `resolveRef` exact/geometric fallback and support preview are
in. Unsupported geometry and kernel features are
collected in PLAN M9 with current
workarounds and the upstream SolveSpace/OCCT work each would need.

