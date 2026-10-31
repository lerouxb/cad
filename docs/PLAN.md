# Plan

## Strategy

Ship a **vertical slice** early: one sketch → one extrude → orbit the solid. That proves
the whole pipeline (solver → profiles → kernel → worker → renderer) and exposes the
integration problems while the codebase is still small. Depth comes after that: history,
then sketches on faces, then more features.

---

## Where we are (2026-10-31)

**M0 and M1 are done.** The app is an editable parametric sketcher:

- `slvs` loads lazily and solves real sketches. Dragging projects the cursor delta onto
  the constraint tangent space, so points slide along lines and circles, and whole lines
  translate (or stretch) instead of the drag being rejected.
- Draw with line (chain, closes on first point), rectangle (drag), and circle
  (centre + radius). Grid and point snapping; automatic horizontal/vertical constraints;
  coincident endpoints come from shared points.
- Closed profiles are extracted as **selectable regions** (faces with holes). Click a
  filled region to choose the extrude profile, Shift to add, All/Auto for all or the
  largest; multiple regions are extruded and fused. Holes and islands follow the
  containment tree. Extruded by OCCT in a worker; three.js renders the solid and its B-rep
  edges, Z-up.
- Dimension tool: distance (point-to-point, point-to-line, line), angle, diameter and
  radius, driving or reference, with inline edit/delete and draggable labels. Floating
  constraint bar: parallel, perpendicular, equal, point-on-line, point-on-circle,
  tangent, symmetric, midpoint, coincident, fix, horizontal/vertical, construction.
- Arcs: three-point arcs and a parametric corner fillet; arc loops extrude exactly as
  OCCT arc edges (not tessellated).
- Undo/redo with gesture grouping (`Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`); one drag or slider
  gesture is one step. `Esc` cancels a draft and clears the selection.
- Click curves/points to select them, Shift-click to multi-select, and Delete/Backspace to
  remove. Deletion cascades to dependent curves and constraints, and leaves no orphaned
  references. A selection card reports length/diameter/position.
- Profile faces come from a non-destructive planar arrangement: crossings and
  T-junctions split into real regions, and the trim tool removes the clicked line/arc
  segment between intersections with undo.
- The part is a plain-JSON document (`Doc` + typed features), not component state:
  migrate-on-load, autosave to `localStorage`, undoable extrude height and region
  selection, and the feature names drive the timeline.
- The example sketch can be loaded, cleared, edited, or replaced by drawing.
- `npm run verify` (110 unit tests) and `npm run e2e` (19 tests) are green. The e2e asserts
  exact volumes, arcs, fillets, angular/radius dimensions, label dragging, constraints,
  reference-frame constraints, exact point coordinates, draws, selects/deletes, and
  undoes. The suite reuses a worker-scoped page, so the WASM is loaded twice (2 workers)
  instead of once per test.

Numbers from the running app: a drawn 115×75×12 plate with a Ø30 hole is
95 017.7 mm³ and rebuilds in ~35 ms after warm-up.

**Still temporary** (all scheduled below): auto mode defaults to the largest region until
you click one; trim handles lines/arcs but not circles; face/edge picking is pending;
**datum planes and sketch-on-face are M4**; the feature tree is still the fixed two-step
timeline (rename/reorder/suppress are the next M3 slices); the rebuild engine still runs
one sketch + one extrude, without prefix caching or per-feature diagnostics. Free 3D
sketches, splines/text/images and drawing exports remain out of scope.

---

## Feature coverage vs SolveSpace (sanity check)

Checked against SolveSpace's actual menu/group inventory **and** the 3:13 homepage demo
video (frames extracted at 2 s intervals). The headline gap was **sketch supports**: a
sketch is currently always on XY. Datum planes now move into M4 and become a history
feature, not a sketch property. The demo also makes one more gap explicit: sketch points
must be constrainable to **existing solid faces and edges**, which is how the gusset is
anchored between the inner walls.

