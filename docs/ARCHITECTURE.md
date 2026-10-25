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
  | SketchFeature
  | ExtrudeFeature
  | RevolveFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature;

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
  | { id: Id; type: "distance"; a: Id; b: Id; value: Expr }      // point-point
  | { id: Id; type: "horizontal" | "vertical"; line: Id }
  | { id: Id; type: "parallel" | "perpendicular"; a: Id; b: Id }
  | { id: Id; type: "tangent"; a: Id; b: Id }
  | { id: Id; type: "equal"; a: Id; b: Id }
  | { id: Id; type: "angle"; a: Id; b: Id; value: Expr }
  | { id: Id; type: "radius" | "diameter"; curve: Id; value: Expr }
  | { id: Id; type: "pointOnLine"; point: Id; line: Id }
  | { id: Id; type: "symmetric"; a: Id; b: Id; about: Id };
```

Placement is deliberately separate from geometry:

```ts
type PlaneRef =
  | { kind: "world"; plane: "XY" | "XZ" | "YZ" }
  | { kind: "face"; ref: TopoRef; frame: Frame }; // frame is a cached last-known placement

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
  distance: Expr;
  symmetric?: boolean;
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
| arc | `addArc(g, normal, center, start, end, wp)` |
| circle | `addCircle(g, normal, center, radius, wp)` where `radius = addDistance(g, r, wp)` |
| coincident | `coincident(g, entityA, entityB, wp)` |
| point–point distance | `distance(g, ptA, ptB, mm, wp)` |
| horizontal / vertical | `horizontal(g, line, wp, E_NONE)` / `vertical(...)` |
| parallel / perpendicular | `parallel(g, a, b, wp)` / `perpendicular(g, a, b, wp, inverse)` |
| tangent | `tangent(g, a, b, wp)` |
| equal | `equal(g, a, b, wp)` |
| angle | `angle(g, a, b, deg, wp, inverse)` |
| diameter | `diameter(g, circle, value)` — note: no workplane argument |
| point on line | `addConstraint(g, C_PT_ON_LINE, wp, 0, pt, E_NONE, line, ...)` |

Circle radius and arc radius are solver variables (`E_DISTANCE` params), not just
document fields: after solving, read them back with `getParamValue(entity.param[0])`.
That is what makes a diameter/radius dimension drive the geometry.

The adapter lives in `core/sketch/solver.ts` and is the **only** file that imports
`slvs`. Everything else speaks our types.

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

### Loop finding and profiles

For extrude we need closed profiles. `core/sketch/loops.ts` currently does this:

1. Build an undirected graph over non-construction line segments and enumerate simple
   cycles by DFS (capped, deduplicated by curve set).
2. Sort by absolute polygon area; the largest cycle is the outer profile.
3. Every circle whose centre is inside that polygon becomes a hole. Clearance is the
   kernel worker's job: a crossing hole is a reported error, not silently dropped.

This is exact for the shapes the sketcher can draw today and is easy to test. It is not
a general planar arrangement: nested line loops (a rectangular pocket), disjoint regions,
and intersecting segments are not handled yet. M2 replaces it with face traversal plus
explicit region picking, at which point "largest loop" disappears.

The kernel side is already simpler than the original plan: solved loops are converted
straight to brepjs edges (`line`, `circle`) → `wireLoop` → `face(outer, holes)` →
`extrude`. No blueprints needed for straight segments and full circles. Arcs will use
`threePointArc` or the blueprint layer when they land.

Auto-constraints while drawing (snap to horizontal/vertical, coincident to nearby
endpoints, tangent continuation) are what make the sketcher feel good. They are part of
M1, not a polish item.

## 6. Rebuild engine

Input: `Doc`. Output: the final solid, its tessellation, and per-feature status.

```
features in order
  ├─ resolve any TopoRefs against the output of the feature they refer to
  ├─ evaluate (sketch: solve; extrude: wire→solid→boolean)
  ├─ cache output keyed by hash(feature input, resolved refs, upstream key)
  └─ record { featureId, status, output, diagnostics }
```

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

## 8. Sketching on a face

`PlaneRef.kind = "face"` stores both the ref and the last-known frame:

1. On rebuild, resolve the face ref. If found, derive the frame from the face's plane
   (origin = a deterministic point on the face, e.g. the projection of the previous
   origin; x-axis = deterministic in-plane axis).
2. If the face is gone, fall back to the cached frame and mark the sketch with a warning.
   Geometry stays visible, history keeps working.
3. Choosing the x-axis: take the face normal `n`, pick the world axis least parallel to
   `n`, project it into the plane, normalize. Deterministic and stable under small edits.
   A tie-break on axis order makes it fully deterministic.

Sketch-on-face also needs **projected reference geometry**: edges of the supporting face
(or of other faces) projected into the sketch as fixed construction curves. Users need
this to line new features up with existing geometry. `brepjs` provides `drawProjection`,
`drawFaceOutline` and `makeProjectedEdges`; v1 projects the supporting face's boundary,
and arbitrary edge projection lands with the rest of M4.

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
- **Sketch mode:** orthographic camera normal to the sketch plane, `slvs` on the main
  thread, and a **separate SVG overlay** on top of the canvas for sketch curves,
  dimensions, and constraint badges. SVG gives crisp lines, trivial hit-testing, and
  real text for dimension labels. Recompute the overlay's viewBox from the camera on
  zoom/pan. If entity counts ever get large, swap the curve layer to Canvas2D and keep
  SVG for labels.
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
| `core/features` | Real but narrow: one extrude. No cuts, fillets or history replay. |
| `core/rebuild` | Not started. One sketch and one feature, rebuilt by a debounce. |
| `core/kernel` | Real: typed protocol, worker client, OCCT worker, hole validation, exact stats. |
| `viewer` | Real: Z-up scene, framing, meshing, edges. Picking and highlight are not implemented. |
| `sketch` UI | Real, in a sidebar rather than a full-canvas sketch mode: select/drag, line/rectangle/circle tools, grid + point snapping, auto H/V, dimension display (demo only), undo/redo. |
| Feature tree | Static markup that communicates the intended product. |
| Persistence | None yet. |

Known shortcuts, all scheduled: profile selection is "largest loop"; line loops cannot be
holes yet; no selection or per-entity delete; dimensions are edited with sliders and only
exist on the example; the example is cleared the first time you draw; `clampDemoDrag`
keeps the example's hole inside its plate.

