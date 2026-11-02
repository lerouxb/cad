# Plan

## Strategy

Ship a **vertical slice** early: one sketch → one extrude → orbit the solid. That proves
the whole pipeline (solver → profiles → kernel → worker → renderer) and exposes the
integration problems while the codebase is still small. Depth comes after that: history,
then sketches on faces, then more features.

## Design contract (from the studies; the prose is final)

The mockup HTML/CSS is illustrative. The **index and notes prose** are the design rules.
The app should feel like an annotated drawing on paper, not a dashboard.

1. **Typography carries the interface.** Feature names, dimensions and states are set as
   type. Thin rules instead of cards; boxes only when a decision needs a boundary. Sans
   for prose, serif for names/titles, mono for labels/values/controls.
2. **One highlighter, used for state.** Yellow, pink, blue or green; one at a time. It
   means current, selected or changed. It is never decoration.
3. **Day and night are the same system, inverted.** Every surface must work in both.
4. **The timeline is the only permanent structure.** No sidebar, ribbon or mode switcher.
   Selecting a step changes the stage; editing a step is the same gesture. Every step has
   an editable name.
5. **Controls appear where the decision is.** Tools only in sketch mode; a dimension
   editor at the dimension; support choices only when starting a sketch; export is a page
   because it is the end of the job.
6. **One contextual surface: the draggable stage popover.** Forms and transient
   decisions (extrude parameters, support choice, pattern/mirror/offset, file browser,
   body appearance, error recovery) live in a floating paper note over the stage. It is
   draggable by its header, stays where it was moved, and is clamped inside the stage.
   Every popover ends with one footer: a one-line summary of what will happen, then a
   quiet `cancel`, then the primary `apply` (or the verb of the operation); a destructive
   action is quiet and separated. Editing reopens the identical popover pre-filled, and
   `cancel` restores the values from when it opened. It never becomes a permanent
   sidebar. The timeline detail line is a **summary + actions**, not a form; the stage
   foot is a readout (state and view only). This resolves the studies' inconsistency
   (03 put feature parameters in the detail line; 04–08 and the showcase used floating
   notes).
7. **The background is a tool.** The sketch grid is the snap grid. Its step adapts to the
   zoom (and can be entered free-form), the scale bar shows one cell, and snap can be
   switched off while the grid stays as a reference. No wallpaper texture.
8. **One home for every fact.** Document identity, undo/redo and appearance in the
   header; creation actions on the selected sketch or support; history/names/summary in
   the timeline, feature parameters in the popover; solver/body health in one stage
   status line; tools, selection and view in the stage corners. Nothing repeats.
9. **Separate the study from the app.** The mockup bar is not app chrome. Appearance is a
   quick-access app setting in the header; a future settings surface can hold the rest.
10. **Typography is a contract.** Three families, eight app roles, one separate editorial
    layer for design pages. No raw type values outside the token block; run the audit
    before calling a UI change done.

**No red errors.** Failure is ink, a dotted rule and a single “!”; the highlighter is
reserved for the active choice. A failed step stays in history and the last good body
stays on the page.

**Immediate priority:** the design-fidelity pass (M2.8) comes before more M3 chrome. The
goal is that the current sketch → model loop already looks and reads like the studies;
feature work then lands inside that system.

---

## Where we are (2026-10-31)

**M0 and M1 are done.** The app is an editable parametric sketcher:

- `slvs` loads lazily and solves real sketches. Dragging projects the cursor delta onto
  the constraint tangent space, so points slide along lines and circles, and whole lines
  translate (or stretch) instead of the drag being rejected.
- Draw with line (chain, closes on first point), standalone point, rectangle (drag), and
  circle (centre + radius). Grid and point snapping; automatic horizontal/vertical
  constraints; coincident endpoints come from shared points.