| SolveSpace feature | Our status |
| --- | --- |
| New group: sketch in workplane | **Gap → M4**: datum planes (offset, midplane) |
| Sketch on a planar face | **Gap → M4**: `PlaneRef.kind = "face"` |
| Sketch in a midplane / symmetry plane between faces | **Gap → M4**: `midplane` datum plane (or reuse the original plane of a symmetric extrude) |
| Constrain a point to a solid face/edge ("On Plane", "On Line") | **Gap → M4**: live projected reference edges/points as fixed construction geometry, then point-on-line/coincident |
| Sketch anywhere in 3D (3D lines/constraints) | Not implemented: the document/solver are 2D-plane. See M9; needed for 3D sweep paths and free 3D sketches. |
| Datum point / workplane | Planes M4; datum points/axes M6 (needed for through-3-point planes and revolve axes) |
| Line, construction line, rectangle, circle | Done |
| Arc (3-point, tangent at point) | Done — three-point arcs + a parametric corner fillet |
| Cubic Bézier | `slvs` has `E_CUBIC`; our app does not expose it yet. See M9. |
| General B-splines / NURBS | Not in `slvs`; M9 upstream work (kernel side is easy, solver side is not) |
| Ellipses, parabolic/hyperbolic arcs, conic sections | Not in `slvs`; M9 upstream work. Approximate with lines/arcs for now. |
| Sketch text / images | Not implemented; M9 |
| Expressions / spreadsheets | M7 (app-level; `slvs` only receives numeric values) |
| Split curves at intersection / trim | M2.6 (done) |
| Distance (point-point, point-line), angle, diameter, radius, reference dimensions | Done |
| Angle / reference angle | Done (dimension tool) |
| Horizontal, vertical, parallel, perpendicular, equal, point-on-line | Done |
| Midpoint, symmetric, tangent | Done |
| Lock point where dragged / fix | Done |
| Extrude, one-sided | Done |
| Two-sided / symmetric extrude | M3 (`symmetric`) |
| Through-all / up-to-face extrude end condition | M3 blind + through-all; up-to-face in M4 (needs `TopoRef`) |
| Boolean union / difference (join / cut) | M3 |
| Revolve / lathe | M6 |
| 3D fillet / chamfer | M5 (OCCT/`brepjs`, not a `slvs` gap) |
| Loft / sweep | M6 (OCCT; a 3D sweep path also needs the M9 3D-curve work) |
| Draft | Not planned yet; M9 |
| Shell / thickness / offset | M5 shell; offset/thicken M9 |
| Linear/circular patterns, feature/body mirror | M6; sketch symmetry constraint is done. Mirror is high priority. |
| Hole/thread feature | Circle + cut extrude now; M6/M9 |
| Helix (threads/springs) | M6 optional |
| Link / assemble | M8 |
| Measure volume / area / perimeter / centre of mass | Volume in stats; the rest M5 |
| Interference / naked edges | M5/M8 optional |
| STEP / STL export | M5 |
| DXF / SVG / PDF, trace, step-dimension | Deferred / out of scope |

Two workflow points from the demo are already explicit in the plan: one sketch reused by
several operations (M2 regions + M3 feature references) and reading dimensions without
driving (reference dimensions, done).

### Reference workflow: the demo's angle bracket

This is the end-to-end acceptance scenario we should be able to reproduce. Timestamps are
from the homepage video.

1. **0:00–0:50 — profile sketch.** Empty XY workplane. Draw the L-shaped profile with
   line segments; horizontal, vertical, perpendicular, parallel and equal constraints;
   live distance dimensions. *(Done in M1.)*
2. **0:50–1:14 — the gusset, sketched "between the walls".** After extruding the bracket
   two-sided, start a new sketch in the **symmetry plane** of the body — the original
   profile plane, which is the midplane between the two side faces. (With a one-sided
   body this would be a datum midplane between the side faces.) Draw a triangle whose
   vertices are constrained **onto the solid's inner corner and inner flange faces/edges**.
   The extrude starts one-sided, is switched to **two-sided**, and is **unioned** into the
   body.
   *(The triangle is not on a face. It is in a plane in empty space, anchored to the
   solid. This is the feature the transcript calls "sketch between surfaces".)*
3. **1:28–2:12 — mounting holes on a face.** New workplane on the upright flange face.
   Draw two circles with equal radius, symmetry about the face's vertical centreline, and
   distance dimensions. **Cut** extrude through the flange.
