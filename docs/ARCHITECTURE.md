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
  schemaVersion: 1;
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

interface SketchPoint { id: Id; x: number; y: number; construction?: boolean }

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
  | { kind: "face"; ref: TopoRef; frame: Frame } // frame is a cached last-known placement
  | { kind: "datum"; feature: Id; frame: Frame }; // a DatumPlaneFeature, cached frame

interface Frame {
  origin: [number, number, number];
  x: [number, number, number];       // unit
  y: [number, number, number];       // unit
}                                    // normal = x × y
```

3D features reference a sketch plus the specific closed **regions** to use:

```ts
interface ExtrudeFeature extends FeatureBase {
  type: "extrude";
  sketch: Id;
  regions: string[];      // region ids, derived from the sorted curve ids that form the loop
  /** How far the profile travels. */
  end:
    | { kind: "blind"; distance: Expr }
    | { kind: "throughAll" }          // M3: both ways for a cut, one way for a join
    | { kind: "upTo"; ref: TopoRef }; // M4: stop at a face/vertex, resolved at rebuild
  symmetric?: boolean;                 // two-sided; the sketch plane is the midplane
  operation: "new" | "join" | "cut" | "intersect";
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
- Exact point editing: the X/Y fields in the selection card call the same `solveDrag`
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
   a circle. This is derived geometry; the document keeps the curves the user drew.
2. Enumerate simple cycles over the split segments and treat each non-construction
   circle as a closed loop.
3. Drop a cycle when a smaller cycle that shares one of its curves lies inside it. That
   is a **subdivision**, not a face: a rectangle with a real diagonal yields two
   triangles, not the rectangle plus two holes.
4. Build a containment tree from the remaining faces and circles. **Every face is a
   selectable profile**: even depth is material, odd depth is the negative space of its
   parent, and each region uses its **direct** children as holes. This yields both sides
   of every boundary:
   - rectangle + circle → the plate with a hole, plus a void disk,
   - two disjoint rectangles → two material regions,
   - concentric circles → a tube, plus the inner void disk,
   - an island inside a hole → outer plate, void annulus, and island.
5. `regionId = hash(sorted outer + direct-hole curve ids)`. It is stable across dimension
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
arrangement, so two crossing diagonals become four faces. `trimCurveAt` uses the same
pieces to remove the clicked segment; it materializes only the kept boundaries, replaces
the source curve, remaps constraints that still apply, adds collinearity/equal-radius
links between kept pieces, and reports constraints it had to remove. Circles still act as
whole closed loops; turning one into an arc is tracked in M9.

## 5.5 Document and persistence

`Doc` is the source of truth for a part: `schemaVersion`, an opaque document id, a name,
and an ordered `features` array. M3 has two feature types, `SketchFeature` (support plane
+ sketch) and `ExtrudeFeature` (source sketch, selected region ids, height, operation,
symmetric). The sketch is no longer React component state.

- **Plain JSON only.** Solver output (`SolveOutcome`), meshes and kernel handles are
  derived UI/kernel state. `Doc` must survive `JSON.stringify` -> `JSON.parse` and still
  rebuild identically.
- **Migrate on open.** `migrateDoc` accepts the current schema, migrates the legacy
  `{ sketch, height }` shape, and returns `null` for malformed or newer documents. App
  falls back to a fresh example rather than opening a corrupt part.
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
  statuses. It is still a single body: `new` after a base is an error, and multiple bodies
  are later. The timeline cannot create/edit a second feature yet; that is the next M3
  slice.

## 6. Rebuild engine

Input: `Doc`. Output: the final solid, its tessellation, and per-feature status.

Current split: the main thread evaluates sketches and produces ordered `KernelFeature`s;
the worker builds a single body with a prefix-solid cache and booleans.

```
main thread: features in order
  ├─ evaluate sketch: solve -> regions
  ├─ evaluate extrude: source sketch -> selected regions -> ExtrudeParams
  ├─ cache output keyed by hash(feature, upstream key)
  └─ record { featureId, status, output, diagnostics }
       ↓ successful extrudes only, in history order
worker: KernelFeature[]
  ├─ prefix cache: cacheKey -> Solid (new/join/cut already applied through this feature)
  ├─ cache hit: reuse the solid and its face origins
  ├─ cache miss: build tool -> fuse/cut -> cache the result
  └─ mesh the last good base -> BodyMesh + per-feature statuses
```

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

This is the part to test hardest. Every kernel test that edits an upstream feature and
re-runs a downstream fillet is a topological-naming regression test.

## 8. Sketch supports: faces and datum planes

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
  the active support (and the model, dimmed) to keep the sketch readable.
- A lost base face/plane errors the plane feature; every dependent sketch/feature shows
  "support lost" and uses its cached frame until reselected.

### Projected reference geometry ("On Face / On Line")

SolveSpace lets a sketch point be constrained directly to a solid face or edge. Our 2D
solver cannot see 3D, so we do the equivalent: **project the referenced face/edge into the
sketch as fixed construction geometry**, then use the ordinary 2D point-on-line,
point-on-point or coincident constraints against it.

- A projected entity stores the `TopoRef` it came from, not the resulting 2D coordinates.
  It is derived on every rebuild (after the body it references has been evaluated), so it
  tracks edits and survives topological evolution.
- Projected geometry is fixed reference geometry: it is not editable, not solver
  unknowns, and is excluded from profile extraction. It uses the same group-0 treatment
  as the origin in the `slvs` adapter.
- The supporting face's boundary is projected by default; arbitrary edges/faces can be
  picked explicitly. `brepjs` provides `drawProjection`, `drawFaceOutline` and
  `makeProjectedEdges`.
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
- Kernel output per body: triangle positions + normals, a per-vertex `faceId` attribute,
  and edge polylines with an `edgeId` per segment. All transferred as typed arrays.
  `brepjs` already provides `toBufferGeometryData`, `toLineGeometryData` and
  `toGroupedBufferGeometryData`; use them and add the face/edge ids alongside.
- **Face picking:** raycast the mesh, take `intersection.faceIndex` (triangle index),
  look up `triangleToFace[]`. No per-face meshes, no GPU id buffer needed yet.
- **Edge picking:** screen-space distance from the cursor to projected edge segments,
  threshold ~6 px. Edges win over faces when within threshold (CAD convention).
- **Highlight:** build a second geometry containing only the selected faces' triangles
  (copy those vertex ranges) and draw it with an emissive overlay material. Simple and
  fast for interactive selection counts; a `faceId`-keyed shader is the optimisation if
  it ever shows up in profiles.
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
- **Persistence:** not implemented. The intended design is `localStorage` autosave
  (debounced) + `.cad.json` export/import, with `schemaVersion` and migrations. An
  unparseable document must produce a readable error, never a blank screen.

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

## 16. What the spike actually implements

This document describes the target design. The current code is a vertical slice; here is
the honest map, so nobody assumes a layer exists because it is described above.

| Layer | Status |
| --- | --- |
| `core/doc` | Not started. The sketch + solve summary live in `useHistory`; no schema, feature list or persistence yet. |
| `core/sketch` | Real: types, `slvs` adapter, tangent-space `solveDrag`, pure drawing edits, loop extraction, geometry helpers, tests. `demo.ts` is the loadable example. |
| `core/features` | Real but narrow: one extrude. No datum planes, cuts, fillets or history replay. |
| `core/rebuild` | Not started. One sketch and one feature, rebuilt by a debounce. |
| `core/kernel` | Real: typed protocol, worker client, OCCT worker, hole validation, exact stats. |
| `viewer` | Real: Z-up scene, framing, meshing, edges. Picking and highlight are not implemented. |
| `sketch` UI | Real: full-stage sketch editor toggled from the timeline, with a floating tool strip, DOF pill, and selection/dimension/constraint inspector. Select/drag, line/rectangle/circle/arc, fillet, explicit region fills (material and void, with All/Voids/Auto), dimension tool with inline editing, constraint bar, construction toggle, snapping, auto H/V, undo/redo. |
| Feature tree | Static markup that communicates the intended product. |
| Persistence | None yet. |

Known shortcuts, all scheduled: auto region selection defaults to the largest material region
until a fill is clicked; intersecting segments are not split, so crossing diagonals are
ambiguous; face/edge picking is not implemented; datum planes and sketch-on-face are not
implemented yet (M4); history, persistence and the feature tree are M3. Unsupported
geometry and kernel features are collected in PLAN M9 with current workarounds and the
upstream SolveSpace/OCCT work each would need.