- Closed profiles are extracted as **selectable regions** (faces with holes). Click a
  filled region (including a hole's void profile) to choose the extrude profile; Shift
  adds, All selects material, Voids selects negative space, and Auto returns to the
  largest material face. Multiple regions are extruded and fused. Holes and islands
  follow the containment tree. Extruded by OCCT in a worker; three.js renders the solid and its B-rep
  edges, Z-up.
- Dimension tool: distance (point-to-point, point-to-line, line), angle, diameter and
  radius, driving or reference, with inline edit/delete and draggable labels. It is
  entered contextually from the selection popover; the top line no longer carries
  dimension/trim. The selection popover also offers parallel, perpendicular, equal,
  point-on-line, point-on-circle,
  tangent, symmetric, midpoint, coincident, fix, horizontal/vertical, construction,
  dimension and trim.
- Arcs: three-point arcs and a parametric corner fillet; arc loops extrude exactly as
  OCCT arc edges (not tessellated).
- Undo/redo with gesture grouping (`Cmd/Ctrl+Z`, `Shift+Cmd/Ctrl+Z`); one drag or slider
  gesture is one step. `Esc` cancels a draft and clears the selection.
- Click curves/points to select them, Shift-click to multi-select, and Delete/Backspace to
  remove. Deletion cascades to dependent curves and constraints, and leaves no orphaned
  references. A selection popover reports length/diameter/position and offers the
  immediate constraint/dimension/trim actions.
- Profile faces come from a non-destructive planar arrangement: crossings and
  T-junctions split into real regions, and the trim tool removes the clicked line/arc
  segment between intersections with undo.
- The part is a plain-JSON document (`Doc` + typed features), not component state:
  migrate-on-load, autosave to `localStorage`, undoable extrude height and region
  selection, and the feature names drive the timeline.
- The main-thread rebuild is ordered and cached: sketch features solve and extract
  profiles, extrude features resolve their source and regions, and every feature gets a
  status/diagnostics record. A height edit reuses the sketch result; a sketch edit
  invalidates the extrude. The worker receives the ordered extrude list, caches prefix
  solids by feature cache key, applies new/join/cut booleans, and returns per-feature
  build statuses.
- The example part can be loaded, cleared, edited, or replaced by drawing. It is the
  dimensioned plate, a suppressed “Center pin” extrude from the **same Sketch 1** (the
  central hole's void region as a cylinder), a second “Mounting holes” sketch and a
  suppressed through-all cut. The two suppressed features keep the familiar plate and
  picking goldens while exercising same-sketch region ownership, a second sketch,
  suppression, edits and the 3D sketch overlay. A new sketch is added from the timeline's
  `+ sketch` support popover (world XY/XZ/YZ, planar faces and datum planes) and
  `+ plane` geometry. A new extrude is
  started from the selected sketch step and begins with **no profile selected**; the
  draft only becomes a history feature after at least one profile and the parameters are
  applied. Existing extrudes are edited by selecting their step.
- `npm run verify` (187 unit tests) and `npm run e2e` (63 tests) are green. The e2e asserts
  exact volumes, arcs, fillets, angular/radius dimensions, label dragging, constraints,
  reference-frame constraints, exact point coordinates, draws, selects/deletes, and
  undoes. The suite reuses a worker-scoped page, so the WASM is loaded twice (2 workers)
  instead of once per test.

Numbers from the running app: a drawn 115×75×12 plate with a Ø30 hole is
95 017.7 mm³ and rebuilds in ~35 ms after warm-up.

**Still temporary** (all scheduled below): auto mode defaults to the largest material
region until you click one; trim handles lines/arcs but not circles; support-list detail
copy and through-3-point planes are the remaining M4/M6 support pieces. M3 is done: the history supports
create/edit/reorder by drag/suppress/delete/rollback, a local file menu/list with
copy/open/download/rename/new, blind/symmetric/through-all extrudes, and role propagation
through booleans, with the multi-feature rebuild covered by e2e. Free 3D sketches,
splines/text/images and drawing exports remain out of scope.

---

## Design audit — real usage (2026-11-02)

The reference part (`Disqo / rounded-square`) was read through the Fusion MCP: **113
timeline steps, 14 sketches, 17 components**, nothing suppressed. It is an **assembly**,
not a single body: vendor STEP parts are inserted as components, rigid-grouped, and the
case is cut around them. The full table lives in
[`docs/showcase/BACKLOG.md`](showcase/BACKLOG.md).

Usage that changes priorities:

| Feature | Uses | Consequence |
| --- | --- | --- |
| Sketch | 14 | done (M1) |
| Extrude | ~38 | done; options in M3/M4 |
| **Offset Faces** | **11** | **reversed from Drop to Keep** (M5/M6); every use is tolerance/fit |
| Chamfer / Fillet | 6 / 5 | M5 |
| Combine | 6 | M6, confirmed used |
| Construction plane | 4 | M4 (offset/midplane in) |
| Mirror / Rectangular pattern / Circular pattern | 4 / 2 / 1 | M6, confirmed used |
| Shell | 1 | M5 |
| Split Body / Move | 1 / 1 | M6, confirmed used |
| Component insert | 6 | M8 assembly layer |
| Rigid Group / Snapshot | 1 / 2 | M8 assembly layer; Snapshot was previously unplanned |
| Timeline group | 10 | Keep, M3/M6 timeline refinement |

Conclusions incorporated below:

1. **Offset Faces is Keep**, not Drop; it is the third most-used modelling feature after
   extrude and chamfer.
2. **The real workflow is an assembly.** Single-body scope is the largest structural gap
   between this plan and the part it is meant to make.
3. **M6 patterns/mirror/combine/split-body are confirmed**, not speculative.
4. **Timeline groups are part of the workflow**, used 10 times.
5. **Not used in the reference part:** revolve, loft, sweep, draft, hole/thread,
   primitives, thicken, boundary fill, delete/replace face. Those stay Low/M9/Drop.

---

## Mockup coverage audit (2026-11-01)

`docs/mockups/` is the design target; this table keeps every study traceable to a
milestone. The mockups themselves stay static and are never imported by `src/`.

| Study | Where it lands |
| --- | --- |
| 01 history | **M3**: feature tree/active step (done), rename (done), status (done), rollback/scrub with paused downstream steps + roll forward, selected-step summary line, delete step. |
| 02 sketch | **M1/M2** (done): geometry, dimensions, inline editing, constraints, reference dimensions. **M2.7** (done): point tool. **M2.8**: adaptive/free-form grid step, snap on/off independent of grid, scale bar, 50/100/200/fit zoom menu, contextual selection line, type-token audit. **M2.9**: rectangular/lasso profile selection. **M4**: dashed fixed projected references + project tool. |
| 03 model | **M3**: selected-feature summary line (distance/direction/operation/profile), a draggable parameter popover, and edit/suppress/delete. **M5**: selecting a feature highlights the geometry it created; body health line (1 body · 1 shell · faces · watertight); overall dimensions drawn on the model. |
| 04 support | **M3**: `+ sketch` opens an explicit support popover. **M4**: world planes / planar faces (done), datum planes, hover/select preview on the dimmed body, curved faces explained, cached frame, reselect recovery. |
| 05 export | **M5**: export is a page over the visible model, generated from the current rebuild; body/watertight/shell/open-edge/normal checks, units/scale/triangles/file size, build-volume fit, one export action; STL + STEP. |
| 06 errors | **M3**: failed step stays visible, last-good body stays on stage, diagnostics name the step and lost reference, recovery actions (reselect / open sketch / revert). **M4**: TopoRef loss + cached frame. Error style is ink + dotted rule + “!”, not red. |
| 07 files | **M3 persistence**: filename as the file menu, download/open `.cad`, make a copy, rename, local file index with step/body counts and modified time, new file, offline-only. |
| 08 body | **M5**: body appearance (material + finish) attached to the body-creating feature; later join/cut keep it; timeline summary; decide whether appearance is document data or presentation-only. |
| TYPOGRAPHY.md | **M2.5** (done): families/roles/themes. **M2.8**: port the token contract into `src/app/app.css` and extend `check-typography.mjs` to audit the app CSS as well as the mockups. |

Notable conflict: mockup 02 gives the **project** tool the `P` shortcut, but the point
tool now owns `P`. M4 must pick another shortcut for project (or deliberately move the
point tool) rather than duplicating it.

`docs/showcase/` is an additional design study for **rectangular pattern, circular
pattern, mirror and offset** in the sketch. It is promoted to **M6.0** with **ADR-0004**:
stored parametric operations, derived instances, and re-editable parameters (Fusion-like),
not one-shot materialised copies. Feature/body patterns and mirror remain M6; feature/face
offset remains M9.

## Feature coverage vs SolveSpace (sanity check)

Checked against SolveSpace's actual menu/group inventory **and** the 3:13 homepage demo
video (frames extracted at 2 s intervals). The headline gap was **sketch supports**: a
sketch used to be always on XY. World XZ/YZ and planar faces are in; datum planes move
into M4 and become a history feature, not a sketch property. The demo also makes one
more gap explicit: sketch points must be constrainable to **existing solid faces and
edges**, which is how the gusset is anchored between the inner walls.

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
| Revolve / lathe | M9 low; not used in the reference part |
| 3D fillet / chamfer | M5 (OCCT/`brepjs`, not a `slvs` gap) |
| Loft / sweep | M9 low; not used in the reference part (OCCT; a 3D sweep path also needs M9 curve work) |
| Draft | Not planned yet; M9 |
| Shell / thickness / offset | M5 shell; **Offset Faces M5/M6**; thicken M9 |
| Linear/circular patterns, feature/body mirror | M6; sketch symmetry constraint is done. Mirror is high priority. |
| Hole/thread feature | Circle + cut extrude now; M9 low (not used in the reference part) |
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
- [x] Region picking in the sketch UI: translucent fills with holes and void profiles,
      click/Shift-click, and an **All / Voids / Auto** panel. The active regions are
      highlighted and previewed in 3D
- [x] `regionId = hash(sorted outer + direct-hole curve ids)`; stable across dimension
      edits and invalidated when a boundary changes
- [x] Multiple regions per extrude. The worker extrudes each region and fuses the solids
      (`fuseAll`), so disjoint regions become one body
- [x] Deeper nesting: a hole can contain an island, which is a separate depth-2 region
- [x] Split curves at intersections / trim while sketching — implemented in M2.6
- [x] Full planar face traversal: the arrangement splits lines/arcs at crossings,
      T-junctions and circle intersections; a half-edge walk extracts faces that share an
      edge. A circle crossed by a line/arc is converted into arcs, so a chord through a
      hole yields two plate faces and two half-disks. Trim still does not turn a circle
      into arcs (M9)
- [x] Rebuild goldens: representative profiles assert bbox and face count, not just volume;
      `BodyStats.bounds` comes from the tessellated mesh, so curved goldens round
- [x] Face/edge picking + hover/selection highlight: raycast `faceGroups`/`edgeGroups`,
      edge-priority picking, highlighter overlays, and an ephemeral `BodyPick` readout

**Done when:** you can draw an arbitrary multi-region sketch, click one or more regions
(including holes and islands), and extrude/fuse them with exact volume. Auto mode still
defaults to the largest material region until you click; M2.6 adds split/trim.

**M2 is complete.** The 3D view picks faces and edges with hover/selection highlights;
the profile path handles crossings, T-junctions, holes, void profiles, circle splitting,
and trim. The reported circle-through-hole part is a unit fixture and an e2e regression.

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

## M2.7 — Standalone sketch points (small, pulled early)

Points already exist as curve endpoints, circle/arc centres, fillet tangent points and
the fixed origin. This slice exposes a point entity the user can place and constrain on
its own. Standalone points are construction/reference geometry: they never form a
profile by themselves.

- [x] Point tool: click to place a point, with grid/point snapping and undo; `P` shortcut
- [x] Select, drag, constrain and dimension a standalone point (the existing point paths
      already support this once it is in `sketch.points`)
- [x] Distinct hollow point styling and a point property readout (label + X/Y editor)
- [x] Tests: create, prune/delete survival, JSON persistence, no-profile behaviour and an
      e2e placement/select/undo smoke test
- [x] Do not include standalone points in `regionsFromSketch` or profile loops

**Done.** `SketchPoint.standalone` (schema v2) marks a user-placed point so
`deleteEntities`/`pruneSketch` keep it even though no curve refers to it. It is a normal
solver point, so drag/constrain/dimension/X/Y editing all reuse the existing paths.

**Done when:** you can place two free points, dimension the distance between them, drag
one, and undo the whole gesture without affecting any profile.

## M2.8 — Design fidelity (done except the file menu, which lands with M3)

The app must look and read like the studies before more feature chrome lands. The mockup
HTML is illustrative; the **Design contract** above is the requirement. This pass covers
the shell (header, stage foot, timeline) first, then the sketch view controls.

### Shell and typography

- [x] Typography tokens from `docs/mockups/TYPOGRAPHY.md` in `src/app/app.css`; the
      shell uses serif names, mono labels/values and sans prose
- [x] Header: filename + appearance, not a brand toolbar or creation buttons; solver/
      kernel health moved to the stage status line and the extrude parameters to the
      feature popover
- [x] Stage foot: body/solver health on the left, view controls on the right; removed the
      floating stats/health clutter
- [x] Timeline: numbered steps with type + serif name + meta, an active-step marker, and
      one summary line for the selected step; no rounded cards
- [x] Timeline detail is a **summary + actions**; feature/tool parameters live in one
      draggable stage popover (design rule 6), with a summary + `cancel`/`apply` footer.
- [x] Applied constraints appear as active selection chips; clicking one removes it
      (including H/V). Clicking a filled region clears a non-empty geometry selection
      before it can start an extrude draft.
- [x] Finish the interaction contract on the sketch side: the selection popover replaces
      the selection card + constraint bar; X/Y is an inline editor at the point; a
      dimension value is an inline editor with unit and driving/reference; the fillet is
      an operation popover; dimension and trim are contextual selection chips, not top
      tools. The selection popover body is click-through except for its controls.
- [x] Error state in the timeline: ink + dotted rule + “!”, no red
- [x] Model stage: clean paper drawing, no ground-grid wallpaper; quiet body fill and
      thin B-rep edges in both themes
- [x] Sketch tool line as words + shortcuts (not an icon toolbar); DOF in the stage foot
- [x] Contextual selection popover replacing the study-02 line; its body is pointer-
      through except for the controls
- [x] Extend `check-typography.mjs` to audit `src/app/app.css` as well as the mockups;
      `npm run check:typography` is part of `npm run verify`
- [x] Error styling everywhere: `--danger` is ink in both themes, with dotted rules for
      error text; no red remains in the app
- [ ] Header filename as the real file menu (M3 local files), not just a label

### Sketch view controls

The sketch interaction and typography targets that are not yet in the app.

- [x] Grid step adapts to the zoom using a nice 1/2/5 × 10ⁿ sequence; the user can enter
      any spacing in mm. Major lines every five cells; the grid disappears when a manual
      step is too dense
- [x] Visual scale bar showing one grid cell next to the numeric step
- [x] Snap on/off independent of grid visibility (the grid stays as a reference)
- [x] Zoom menu: 50% / 100% / 200% / fit (100% is the fit scale; wheel zoom and
      double-click fit remain)
- [x] Contextual selection popover from study 02 instead of a floating card;
      pointer-through except for its controls
- [x] Tool line as words + shortcuts in sketch mode, not a permanent icon toolbar
- [x] `Enter` finishes the active sketch once any draft line is committed; the header
      action remains the explicit primary

**Done.** The shell, adaptive grid, scale bar, zoom menu, selection line, no-red errors,
typography audit and Enter-to-finish are in. The filename file-menu affordance is the only
remaining item and lands with the M3 local-files work.

## M2.9 — Sketch selection tools (done)

Click/Shift-click was the only way to select sketch profile regions. Box and lasso
selection make multi-region extrudes and bulk edits practical.

- [x] Rectangular select in sketch mode: drag a marquee to select profile **regions**;
      Shift adds/toggles, non-additive replaces, Escape clears, and click selection keeps
      working
- [x] Draw the marquee in ink with a highlighter wash; it is ephemeral UI state, never in
      the document or undo history
- [x] Selection semantics: **box = fully inside**; **lasso = touched/crossing** (a corner
      loop selects the profile it touches); void regions are selectable on the same terms;
      an empty marquee is a **no-op** and must never fall back to the largest profile
- [x] Lasso selection (`G`) after the rectangular tool, sharing the same selection model;
      freehand polygon, Shift/replace behaviour
- [ ] Extend the same tool to curves/points only if it does not muddy the profile workflow
      (a mode or modifier, decided by use)
- [x] Tests: disjoint/partial/circle box cases, concave/circle/corner/empty/hole lasso
      cases, and e2e box-select and lasso-select (including a corner touch and empty
      no-op) then extrude

**Done.** `B` box-selects fully-enclosed profile regions and `G` lasso-selects profiles it
touches. The marquee is ephemeral, an empty marquee leaves the selection unchanged, and
both tools feed the same active-extrude region selection.

## M3 — History (4–6 days)

**Done.** The document store, migrations, autosave, feature names, undoable feature
parameters, the ordered rebuild/cache, the worker solid cache + new/join/cut, the full
feature tree (select, rename, create, edit, reorder by drag, suppress, delete with
cascade, rollback/roll-forward), the local file menu/list (`Example.cad`, copy, rename,
new, open, download), blind/symmetric/through-all extrudes, the first TopoRef plumbing,
and evolution-based role propagation through booleans are in.

- [x] `core/doc`: feature/document schema (`Doc`, `schemaVersion`, ids, migrations) and
      the sketch in the document store rather than component state; schema v4 adds
      optional dimension label placement (`along` for linear, `distance` for radial);
      schema v5 adds planar face supports (`TopoRef` + cached `PlaneFrame`)
- [x] `core/rebuild`: ordered evaluation, per-feature status, prefix cache, generation
      counters, cancellation of stale results, and the worker solid cache
- [x] Feature tree UI: select, rename, create, reorder (drag), suppress, delete
- [x] Rollback/scrub: roll back to a selected step, downstream steps paused/dimmed,
      “roll forward” in the header
- [x] Selected-step detail line is a summary (distance/operation/end/direction/profile)
      plus rename/edit/select profiles/open sketch/roll back/suppress/delete; the
      editable parameters live in the draggable feature popover
- [x] The active extrude's source sketch is rendered on its plane in the model view
      (thick highlighter underlay + ink centerline over the body), showing only the
      profile loops that extrude uses and shading them with holes left open; all regions
      remain visible in profile-selection mode
- [x] Feature edit in the draggable popover: height (slider + free-form), symmetric,
      operation, end; the detail line stays a summary
- [x] Feature creation is contextual: `+ sketch` in the timeline opens an explicit
      support popover; `extrude` on a selected sketch starts a draft with no profile
      selected and only creates the feature after profiles and parameters are applied
- [x] A polygon crossing the example plate/hole keeps every region selectable and the
      hole as a void profile (unit + e2e regression)
- [x] A sketch can feed several extrudes with independent region selections; when the
      sketch step is active and more than one active extrude consumes it, region fills
      are read-only so the picker cannot silently edit the first consumer
- [x] Feature deletion cascades a sketch’s dependent extrudes; reorder rejects an
      extrude before its sketch; both are undoable
- [x] Rebuild-on-edit with stale-while-rebuilding/latest-wins rendering and per-feature
      status/diagnostics; the active feature’s messages appear in the detail line
- [x] Error states in the tree (status, dotted rule, “!”) plus clickable selection
- [x] Persistence: autosave, migrations, `.cad` download/open/rename/new
- [x] Local file index from mockup 07: filename menu, local list with steps/modified
      time, make a copy, rename, new file, open `.cad`, download, two-step delete;
      the built-in example has a stable document id so reloading updates one entry
- [x] Cut/join extrudes and a saved multi-feature rebuild
- [x] Extrude end conditions: blind, through-all (cuts) and symmetric/two-sided;
      up-to-face remains M4
- [ ] Extrude start offset — begin the solid at a distance from the sketch plane
- [ ] Extrude taper angle — drafted side walls without a separate Draft feature
- [ ] Extrude intersect — the third boolean operation
- [x] First TopoRef plumbing: worker `assignRoles` + `captureHint`/`createRef` on the
      final body, carried through `FaceGroup`/`BodyPick` as JSON-safe refs
- [x] Evolution-based `updateRoles` across fuse/cut; the worker keeps a role table per
      prefix solid alongside the solid cache
- [ ] Store `TopoRef`s on features (`PlaneRef.kind = "face"`, face supports) — first M4
      face-support task
- [x] Rebuild test: edit the first sketch, assert downstream volume changes and undo
      restores it

**Done when:** a two-feature part survives an edit to the first sketch, save/reload, and
undo/redo — with correct geometry every time.

**Met.** The e2e suite edits the first sketch in a six-feature part, asserts the downstream
solid changes, undoes it, reopens the autosaved part, downloads/opens `.cad`, reorders,
suppresses, deletes and rolls back, and lists/copies/reopens local files. Role tables are
now propagated through joins/cuts with `updateRoles`; the next step is storing face refs
on features for M4.

## M4 — Sketch supports: datum planes and faces (7–9 days)

A sketch support is resolved from references, then given a stable frame. Datum planes
come first: they cover "sketch in thin air" and share the resolution/recovery machinery
with face sketches.

### Datum planes

- [x] `DatumPlaneFeature` in the document (a history step, no body):
      `offset(base: PlaneRef, distance)` and `midplane(a: PlaneRef, b: PlaneRef)`.
      Distance is a number until M7 expressions.
- [x] Resolve offset: origin = base origin + base normal × distance; keep the base frame's
      axes. `base` can be a world plane, a face, or another datum plane (chains).
- [x] Resolve midplane: both bases must be parallel; origin = midpoint, axes from the
      first. Non-parallel bases produce a visible feature error.
- [x] Offset from XY is the "thin air" case. Datum-chain bases follow edits via the
      ordered rebuild.
- [x] Face-backed datum planes (and midplanes) refresh from the source feature's cached
      prefix solid, then propagate through datum chains and dependent sketch snapshots.
- [x] Timeline rows for planes; edit type/bases/distance; suppress/delete cascades through
      dependent sketches, extrudes and datum chains.
- [x] Render planes in 3D (translucent quad + axes), pick them to start a sketch, and hide
      inactive ones while sketching. The model view is hidden in the sketch stage, so
      inactive planes are not shown while sketching.
- [x] Per-datum **visibility** (`hidden`, schema v8) separate from suppression: hidden
      planes stop rendering and picking but still rebuild and remain valid sketch
      supports. The timeline shows `hidden` and offers hide/show. Broader visibility
      toggles (bodies/sketches/constraints) remain the M8 design pass.
- [x] Datum-plane drafts preview the candidate plane in the model view (updated live from
      type/base/distance) while the body is dimmed.
- [x] Sketch-support picker: one typographic list for world planes / planar faces / datum
      planes. World/face/datum choices are in, selecting one previews its plane on a dimmed
      body, and lost references are visible with recovery. Per-row hover flash can still be
      refined.
- [ ] Support-list details: face name + area, curved “unsupported” explanation, datum
      “between faces”, and a pending “untitled” history row while choosing (mockup 04)
- [ ] Through-3-points and angled planes after datum points/axes land (M6), unless needed
      sooner.

### Sketches on faces

- [x] Face → `TopoRef` on selection; `PlaneRef.kind = "face"` (schema v5)
- [x] Deterministic face frame (origin, x-axis) + cached frame fallback
- [x] Sketch on a planar face of a solid; the 2D sketch surface uses the face frame and
      the model overlay/extrude map through it (no 3D camera turn needed)
- [x] Project the supporting face's boundary into the sketch as fixed construction
      geometry, and label it; projected geometry is dashed, fixed and never selectable
      as user geometry (mockup 02). Outlines are cached on the sketch feature and
      re-derived after every rebuild.
- [x] **Live reference geometry**: projected point/line/face outlines store the `TopoRef`
      they came from, are re-derived from the source feature's cached prefix solid on
      every rebuild, and are kept as cached geometry (marked stale) if their topology
      changes. Downstream booleans cannot move or split them.
- [x] Projected references participate in the solver as fixed (group-0-like) entities, so
      point-on-line / point-on-point / coincident constraints work against them. Points
      and edges are snap targets; snapping a vertex to a projected edge adds a
      point-on-line constraint so the drawn geometry stays attached.
- [x] `resolveRef` on rebuild: exact → geometric fallback → lost-ref error with
      "reselect". The worker resolves the stored `TopoRef` against the source prefix body;
      the E2E covers a stale role resolved geometrically and a lost face surfacing.
- [x] **Lost-support recovery surface (first slice):** failed face refs are tracked as
      derived `RebuildInputs.lostFaceRefs`, the step shows `lost · cached frame`, and the
      detail offers reselect (pick a face first) / open sketch / revert. Datum bases open
      the datum editor for reselect. Exact `resolveRef` fallback and richer recovery are
      still pending.
- [x] Handle flipped face normals and sketches created on the "back" of a face. Face
      frames preserve their original side when a live normal flips (up to sign), and the
      support popover has a `flip side` action for a face before creating the sketch.
- [ ] Redefine/edit a sketch's support after creation, through the same support picker,
      keeping the cached frame until the new support resolves
- [ ] Extrude to-object / to-next end condition, resolved through `TopoRef`
- [ ] Project arbitrary edges/faces into a sketch in addition to the support boundary.
      The full Fusion projection suite (project / include 3D / intersect /
      project-to-surface) is deferred; see M9
- [x] Topological-naming regression test: change base height, boss on top face follows
- [x] UI: unsupported (curved) face → clear explanation, no broken state
- [x] **First slice landed:** face refs + deterministic cached frame, sketch on a planar
      face, and frame-aware extrude/overlay.
- [x] **Second slice landed:** live projected face-boundary references, cached
      projections with stable identities, solver participation, and source-height
      regression coverage.
- [x] **Datum slice landed:** offset/midplane features with chained bases, timeline
      edit/suppress/delete cascade, datum supports in the sketch picker, dependent
      sketches/extrudes following offset edits, 3D plane quads, and ray-picking a datum
      to start a sketch.
- [x] **Live face-base slice landed:** face-backed datums refresh from the source prefix,
      propagate through datum chains and dependent sketches/extrudes, and follow base
      body edits.
- [x] **Lost-support slice landed:** live face-ref failures mark the step and use the
      cached frame, with reselect/open sketch/revert. Exact `resolveRef` fallback remains.
- [x] **Flip/normal slice landed:** live face frames stabilize against the side the sketch
      was created on, and `flip side` lets a face sketch start on the opposite side of the
      face. A base-height edit keeps the flipped frame stable.
- [x] **Resolve/preview slice landed:** `resolveRef` exact + geometric fallback on the
      source prefix, and the support picker previews the chosen plane while dimming the
      body. M4's core flow is in; support-list detail copy and through-3-point planes
      remain.

**Done when:** sketch on an offset plane in empty space; sketch on a midplane between two
faces; change the offset or the base plate height and every dependent sketch/feature
follows; deleting a base face produces a visible, recoverable error.

**Demo acceptance (with M1+M3):** build the angle bracket from the video — L profile →
extrude → gusset triangle in the symmetry plane, anchored to projected inner edges →
two-sided union extrude → two holes on the flange face, cut through — then edit the first
sketch (tangent arc + angle) and have the solid, gusset and holes rebuild correctly.

## M5 — Refinement features (4–5 days)

### Sketch refinements (from gap backlog)

- [ ] Collinear constraint (one `drag.ts` row, small)
- [ ] Sketch-create variants: center / 3-point rectangle, center-point / tangent arc,
      2-point / 3-point circle; polygon is low priority

### Model refinement

- [ ] Fillet (constant radius) on selected edges, with failure handling
      (`filletWithEvolution` so downstream refs survive)
- [ ] Chamfer
- [ ] Shell (open faces) — maybe defer
- [ ] **Offset Faces** — move selected faces by a distance; tolerance/fit and wall
      adjustments. The design audit shows 11 uses (third most-used modelling feature),
      so this is Keep at M5/M6 rather than Drop
- [ ] Selection UX: edge chain selection, box select where sensible, hover prehighlight,
      selection filters, and Select Other for cycling overlapping picks
- [ ] Section Analysis: a view-only inspect overlay (never in history), with the
      visibility questions resolved first
- [ ] Feature selection highlights the geometry that feature created (mockup 03:
      selecting the gusset extrude washes the gusset, not the whole body)
- [ ] Measure tool (distance, angle, radius, area, perimeter, centre of mass); overall
      dimensions can sit on the model like drawing annotations (mockup 03)
- [ ] Body health line: 1 body · 1 shell · N faces · watertight, alongside volume and
      bounds (mockup 03/05)
- [ ] Export STL + STEP from the worker, derived from the current rebuild state (not a
      frozen mesh)
- [ ] Export page (mockup 05): visible model, body/watertight/shell/no-open-edges/outward
      normals, units/scale/triangles/file size, build-volume fit, one quiet export action
- [ ] Body appearance (mockup 08): material + finish attached to the body-creating
      feature; later join/cut keep the same body/look; the timeline detail summarises it
      and the panel is transient. Decide whether appearance is document data or
      presentation-only.

**Done when:** you can fillet the four vertical edges of a plate, then change the plate
size and the fillets survive. The printer export page reports real checks and produces
an STL derived from the current history.

## M6 — More shape (1–2 weeks, can reorder)

The design audit confirms patterns, mirror, Combine and Split Body are used in the
reference part; they are not speculative. Timeline groups are also a real workflow item
(10 uses), added below.

### M6.0 — Sketch layout operations (pattern, mirror, offset)

Design target: [`docs/showcase/`](../showcase/). These are **sketch-mode, parametric,
re-editable** operations, not one-shot copied geometry. See **ADR-0004**.

- [ ] `SketchLayoutOperation` records on `SketchFeature` (plain JSON, schema bump):
      source ids + kind-specific params; derived instances are regenerated on every
      rebuild, never persisted as independent curves
- [ ] Rectangular pattern: count + direction/spacing (one direction first, optional second)
- [ ] Circular pattern: centre point, count, full/partial angle, rotate copies
- [ ] Mirror: line/axis source, optional keep-original
- [ ] Offset: closed loops, distance, side, miter/round; open chains and
      self-intersections are explicit errors, not bad profiles
- [ ] Select first, then tool (Fusion order); live preview: source ink + highlighter,
      derived copies dashed/faint; apply/cancel is one undo entry
- [ ] Re-edit: select the operation (or its sources) and reopen the same popup with its
      current parameters; changing count/spacing/axis/mirror/offset regenerates copies
- [ ] Derived instances participate in regions/profiles/extrude but are not individually
      draggable or constrainable in v1; constrain the source
- [ ] Move / Copy sketch geometry, using the same preview/apply/re-edit grammar
- [ ] Keep the sketch as one history step; operation rows nested under the sketch are a
      later timeline refinement (deferred design pass)
- [ ] Tests: pattern/mirror/offset volumes, re-edit updates downstream, JSON round-trip,
      undo, invalid offset reports, e2e preview/apply/re-edit

**Done when:** a rectangular pattern and a mirror can be applied in a sketch, extruded,
reopened, tweaked, and the solid updates — with no materialised copies in the document.

### Feature/body patterns and shape

The design audit confirms feature/body patterns, mirror, Combine and Split Body are used
in the reference part. Revolve, loft and sweep are **not used there**; keep them behind
the proven items rather than letting them displace the workflow-critical work.

- [ ] Feature/body linear and circular patterns (reuse the M6.0 popup/preview grammar)
- [ ] Feature/body mirror (sketch mirror lives in M6.0; this one uses `TopoRef` evolution)
- [ ] Datum axes and points (revolve axes, through-point planes, sweep paths); the audit
      uses construction planes heavily, so these stay as enabling infrastructure
- [ ] Revolve, loft/sweep — not used by the reference part; promote from M9 only when a
      real part needs them
- [ ] Helix (threads, springs) — optional
- [ ] **Combine** — join / cut / intersect, keep tool bodies, use a body as a tool
      (elevate general body booleans to a real feature)
- [ ] **Split Body** — split with a plane / face / body, keep both halves as independent
      bodies with stable references
- [ ] **Move / Copy bodies** — materialised transform or persistent body operation
      (design decision below)
- [ ] **Align** — line up bodies/faces without hand-measuring

### Timeline groups

- [ ] Named, collapsible groups of related history steps; group/ungroup, preserve step
      order, and keep dependent-feature diagnostics visible. The audit uses 10 groups.
      This is history refinement, distinct from the deferred sketch-operation rows nested
      under a sketch (M6.0).

## M7 — Parameters (3–4 days)

- [ ] Named parameters with units; `Expr` evaluation + dependency ordering
- [ ] Expression editing on every dimension field
- [ ] Parameter table UI, rename with reference updates
- [ ] Cycle detection with a clear error

## M8 — Later / maybe never

Assemblies and joints, drawings, STEP import, curved-face sketches, sheet metal,
collaboration, plugin API.

### Assemblies (largest structural gap)

The design audit shows the reference part is an assembly: 17 components, 6 component
inserts, 1 rigid group and 2 snapshots. Single-body scope is therefore the biggest
structural gap between the plan and the part it must make. This is a layer, not one
feature, and needs its own design pass before v1 scope is fixed.

- [ ] Component / occurrence layer: insert parts, including STEP bodies, as components
      with stable instance identity; assemblies can contain assemblies
- [ ] Rigid Group: fix a set of components together
- [ ] Capture Position / Snapshot: record and restore component positions (previously
      unplanned)
- [ ] Assembly `TopoRef` addressing across instances; stable references through snapshot
      and rigid-group edits

### Other M8 work

- [ ] Visibility toggles: show/hide sketches, bodies, constraints, construction,
      dimensions; isolate; opacity. This is a coherent surface of its own — design it
      before bolting it onto the timeline/panel (deferred design pass).

## M8.5 — Scripted features and AI access (unscheduled; ADR-0005)

Goal: a deterministic escape hatch for geometry, plus a stable machine interface to the
whole app. A complicated sketch should be typable or AI-generated instead of clicked;
the same commands should generate demo parts and drive recordings without pixel-level
automation.

The design decision is in **ADR-0005**; this is the delivery checklist.

### M8.5.0 — Command/query layer (prerequisite)

- [ ] `core/commands`: serializable, versioned commands for every document mutation the
      UI performs (draw/constrain/dimension, extrude, edit, suppress, reorder, delete,
      undo transaction). The UI dispatches commands; headless/AI uses the same schema.
- [ ] Commands return `{ doc, solved, regions, diagnostics, events }`; queries expose the
      document, active feature, regions, rebuild status and ephemeral UI state.
- [ ] Deterministic ids and transaction/merge keys; one gesture = one undo entry. Units
      (mm) and angles (degrees) stay at the boundary, as in the UI.
- [ ] Generate a capability manifest + command reference from the schema so AI is
      grounded in supported operations and limits.

### M8.5.1 — Code view and replace (first user-facing slice)

- [ ] A `code` action on a sketch/extrude opens a **full-stage source sheet** (like the
      sketch editor; not a permanent sidebar) with a summary + quiet `cancel` + primary
      `apply` footer, matching the interaction contract.
- [ ] Generate canonical builder code from the feature's JSON: points/curves/constraints/
      dimensions for a sketch; sketch/regions/height/direction/operation/end for an
      extrude. Stable ids/names so an unmodified apply is a no-op.
- [ ] Parse/evaluate without committing, show diagnostics inline, and apply as one undo
      entry. Preserve ids where possible; remap downstream region refs or fall back to
      auto with a visible diagnostic.
- [ ] Invalid code keeps the last good body and the editor open; it never commits.
- [ ] Optional: store the last applied source as metadata (not executed) so it can be
      reopened; mark it stale when the feature is edited by hand. Schema bump + migration.
- [ ] Round-trip tests: every fixture feature → code → same JSON and same solid.

### M8.5.2 — Scripted features

- [ ] A `script` feature type stores versioned source + inputs; source is the truth, output
      is derived and cached by hash. Derived geometry is read-only; editing the source is
      the only edit. No dual source of truth.
- [ ] Isolated deterministic runtime (worker or sandboxed iframe; no DOM, kernel, network,
      filesystem, clock or nondeterministic randomness; time/memory limits). Choose the
      sandbox with a separate dependency ADR; do not run user/AI code on the main thread.
- [ ] Failed scripts are per-feature diagnostics: skip the feature, keep the last good
      body, and say which script failed and why.
- [ ] Builder API covers sketches first (points, curves, constraints, dimensions), then
      extrude/booleans; later sketch layout operations and feature patterns.
- [ ] Deterministic ids from source hash + call order; a script edit invalidates its cache
      and downstream features rebuild in order.

### M8.5.3 — AI bridge and demo runner

- [ ] Expose query/apply/run over an opt-in local-only bridge (MCP or loopback HTTP); in
      development also a `window.cad` handle. Clients never touch the kernel directly.
- [ ] A text console/command palette uses the same commands; selection and active feature
      can be inspected and set as explicit UI state, not guessed from the DOM.
- [ ] AI-generated code lands in the same source sheet for preview/review before `apply`;
      no silent commits. The manifest, current document and diagnostics are available to
      the client as structured data, not screenshots.
- [ ] Scenario files: command list + camera keyframes + waits. A headless runner builds a
      `.cad`, captures screenshots, and drives Playwright video for demo parts.
- [ ] Capability manifest + examples, so AI can discover features, limits and error
      recovery instead of hallucinating. Every command remains undoable and replayable.

**Non-goals for v1:** arbitrary network/filesystem access from scripts; a plugin
marketplace; exposing OCCT handles; pixel-coordinate automation.

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
| Offset/trim sketch curves | Trim is M2; **sketch offset is promoted to M6.0** (ADR-0004); feature/face offset is not planned | Manual construction | Curve trimming/offset + profile rebuild | M2/M6.0 (sketch) / M9 (feature offset) |
| Split at a point / divide into equal sections | Only intersection splits exist (derived arrangement + trim); no editable split or divide tool | Draw separate collinear segments and constrain them Equal | Split-at-point tool; divide-into-N with a persisted count; constraint remapping; decide destructive vs construction | M9 **app** |
| 3D assembly constraints/joints | No assembly model | M8 | Assembly solver/joints | M8 |

### Kernel/feature gaps (not blocked on `slvs`)

| Feature | Limitation today | Workaround today | What it needs | Target |
| --- | --- | --- | --- | --- |
| 3D edge fillet/chamfer | Only 2D sketch fillets before extrude | Draw the fillet into the sketch | `brepjs`/OCCT fillet/chamfer with evolution, feature UI | M5 |
| Revolve | Not implemented; not used in the reference part | Manual extrudes/rotations | OCCT revolve + axis selection | M9 (low) |
| Loft | Not implemented; not used in the reference part | Multiple extrudes/manual blends | OCCT loft between sections | M9 (low) |
| Sweep along a path | Not implemented; not used in the reference part | Planar sweep not yet; 3D path impossible | OCCT pipe/sweep; 3D path needs the M9 3D-curve work | M9 (low; 3D path also M9-curve work) |
| Feature/body mirror, linear/polar patterns | Sketch symmetry constraint exists; no feature transforms | Duplicate/rotate sketches/features manually | Feature transforms + history pattern feature | M6 — **mirror is high priority** |
| Draft for moulds/castings | Not implemented | None | OCCT draft on selected faces + neutral plane | M9 (promote to M5 if needed) |
| Shell / thickness / offset | Shell is planned M5; offset/thicken not | Nested sketches and holes | `brepjs` shell/offset/thicken, open-face selection | M5/M9 |
| Press/Pull / multi-face offset | Single-face Offset Faces is promoted to M5/M6; multi-face Press/Pull is not | Nested sketches and holes | Multi-face offset/thicken; pair with Offset Faces | M9 (low) |
| Full sketch projection suite | Support boundary is projected (M4); arbitrary project/include 3D/intersect/project-to-surface is not | Draw construction geometry manually | Projection feature/selection grammar, projected edges, solver refs | M4 subset / M9 rest (low) |
| Hole/thread feature | Circle + cut extrude; not used in the reference part | Manual circle/cut | Hole profiles, standard sizes, helix/thread | M9 (low) |
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

- **Workflow-critical from the design audit:** Offset Faces, feature/body patterns,
  mirror, Combine, Split Body, timeline groups and assemblies. Promote those ahead of
  revolve, loft, sweep, draft, hole/thread and primitives, which the reference part does
  not use.
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

### Covered by existing tools (no new work)

- **Concentric:** two circles/arcs sharing a coincident centre are concentric; add Equal
  only when the radii must match. Remaining work is UX convenience (auto-pick centres).
- **Curvature / Smooth (G2):** only meaningful for splines/Béziers, which are M9.
- **Sketch region selection:** planar arrangement + half-edge faces already handle
  intersecting sub-profiles (M2.9).

### Dropped (decided no)

Slot · Sketch scale · Sketch extend · Sketch chamfer · arc-length / tangent-distance /
ordinate dimensions · Rib · Web · Emboss · primitive bodies (box/cylinder/sphere/torus)
· silhouette split · replace / delete face · boundary fill · stitch / unstitch
/ simplify · direct modeling ("Capture Design History", base feature, paste-new, derive).

**Offset Faces was removed from this Drop list** after the 2026-11-02 design audit: it is
Keep at M5/M6 (11 real uses, all tolerance/fit work).

### Open design questions (from the gap backlog)

- **Combine / Split Body:** are tool bodies a selection in the feature dialog, or a
  separate bodies list on the document? How do result bodies keep stable identity
  (`TopoRef`) across a split?
- **Section Analysis:** view-only overlay (never in history)? How does it interact with
  visibility toggles and isolate?
- **Move / Copy:** materialised one-shot transform or persistent feature? Sketch geometry
  should use the M6.0 persistent grammar; bodies are closer to a feature.
- **Sketch-create variants:** one tool with modes or separate tool-line entries?
  Fusion uses press-and-hold flyouts.
- **Visibility toggles:** show/hide sketches, bodies, constraints, construction,
  dimensions, isolate/opacity — design as a coherent surface before implementation.
- **Assemblies:** what is a component/occurrence in the plain-JSON document? How do
  inserted STEP bodies keep stable identity, and how does `TopoRef` address a face inside
  an instance? What exactly does Snapshot capture (transforms only, or visibility too)?
- **Timeline groups:** are groups document data or presentation state? How do they
  interact with rollback, suppression and nested sketch-operation rows?
- **Projecting sketch geometry onto a datum plane / project-to-surface:** is this a
  projection feature, a sketch import, or a view transform? It needs a separate design
  pass; the M4 subset only projects a supporting face boundary and arbitrary solid edges.
  Keep the full suite in M9 until that grammar is clear.

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