4. **2:36–3:04 — edit early history.** Return to the first sketch, replace the sharp inner
   corner with a tangent arc (Ø25), add tangent + perpendicular constraints and a 90°
   angle dimension. The bracket, gusset and holes rebuild downstream.
5. **3:10 — group tree.** `g001-#references`, `g002-sketch-in-plane`, `g003-extrude`,
   `g004-sketch-in-plane`, `g005-extrude`, `g006-sketch-in-plane`, `g007-extrude`: three
   sketches, three features, all editable.

Our equivalent of SolveSpace's direct "On Face / On Line" constraints is to project the
referenced faces/edges into the sketch as **live fixed construction geometry** (derived
from a `TopoRef` on every rebuild, never stored as user geometry), then use ordinary
point-on-line / coincident constraints. This keeps the 2D solver pure and makes the
reference survive edits through topological naming.

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

## Done: M1 — The real sketcher

The most UX-sensitive milestone: solver, drawing loop, selection, dimensions, arcs and
the full constraint set.

- [x] Tools: line (chain), rectangle, circle, three-point arc; select mode; grid + point
      snapping; automatic coincident endpoints (shared points) and horizontal/vertical
      constraints
- [x] **Drag projection**: cursor delta projected onto the constraint tangent space
      (analytic Jacobian + weighted Kaczmarz), so points slide along circles and angled
      lines. A fully constrained sketch refuses to move.
- [x] Undo/redo with gesture grouping; DOF readout and fully-constrained colouring;
      conflict display
- [x] Sketch origin as a group-0 fixed entity; construction geometry
- [x] Zoom (wheel), pan (middle/right, or select-drag on empty space), double-click fit
- [x] Drag primitives: points, whole lines (both endpoints), circles (grab offset, radius
      fixed), arcs (centre + endpoints); 3 px threshold so a click does not nudge them
- [x] Keyboard: `V/L/R/C/A/D`, `Esc`, `Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`
- [x] **Selection + deletion**: click curves/points, delete, multi-select, then entity
      property panel. Selection is ephemeral UI state; deletion is a pure sketch edit in
      `core/sketch/edit.ts` and is covered by unit + e2e tests.
- [x] **Dimension tool**: click two points, a point + line, two lines, or a circle/arc →
      place the dimension; inline edit/delete and draggable labels; driving vs reference.
- [x] Reposition an existing dimension label (drag; one undo entry per gesture)
- [x] Angular, point-to-line, radius and point-to-point dimensions
- [x] **Constraint bar**: parallel, perpendicular, equal, point-on-line, point-on-circle,
      tangent, symmetric, midpoint, coincident, fix, horizontal/vertical, plus construction
      geometry, applied from the floating selection card and shown as badges
- [x] Angle, tangent and symmetric constraints; radius as a dimension
- [x] Midpoint constraint UI (point + line → at midpoint); point-on-circle
- [x] A real "fix point" constraint (SolveSpace's lock-where-dragged)
- [x] Coincident constraint action for points that are near but not identical (drawing
      still snaps exact/shared points)
- [x] Arc tool (three-point) + a parametric corner fillet, plus exact line/arc loops in
      profile extraction (`ProfileLoop.kind = "path"`, OCCT `threePointArc` edges). A corner
      still used by construction geometry or an anchor is kept as a construction point
      on both trimmed lines' infinite lines, so the diagonal and origin coincidence
      survive the fillet
- [x] Selectable fixed **origin and X/Y axes**; constrain/dimension to them (coincident,
      point-on-line, parallel/perpendicular, point-line distance, angle)
- [x] Exact X/Y coordinate editing for a selected point (same constrained projection as
      dragging); a fully constrained point refuses the edit

**Done when:** you can draw a rectangle from scratch, dimension it with real dimension
annotations, drag it, see it become fully constrained, delete an entity, then undo
everything back to empty. You can also draw an arc, fillet a corner, dimension an angle,
a point-to-line distance, or a radius, and drag any dimension label. (The conflict state
is still only reachable through inconsistent edits, not through a "break this
constraint" interaction.)

The old M1 list also had `core/doc` and "move the sketch into the document store". Those
are prerequisites for history, not sketcher UX, and only make sense once features and
rebuild exist; they are tracked at the top of M3.

## M2 — Profiles and solids (the spike covers ~70%)

- [x] Worker client + protocol, init handshake, latest-wins rebuilds
- [x] Extrude evaluator: polygon/circle loops → wire → face → solid, with validation
- [x] Tessellation via `toBufferGeometryData` / `meshEdges`, transferred to the main thread
- [x] Shaded solid + dark B-rep edges, Z-up, auto-framing
- [x] `core/sketch/loops.ts`: graph → simple cycles → face filtering (a cycle containing
      a smaller cycle that shares an edge is a subdivision, not a face) → containment tree
      (even depth material, odd depth holes) → selectable regions, with tests
- [x] Region picking in the sketch UI: translucent fills with holes, click/Shift-click,
      and an **All / Auto** panel. The active regions are highlighted and previewed in 3D
- [x] `regionId = hash(sorted outer + direct-hole curve ids)`; stable across dimension
      edits and invalidated when a boundary changes
- [x] Multiple regions per extrude. The worker extrudes each region and fuses the solids
      (`fuseAll`), so disjoint regions become one body
- [x] Deeper nesting: a hole can contain an island, which is a separate depth-2 region
- [x] Split curves at intersections / trim while sketching — implemented in M2.6
- [ ] Full planar face traversal: intersecting segments without a shared endpoint are not
      yet split, so crossing diagonals are still ambiguous
- [ ] Rebuild goldens: several profiles → bbox/face-count assertions (volume is covered by
      the multi-region e2e)
- [ ] Face/edge picking + hover/selection highlight (`faceGroups`/`edgeGroups` are already
      in the mesh payload but unused)

**Done when:** you can draw an arbitrary multi-region sketch, click one or more regions
(including holes and islands), and extrude/fuse them with exact volume. Auto mode still
defaults to the largest region until you click; M2.6 adds split/trim.

## M2.5 — UI foundations: paper/ink visual system (2–3 days)

Use `docs/mockups/` as the design target without importing it into `src/`. This is a
visual and interaction-layer pass only; it must not invent history steps, support pickers,
exports or file screens before their models exist.

- [x] Theme tokens and typography from the mockups: paper/ink day and night palettes,
      one highlighter colour (yellow/pink/blue/green), persisted in `localStorage`
- [x] App header: document identity, current mode/action, solver/kernel health, theme
      and highlighter controls; keep the current extrude/undo/redo controls
- [x] Restyle the timeline as the primary structure, but keep only the two real steps
      (Sketch 1 → Extrude 1); no fake feature cards or rollback states
- [x] Sketch canvas palette: ink geometry, highlighter selection/current state, themed
      grid, dimensions, constraint badges, snap/hover, construction/reference styling
- [x] Panels and controls: tool strip, selection/dimension inspector, DOF/status line,
      region panel, dimension editor, viewport stats/messages — thin rules over boxes
- [x] Viewer theme: background, grid, lights, body material and B-rep edges for day/night
      (the mockup's technical-drawing look is a later refinement, not required here)
- [x] Preserve all existing `data-testid`s and behaviour; add a theme e2e smoke test
- [x] Keep `docs/mockups/` static: do not import its CSS/JS, do not wire it into `src/`

**Done.** The current loop is coherent in day and night, the choices persist, and no
placeholder history/support/export UI was added. The mockups' technical-drawing model
refinement stays deferred.

**Done when:** the current sketch → model loop is visually coherent with the mockups in
both day and night, the theme/highlighter choices survive reload, and no placeholder
history/support/export UI has been added.

## M2.6 — Split at intersections / trim (2–3 days)

The biggest remaining profile-correctness gap: intersecting segments without a shared
endpoint do not yet split the graph.

- [x] Planar arrangement: split line/arc segments at intersections, create real vertices,
      and rebuild adjacency from the split segments
- [x] Trim tool: remove the clicked segment between intersections/boundaries, with undo
- [x] Region extraction: crossing diagonals become real faces (four faces for two
      diagonals), and trim/curve splits invalidate the right regions
- [x] Tests: split line/line and line/arc; trim while preserving constraints where
      possible; crossing-diagonal face/area cases; e2e trim + extrude
- [x] Keep construction geometry excluded, and do not silently drop constraints: mark
      or remove them explicitly when a split changes the geometry

**Done.** `planarArrangement` is non-destructive and region extraction consumes it;
trim materializes only the cuts it keeps, remaps h/v, parallel/perpendicular, angle,
point-on-line/circle, tangent and diameter constraints where the kept geometry still
supports them, and reports any constraint it had to remove. Circles remain whole-region
candidates rather than being trimmed into arcs.

## M3 — History (4–6 days)

**In progress.** The document store, migrations, autosave, feature names, undoable
extrude height and region selection are in. The ordered rebuild engine/cache, feature
tree editing, and multi-feature booleans are next.

- [x] `core/doc`: feature/document schema (`Doc`, `schemaVersion`, ids, migrations) and
      move the sketch out of component state into the document store — prerequisites for
      history, deliberately deferred from M1
- [ ] `core/rebuild`: ordered evaluation, per-feature status, prefix cache, generation
      counters, cancellation of stale results
- [ ] Feature tree UI: select, rename, reorder (drag), suppress, delete
- [ ] Feature edit dialogs (extrude distance/symmetric/operation/end condition)
- [ ] Rebuild-on-edit with stale-while-rebuilding rendering
- [ ] Error states in the tree with clickable diagnostics
- [ ] Persistence: autosave to localStorage, `.cad.json` export/import, migrations
- [ ] Cut/join extrudes; a second feature on the same body
- [ ] Extrude end conditions: blind, through-all, and (M4) up-to-face; symmetric/two-sided
- [ ] First `TopoRef` plumbing: `assignRoles` on feature outputs, `captureHint` /
      `createRef` for selections, `updateRoles` on evolution records; refs stored as JSON
- [ ] Rebuild test: edit sketch 1, assert feature 2's volume changes and nothing else did

**Done when:** a two-feature part survives an edit to the first sketch, save/reload, and
undo/redo — with correct geometry every time.

## M4 — Sketch supports: datum planes and faces (7–9 days)

A sketch support is resolved from references, then given a stable frame. Datum planes
come first: they cover "sketch in thin air" and share the resolution/recovery machinery
with face sketches.

### Datum planes

- [ ] `DatumPlaneFeature` in the document (a history step, no body):
      `offset(base: PlaneRef, distance: Expr)` and `midplane(a: PlaneRef, b: PlaneRef)`
- [ ] Resolve offset: origin = base origin + base normal × distance; keep the base frame's
      axes. `base` can be a world plane, a face, or another datum plane (chains).
- [ ] Resolve midplane: both bases must be parallel; origin = midpoint, axes from the
      first. Non-parallel bases produce a visible feature error.
- [ ] Offset from XY is the "thin air" case; a midplane between two parallel faces is the
      other one. Both follow their bases when history changes.
- [ ] Timeline rows for planes; edit distance / swap midplane bases; suppress/delete with
      dependent-feature errors.
- [ ] Render planes in 3D (translucent quad + axes), pick them to start a sketch, and hide
      inactive ones while sketching.
- [ ] Sketch-support picker: world plane / planar face / datum plane. The sketch stores
      `PlaneRef` + last-known frame; a lost reference errors the sketch visibly.
- [ ] Through-3-points and angled planes after datum points/axes land (M6), unless needed
      sooner.

### Sketches on faces

- [ ] Face → `TopoRef` on selection; `PlaneRef.kind = "face"`
- [ ] Deterministic face frame (origin, x-axis) + cached frame fallback
- [ ] Sketch on a planar face of a solid; camera aligns to the face normal
- [ ] Project the supporting face's boundary into the sketch as fixed construction
      geometry (`drawFaceOutline`); project arbitrary edges (`drawProjection`)
- [ ] **Live reference geometry**: a projected point/line/face outline stores the `TopoRef`
      it came from and is re-derived on every rebuild, never persisted as sketch geometry.
      This is our equivalent of SolveSpace's "constrain point On Face / On Line" and is
      what lets a gusset sit in the midplane and stay welded to the inner walls.
- [ ] Projected references participate in the solver as fixed (group-0-like) entities, so
      point-on-line / point-on-point / coincident constraints work against them
- [ ] `resolveRef` on rebuild: exact → fallback → lost-ref error with "reselect"
- [ ] Handle flipped face normals and sketches created on the "back" of a face
- [ ] Topological-naming regression test: change base height, boss on top face follows
- [ ] UI: unsupported (curved) face → clear explanation, no broken state

**Done when:** sketch on an offset plane in empty space; sketch on a midplane between two
faces; change the offset or the base plate height and every dependent sketch/feature
follows; deleting a base face produces a visible, recoverable error.

**Demo acceptance (with M1+M3):** build the angle bracket from the video — L profile →
extrude → gusset triangle in the symmetry plane, anchored to projected inner edges →
two-sided union extrude → two holes on the flange face, cut through — then edit the first
sketch (tangent arc + angle) and have the solid, gusset and holes rebuild correctly.

## M5 — Refinement features (4–5 days)

- [ ] Fillet (constant radius) on selected edges, with failure handling
      (`filletWithEvolution` so downstream refs survive)
- [ ] Chamfer
- [ ] Shell (open faces) — maybe defer
- [ ] Selection UX: edge chain selection, box select where sensible, hover prehighlight
- [ ] Measure tool (distance, angle, radius, area, perimeter, centre of mass)
- [ ] Export STL + STEP from the worker

**Done when:** you can fillet the four vertical edges of a plate, then change the plate
size and the fillets survive.

## M6 — More shape (1–2 weeks, can reorder)

- [ ] Revolve
- [ ] Loft / sweep (profile + path)
- [ ] Linear and circular patterns
- [ ] Mirror (feature and body)
- [ ] Datum axes and points (revolve axes, through-point planes, sweep paths)
- [ ] Helix (threads, springs) — optional
- [ ] General body booleans (beyond extrude join/cut)

## M7 — Parameters (3–4 days)

- [ ] Named parameters with units; `Expr` evaluation + dependency ordering
- [ ] Expression editing on every dimension field
- [ ] Parameter table UI, rename with reference updates
- [ ] Cycle detection with a clear error

## M8 — Later / maybe never

Assemblies and joints, drawings, STEP import, curved-face sketches, sheet metal,
collaboration, plugin API.

## M9 — TODO: unsupported features and upstream SolveSpace work (unscheduled)

This is the honest limitations list, not a delivery milestone. It separates three kinds of
gap:

- **solver/entity gaps** — need `slvs` (or a different sketch solver); good upstream
  SolveSpace contributions;
- **kernel/feature gaps** — OCCT/`brepjs` can already do these, but our feature layer does
  not expose them yet;
- **app-level gaps** — expressions, document/feature support, text/images.

Based on the FreeCAD/SolveSpace comparison supplied with the demo transcript and the demo
itself. Nothing here is promised for v1; promote an item only when it moves into a real
milestone.

### Solver/sketch entity gaps

| Feature | Limitation today | Workaround today | What it needs | Target |
| --- | --- | --- | --- | --- |
| Ellipse | No entity in `slvs` (only lines, arcs, circles, cubic Béziers) | Circle/arc approximation | Ellipse entity + constraints; profile extraction; OCCT ellipse wire | M9 **upstream** |
| Parabolic/hyperbolic arcs, general conics | No conic entity/constraints | Line/arc approximation | Conic entity + constraints; profile/kernel wire | M9 **upstream** |
| General B-spline / NURBS | `slvs` has cubic Bézier, not general B-splines | Line/arc chain | B-spline entity + constraints; profile/kernel NURBS wire | M9 **upstream** |
| Cubic Bézier | `slvs` has `E_CUBIC`; our document, tool, profile extraction and kernel path do not | Line/arc chain | Adapter + tool + profile/path + kernel `bezier` wire | M9 **app** (solver already has it) |
| Free 3D sketch entities and 3D constraints | Document/solver are 2D-plane | Use a planar workplane (M4) | 3D document representation, solver plumbing, 3D picking/plane inference | M9 **upstream + app** |
| Expression-driven dimensions | Numeric values only in `slvs` | Fixed numbers | App-level `Expr` evaluation before solving; M7 | M7 (no solver change) |
| Ellipse/conic/spline tangency and curvature constraints | Not available | Approximate with arcs/lines | Upstream constraint equations | M9 **upstream** |
| Sketch text/images | No entity or profile handling | None | Text/image entities + profile extraction | M9 **app** |
| Offset/trim sketch curves | Trim is M2; offset is not planned | Manual construction | Curve trimming/offset + profile rebuild | M2/M9 |
| 3D assembly constraints/joints | No assembly model | M8 | Assembly solver/joints | M8 |

### Kernel/feature gaps (not blocked on `slvs`)

| Feature | Limitation today | Workaround today | What it needs | Target |
| --- | --- | --- | --- | --- |
| 3D edge fillet/chamfer | Only 2D sketch fillets before extrude | Draw the fillet into the sketch | `brepjs`/OCCT fillet/chamfer with evolution, feature UI | M5 |
| Loft | Not implemented | Multiple extrudes/manual blends | OCCT loft between sections | M6 |
| Sweep along a path | Not implemented | Planar sweep not yet; 3D path impossible | OCCT pipe/sweep; 3D path needs the M9 3D-curve work | M6 (planar) / M9 (3D) |
| Feature/body mirror, linear/polar patterns | Sketch symmetry constraint exists; no feature transforms | Duplicate/rotate sketches/features manually | Feature transforms + history pattern feature | M6 — **mirror is high priority** |
| Draft for moulds/castings | Not implemented | None | OCCT draft on selected faces + neutral plane | M9 (promote to M5 if needed) |
| Shell / thickness / offset | Shell is planned M5; offset/thicken not | Nested sketches and holes | `brepjs` shell/offset/thicken, open-face selection | M5/M9 |
| Hole/thread feature | Circle + cut extrude | Manual circle/cut | Hole profiles, standard sizes, helix/thread | M6/M9 |
| Text/images in sketches | Not implemented | None | Text/image entities and profiles | M9 |
| 3D curves for sweeps | Solver/document gap (above) | Planar path only | 3D curve entity + constraints | M9 |
| Drawings, assemblies | Not implemented | M8 | Separate modules | M8 |

### Upstream SolveSpace wishlist (give back)

`slvs` is GPLv3, and our adapter (`core/sketch/solver.ts`) is deliberately the only file
that imports it. That makes it practical to contribute upstream without spreading the API
through the app.

1. **Entity/constraint coverage:** ellipse, parabolic/hyperbolic conic, general B-spline
   (or NURBS), 3D curves; corresponding tangency/curvature/position constraints. This is
   the largest piece and would let us drop the line/arc approximations.
2. **Safer JS/WASM bindings:** the `.d.ts` has wrong signatures for `symmetric` and
   `midpoint`; `tangent` calls `Platform::FatalError` and kills the whole WASM instance if
   the arc/line do not share an endpoint. Expose validation/errors, correct the typings,
   and add binding tests.
3. **Cubic Bézier first:** `E_CUBIC` already exists. Exposing it in our adapter, tool,
   profile extraction and OCCT path is lower risk than waiting for B-splines.
4. **Docs/tests:** add a small JS binding test suite and examples for arc normals, group-0
   reference geometry, 3D constraints and constraint failure reporting.
5. **Coordinate with upstream:** file issues before large PRs; keep changes GPLv3
   compatible; do not add a second solver without an ADR.

### Priority notes

- **Mirror/symmetry** is high-use; pull the M6 feature/body Mirror forward into M5 if M6
  slips. The sketch **symmetric** constraint already covers 2D symmetry about a line.
- **3D fillet/chamfer and shell** are M5; they are OCCT features, not solver gaps.
- **Expressions** are M7 and app-level; they do not require touching `slvs`.
- **Ellipses/conics/B-splines** are research/upstream work. Use line/arc approximations
  until they are promoted; do not pretend they are exact.
- If **3D sweeps** become a requirement, prioritize free 3D curves and 3D constraints
  before loft/sweep; otherwise plan only planar sweeps.
- **Draft, threads, text/images and drawings** are later. Promote one at a time with an
  ADR, a milestone, and numeric tests.

**Done when:** an item is promoted out of M9 into a real milestone or ADR with tests. M9
itself stays documentation-only.

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
