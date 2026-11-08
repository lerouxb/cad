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
   sidebar. The timeline detail line is a **readout + actions**, not a form and not a
   repeat of the step block; the stage
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

## Current state (2026-11-08)

The core loop is real and edited through history: sketch → solid → sketch on a face →
downstream rebuild.

- **Sketching:** constrained lines/points/rectangles/circles/arcs and a corner fillet, a
  full constraint set with dragging projected onto the constraint tangent space, regions
  (material/void), trim, grid/snap, construction geometry, undo/redo.
- **Document and rebuild:** plain-JSON schema (now v14), migrations, autosave, a cached
  ordered rebuild, visible per-feature status/diagnostics and a worker protocol.
- **Timeline:** create/edit/reorder/suppress/delete, selection as the history cursor, the
  no-step load/empty-tail/Escape-at-rest contract and insert gaps.
- **Selection:** one language across sketch and model; profile/face/edge families; box,
  lasso and Select Other; contextual feature chips.
- **Solid features:** extrude (new/join/cut), revolve, fillet, chamfer, shell, offset
  faces (planar + full cylindrical through holes/bosses), datum planes, measure and
  STL/STEP export from the rebuilt prefix.
- **Recent:** offset added/removed diff previews, revolve, the selection pair for sketch
  lines and model edges, and the sketch-creation-aware no-solid callout.
- **Tests:** `npm run verify` (240 unit) and `npm run e2e` (142) are green.

**Next:** the shared boolean contract in
[`showcase/BOOLEANS.md`](showcase/BOOLEANS.md). Offset faces already implements its
added/removed/ghost preview; extrude and revolve still have three operations, a select
instead of the segmented row, and no diff preview.

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
- [x] **Constraint chips**: parallel, perpendicular, equal, point-on-line, point-on-circle,
      tangent, symmetric, midpoint, coincident, fix, horizontal/vertical, plus construction
      geometry, applied from the selection popover and drawn with the mark grammar in
      `CONSTRAINTS.md` (glyphs, badges, connectors and axes, not a floating constraint bar)
- [x] Angle, tangent and symmetric constraints; radius as a dimension. Two-edge
      symmetry selects two opposite edges plus an axis (a reference line wins, otherwise
      the last selected line) and adds both endpoint-pair symmetric constraints in one
      action — the rectangle-about-a-centreline workflow.
- [x] Midpoint constraint UI (point + line → at midpoint); point-on-circle
- [x] A real "fix point" constraint (lock the point where it is dragged)
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

## M2 — Profiles and solids

- [x] Worker client + protocol, init handshake, latest-wins rebuilds
- [x] Extrude evaluator: polygon/circle loops → wire → face → solid, with validation
- [x] Tessellation via `toBufferGeometryData` / `meshEdges`, transferred to the main thread
- [x] Shaded solid + dark B-rep edges, Z-up, auto-framing
- [x] `core/sketch/loops.ts`: graph → simple cycles → face filtering (a cycle containing
      a smaller cycle that shares an edge is a subdivision, not a face) → containment tree
      (even depth material, odd depth holes) → selectable regions, with tests
- [x] Profile picking in the sketch UI: translucent fills with holes and void profiles;
      click/Shift-click selects the profile family and opens its popover, with
      **All / Voids / Auto**; `extrude…` starts the draft. A later SELECTION.md pass
      moved the same helpers into that popover.
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

**Done when:** you can draw an arbitrary multi-region sketch, select one or more profiles
(including holes and islands), choose `extrude…` in the profile popover, and fuse them
with exact volume. Auto still means the largest material region; M2.6 adds split/trim.

**M2 is complete.** The 3D view picks faces and edges with hover/selection highlights;
the profile path handles crossings, T-junctions, holes, void profiles, circle splitting,
and trim. The reported circle-through-hole part is a unit fixture and an e2e regression.

## M2.5 — UI foundations: paper/ink visual system

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
      grid, dimensions, constraint marks, snap/hover, construction/reference styling
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

## M2.6 — Split at intersections / trim

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

## M2.8 — Design fidelity (done)

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
- [x] Timeline: step blocks with `NN · KIND`, a serif name, meta and an output chip
      (`+`/`→`; sketch/plane/body), an active underline that reaches under the dividers,
      paused downstream steps, a hover-only drag grip, and hover-only insert gaps before
      the first step, after every step and after the last, with a `sketch`/`plane` menu.
      The leading gap inserts at the very start without moving the cursor; the empty 44px
      tails at both ends clear it. Design contract:
      `docs/showcase/TIMELINE.md` and `docs/showcase/bodies.html`; multiple bodies and
      groups are deferred to M6 below. Earlier baseline: numbered steps with type + serif
      name + meta, an active-step marker, and
      one summary line for the selected step; no rounded cards
- [x] Timeline detail is a **readout + actions**; feature/tool parameters live in one
      draggable stage popover (design rule 6), with a summary + `cancel`/`apply` footer.
- [x] Applied constraints appear as active selection chips; clicking one removes it
      (including H/V). Clicking a filled region selects the profile family and opens its
      popover; it never starts an extrude draft by itself (`SELECTION.md` S1/S4).
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

## M2.9 — Sketch selection tools (done; superseded by SELECTION.md)

Box and lasso selection make multi-object selection and bulk deletes practical.
The profile-region-only marquee from M2.9 was superseded by
[`SELECTION.md`](showcase/SELECTION.md) §3: in normal sketch select the marquee
selects geometry and dimensions through the filter; only profile mode (an extrude
draft/editor) marquees regions.

- [x] Rectangular select in normal sketch select: geometry/dimensions fully inside
      through the current filter; Shift toggles, non-additive replaces, Escape clears.
      Profile mode keeps the region marquee.
- [x] Draw the marquee in ink with a highlighter wash; it is ephemeral UI state, never in
      the document or undo history
- [x] Selection semantics: **box = fully inside**; **lasso = touched/crossing**; an empty
      marquee is a **no-op**; references are click-only
- [x] Lasso selection (`G`) after the rectangular tool, sharing the same selection model;
      freehand polygon, Shift/replace behaviour
- [x] Tests: pure box/lasso cases plus e2e marquee + Backspace, profile marquee, and
      mixed geometry/dimension delete

## M3 — History

**Done.** The document store, migrations, autosave, feature names, undoable feature
parameters, the ordered rebuild/cache, the worker solid cache + new/join/cut, the full
feature tree (select, rename, create, edit, reorder by drag, suppress, delete with
cascade, selection-driven history cursor), the local file menu/list (`Example.cad`, copy,
rename, new, open, download), blind/symmetric/through-all extrudes, the first TopoRef
plumbing, and evolution-based role propagation through booleans are in.

- [x] `core/doc`: feature/document schema (`Doc`, `schemaVersion`, ids, migrations) and
      the sketch in the document store rather than component state; schema v4 adds
      optional dimension label placement (`along` for linear, `distance` for radial);
      schema v5 adds planar face supports (`TopoRef` + cached `PlaneFrame`)
- [x] `core/rebuild`: ordered evaluation, per-feature status, prefix cache, generation
      counters, cancellation of stale results, and the worker solid cache
- [x] Feature tree UI: select, rename, create (insert-gap menu), reorder (drag grip),
      suppress, delete
- [x] Drags freeze the support geometry consistently: a point or line snapped to a box
      slides along the box edge and leaves the box alone (`frozenSupportPoints` follows
      point-on-line/circle support through the connected curve network). Whole-line drags
      also preserve the current direction with a temporary angle row. Regressions:
      unconstrained box + snapped line; drag the whole line and a single endpoint, assert
      the box is unchanged (and the line's slope is held for the whole-line drag).
- [x] Scrub by selecting a step: the stage renders the prefix through the active step and
      later steps are paused/dimmed. There is no separate roll-back/roll-forward control;
      opening a document leaves no step selected (full document, track at the end). The
      leading 44px tail and the trailing tail (fills the remaining width) clear the cursor,
      render the full document and hide step overlays/popovers. Escape at rest does the same.
- [x] Header `clear` is a development reset of the whole file: same document id/name,
      all steps removed (the empty timeline tail starts the first sketch), undo history
      reset. The sketch tool line has a scoped `clear sketch` that only empties the
      active sketch.
- [x] Selected-step detail line is a readout (lost support + actions + autosave) rather
      than a repeat of the step block; open sketch/suppress/delete (datum show/hide) stay
      there. Selecting a step opens its editor, double-click renames, and profile
      selection lives in the editable feature popover
- [x] The active extrude's source sketch is rendered on its plane in the model view
      (thick highlighter underlay + ink centerline over the body), showing only the
      profile loops that extrude uses and shading them with holes left open; all regions
      remain visible in profile-selection mode
- [x] Feature edit in the draggable popover: height (slider + free-form), symmetric,
      operation, end; the detail line stays a summary
- [x] Feature creation is contextual: the insert gap in the timeline opens an explicit
      support popover; `extrude` on a selected sketch starts a draft with no profile
      selected and only creates the feature after profiles and parameters are applied.
      New sketches/planes insert after the selected step and clear that step's special
      overlay while the draft/support picker is open.
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
- [ ] Extrude intersect — the fourth operation; contract in
      `docs/showcase/BOOLEANS.md` (cut is red, intersect is ghost)
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

## M4 — Sketch supports: datum planes and faces

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
      supports. The plane chip carries an always-visible eye toggle (outline shown,
      struck hidden); it is the only visibility control, and hidden steps dim without
      extra meta text. Broader visibility toggles (bodies/sketches/constraints) remain
      the M8 design pass.
- [x] Datum-plane drafts preview the candidate plane in the model view (updated live from
      type/base/distance) while the body is dimmed.
- [x] Sketch-support picker: one typographic list for world planes / planar faces / datum
      planes. World/face/datum choices are in, selecting one previews its plane on a dimmed
      body, and lost references are visible with recovery. Per-row hover flash can still be
      refined.
- [x] Datum/world sketches project the rendered prefix body's B-rep edges into the sketch
      frame as faint fixed reference lines, so a plane sketch has a spatial reference to
      the body that exists at that step. Face sketches keep their supporting boundary.
      Explicit user projections (arbitrary edges/faces) remain separate.
- [ ] Support-list details: face name + area, curved “unsupported” explanation, datum
      “between faces”, and a pending “untitled” history row while choosing (mockup 04)
- [ ] Through-3-points and angled planes after datum points/axes land (M6), unless needed
      sooner.

### Sketches on faces

- [x] Face → `TopoRef` on selection; `PlaneRef.kind = "face"` (schema v5)
- [x] Deterministic face frame (origin, x-axis) + cached frame fallback
- [x] Sketch on a planar face of a solid; the 2D sketch surface uses the face frame and
      the model overlay/extrude map through it (no 3D camera turn needed)
- [x] Project the supporting face's boundary into the sketch as fixed reference
      geometry, and label it. Projected lines are selectable and constrainable; they
      start as construction, and a selected line can toggle to a normal profile boundary
      (still fixed/derived) or use its `source face` chip. Outlines are cached on the
      sketch feature and re-derived after every rebuild.
- [x] **Live reference geometry**: projected point/line/face outlines store the `TopoRef`
      they came from, are re-derived from the source feature's cached prefix solid on
      every rebuild, and are kept as cached geometry (marked stale) if their topology
      changes. Downstream booleans cannot move or split them.
- [x] **Line snapping regression:** every existing line is a snap target (ordinary sketch
      edges, the fixed X/Y axes and projected boundaries), with points, crossings, lines
      and the grid in that order. A snapped vertex gets a `pointOnLine` for every line it
      lies on; at a crossing it attaches to both lines, and snapping to an existing point
      reuses that point (coincident). Drawing tools are not intercepted by existing curve
      hit targets. E2E covers off-grid edge snapping and a crossing.
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
- [ ] Project arbitrary body edges/faces into a sketch with a `project` tool (the
      support boundary above is automatic). The full projection suite (project / include
      3D / intersect / project-to-surface) is deferred; see M9.
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

## M5 — Refinement features

### Sketch refinements (from gap backlog)

- [x] Collinear constraint. The solver has no collinear primitive, so it maps to
      parallel + point-on-line (a shared endpoint needs only parallel); it is one
      document constraint/chip with solver and drag rows. Covered by unit tests
      (solver, DOF and drag) and the collinear e2e case.
- [x] Sketch-create variants in the tool options row under the tool line (the same row
      as the select filters): corner / center / 3-point rectangle, center / 2-point /
      3-point circle, and 3-point / center / tangent arc. The 3-point rectangle uses
      parallel/perpendicular (it can rotate); the centre arc is CCW from start to end;
      a tangent arc starts at a line endpoint because `slvs` tangency needs a shared
      endpoint. Polygon remains low priority.
- [x] **Constraint mark grammar, Phase 1** (`docs/showcase/CONSTRAINTS.md`): a pure
      `src/sketch/constraintMarks.ts` layer draws equal ticks/group order, point-on-object
      rings and normal/radial ticks, the symmetric connector + inward chevrons + active
      axis, coincident ring/dot, midpoint half-dot, fix pin, the perpendicular square
      (falling back to badges + tie), the collinear tie/badge and the tangent diamond/tick.
      H/V/∥/⊥/≡ stay as badges; marks are screen-space and styled quiet / hover /
      selected. A mark is its constraint's handle: hover links the companions and
      participants, click selects the constraint, Backspace/Delete removes it
      (constraint selection is ephemeral). The angle inline editor now shows `°`
      instead of `mm`.
- [ ] **Constraint marks, Phase 2**: conflict ghost + `!`, stacking slots/LOD clusters,
      coarse-pointer hit targets, and the remaining perpendicular/tangent fallback cases.
- [ ] **Measurements, Phase 3**: open arrowheads on angle/radius leaders, the diameter
      through-line/leader choice, witness-line gaps, label collision defaults, and the
      0° angle behaviour.

### Model refinement

- [x] Fillet (constant radius) on selected edges, with failure handling
      (`filletWithEvolution` so downstream refs survive). Schema v9 `FilletFeature`;
      edges are `EdgeRef` = two adjacent face refs + an edge hint, resolved by their
      shared boundary so a plate resize keeps the fillet. Multi-edge selection in the
      model view (Shift adds/toggles) opens the selection popover; `fillet` starts a
      UI-only draft that previews through the kernel, with radius, removable edges,
      cancel and apply. The worker re-derives face roles geometrically after a fillet
      (OCCT reports an empty evolution) and names the rounds `fillet:round:<i>` so the
      step highlight and downstream refs work. Lost edges / impossible radii are
      visible step errors; the unchanged body stays visible.
- [x] Chamfer (constant distance) on selected edges, sharing the fillet's `EdgeRef`,
      multi-edge selection, preview, live edit, failure handling and role re-derivation.
      Schema v10 adds `ChamferFeature`; the example ships a suppressed `Beveled plate`
      alternative on the same four edges.
- [x] **Shell (open faces)** — schema v11 `ShellFeature` (open-face `TopoRef`s + wall
      thickness). The worker resolves the faces against the prefix, calls
      `shellWithEvolution`, keeps the outer face roles by geometric re-derivation and
      names the generated inner/rim faces under the step (`shell:face:<i>`), so the
      highlight and downstream picks work. A wall thicker than the body can absorb is a
      visible error (OCCT silently returns a larger solid), and the unchanged body stays
      visible. New shells preview through the kernel; editing commits live; cancel
      restores faces and thickness. The example does not ship a shell step.
- [x] **Revolve v1** — schema v14 `RevolveFeature` for a closed profile swept around an
      in-plane sketch line or X/Y axis. The profile popover's `revolve…` chip opens a form
      with explicit axis chips or a stage click on a sketch line/X/Y reference (no silent
      default), 1–360° angle, ccw/cw for partial,
      new/join/cut, live worker preview, re-editable history step and cancel/restore.
      Regions must stay on one side of the infinite axis or touch it. The stage axis-pick
      highlight, intersect, and the start-profile/angle-arc preview remain open.
      Contract: `docs/showcase/REVOLVE.md`
- [x] **Offset Faces v1 (planar + full cylinders)** — schema v13 `OffsetFaceFeature`
      with face refs and a signed distance. The plan path sweeps planar faces with
      parallel normals and neighbours the sweep preserves; the cylindrical path moves one
      full 360° hole/boss wall with a concentric cylinder/tube boolean (through holes
      only). The popover shows `Ø old → new`, the draft previews live with true
      added/removed boolean-difference meshes over a faint ghost of the pre-offset body,
      apply inserts a history step, edit commits live and cancel restores the baseline. Roles carry through, and same-domain faces merge on an isolated BREP
      copy so a cube keeps six faces and a plate keeps its wall/hole faces. Partial
      cylinders, blind holes, non-parallel sets and no-op results are visible errors.
      Design: `docs/showcase/OFFSET_FACES.md` + `offset-faces.html`; decision:
      [ADR-0006](decisions/0006-offset-faces.md)
- [ ] **Offset Faces v2** — blind and partial cylindrical faces, adjacent non-parallel
      faces with a rebuilt corner, the tangent-chain toggle, and the normal arrow/dashed
      input-face ghost (the whole-body ghost is in v1)
- [x] Selection UX: box and lasso select model edges, hover prehighlight, selection
      filters, and Select Other for cycling overlapping picks. Box = every projected
      vertex inside (window), lasso = touched/crossed; both select through the body,
      Shift adds, an empty marquee is a no-op, and the same jobs feed the fillet/chamfer
      set. Faces are a second multi-set: Shift-click and the marquee under the `faces`
      filter collect them, the face popover offers `new sketch` / `shell…`, and a plain
      pick replaces the other kind. Edge-chain selection is still open.
- [x] **Selection contract** (`docs/showcase/SELECTION.md`): click selects and feature
      chips start operations. A profile has its own popover (`all / voids / auto`,
      `extrude…`, `clear`); a face offers `new sketch` / `shell…` and never extrude; edges
      keep `fillet…` / `chamfer…`. Normal sketch marquees select geometry/dimensions
      through the filter; only profile mode marquees regions. Geometry + dimensions mix,
      delete spans the allowed pair in one undo, and a selected dimension can open its
      editor from the popover. Reference geometry stays click-only and model Delete stays
      a no-op.
- [x] **Tool options row** (design: `docs/showcase/select.html` and `select-model.html`;
      `TIMELINE.md`): a second row under the tool line that follows the *tool*, not the
      mode. One filter at a time (no multi-select), and the row collapses for tools with
      no options. Sketch create tools use the same row for their variants (corner/center/
      3-point rectangle, center/2-/3-point circle, 3-point/centre/tangent arc). Sketch
      select gets `all / points / curves / dimensions` (hit-testing is gated;
      region/profile hit targets only answer under `all`). Model select gets
      `all / edges / faces`; a filtered-out hit is blocked rather than clearing the
      selection. Select Other shows the overlapping edge/face candidates at the cursor
      and cycles them on click. **Bodies wait for multi-body**. Sketch create variants
      (`rect`/`circle`/`arc`) are in this same row. Do not bolt filters into the
      selection popover.
- [x] **Browser test architecture** (`docs/TESTING.md`): area-split specs with shared
      helpers in `e2e/support/`, one `resetExample` setup per test, fail-fast default,
      4 local workers (~1.2 min for the whole suite), the example's metrics in one
      module, and authoritative `data-*` readouts instead of guessed pixel state.
      New ephemeral modes go into the shared reset, not individual tests. Shell lives in
      `shell.spec.ts` (100 browser tests total as of the split).
- [ ] Section Analysis: a view-only inspect overlay (never in history), with the
      visibility questions resolved first
- [x] Feature selection highlights the geometry that feature created (mockup 03:
      selecting the gusset extrude washes the gusset, not the whole body). Extrude
      steps wash the faces whose `TopoRef.source` is that feature; a join/cut therefore
      shows only the faces it added.
- [x] Measure tool (distance, angle, radius, area, perimeter, centre of mass). `m` or the
      model tool row opens a mode; up to two face/edge targets are measured exactly in the
      worker by the rendered prefix's cacheKey (body properties with no target, face
      area/perimeter, edge length/circular radius, two-target minimum distance and face/
      line angle). The popover is the readout; drawing the measurements *on* the model as
      annotations (mockup 03) is still open.
- [x] Body health line: 1 body · 1 shell · N faces · watertight, alongside volume and
      bounds (mockup 03/05). The worker reports `bodies`, `shells` and BRepCheck `valid`;
      the foot's `body-health` readout exposes them. No raw open-edge count: seam edges
      would be misreported (see AGENTS).
- [x] Export STL + STEP from the worker, derived from the current rebuild state (not a
      frozen mesh). The file menu exports the last successful solid of the rendered
      prefix by its `cacheKey`: binary STL (same 0.05 tolerance as the stage, so the
      triangle count matches the stats) and STEP (`ISO-10303-21;`). Disabled when the
      cursor has no body; a cleared prefix cache is a visible error. The export *page*
      below (checks, size, build-volume fit) remains.
- [x] Export page (mockup 05): visible model, body/watertight/shell/no-open-edges/outward
      normals, units/scale/triangles/file size, build-volume fit, one quiet export action.
      The file menu's `export…` opens it; checks gate the STL/STEP actions; the binary STL
      size is exact (`84 + 50 × triangles`); the build volume is a documented 220 × 220 ×
      250 default (a profile setting can replace it). Opening it dismisses live
      editors/drafts and the stage selection, and a successful export closes it.
- [ ] Body appearance (mockup 08): **document data** attached to the body-creating
      feature; only that step owns it. Later join/cut keep the same body/look; the chip
      popover edits it; it round-trips in `.cad` and is an undoable edit.

**Done when:** you can fillet the four vertical edges of a plate, then change the plate
size and the fillets survive. The printer export page reports real checks and produces
an STL derived from the current history.

## Next: Boolean operations (M5.x; [BOOLEANS.md](showcase/BOOLEANS.md))

This is the next implementation step. The offset-face diff is the reference preview; the
operation vocabulary and colour language are already specified.

- [ ] Add `intersect` to `ExtrudeOperation`/`KernelOperation`, the document validation and
      the worker boolean branch (`intersect`/`intersectWithEvolution`), with visible
      no-base and empty-overlap errors.
- [ ] Replace the extrude `<select>` with one segmented row on extrude **and** revolve:
      `new body · join · cut · intersect`, always in that order, all four visible.
      `new` stays the document key; the visible label is `new body`.
- [ ] Default the draft to `new body` with no body and `join` with a body. Never switch an
      operation silently after the draft opens.
- [ ] Preview grammar:
      - `new body`: result body normal, no diff;
      - `join`: added material (result minus target) in the highlighter;
      - `cut`: removed material in cut red; ghost the tool outside the target;
      - `intersect`: keep the overlap normal and ghost the discarded target/tool volume;
        never red.
      The result body itself is never repainted.
- [ ] Add a `--cut` removed-material token to the app palette and extend the viewer's diff
      layer to support the ghost state (the offset preview currently hardcodes the red).
- [ ] Request diff meshes for extrude/revolve previews only (like `offset-draft`), not for
      committed steps or export.
- [ ] Through-all remains cut-only. Cut/intersect need a base and a non-empty result;
      no-overlap/no-base are visible errors, never empty steps.
- [ ] Timeline: operation in the meta (`12 mm · cut`), output chip stays `+`/`→`; `−` is
      reserved for consumes. Re-edit restores the baseline operation.
- [ ] Tests: new body/join/cut/intersect volumes, diff triangle sides, no-base and
      no-overlap errors, through-all cut-only, edit/cancel, and the segmented row in both
      feature forms.

**Done when:** extrude and revolve share the four-operation row and every preview distinguishes
added, removed and discarded material without repainting the result body.

## M6 — More shape

Patterns, mirror, Combine and Split Body are real workflow items, not speculative.
Timeline groups are used heavily and are added below.

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
- [ ] Select first, then tool; live preview: source ink + highlighter,
      derived copies dashed/faint; apply/cancel is one undo entry
- [ ] Re-edit: select the operation (or its sources) and reopen the same popup with its
      current parameters; changing count/spacing/axis/mirror/offset regenerates copies
- [ ] Derived instances participate in regions/profiles/extrude but are not individually
      draggable or constrainable in v1; constrain the source
- [ ] Move / Copy sketch geometry, using the same preview/apply/re-edit grammar
- [ ] Keep the sketch as one history step. Pattern / mirror / offset are **sketch
      objects**, not history steps: the sketch step's detail lists them, the way a
      constraint persists. Do not nest them as timeline rows.
- [ ] Tests: pattern/mirror/offset volumes, re-edit updates downstream, JSON round-trip,
      undo, invalid offset reports, e2e preview/apply/re-edit

**Done when:** a rectangular pattern and a mirror can be applied in a sketch, extruded,
reopened, tweaked, and the solid updates — with no materialised copies in the document.

### Feature/body patterns and shape

Feature/body patterns, mirror, Combine and Split Body are the next shape work after the
boolean contract. Loft and sweep remain deferred until a real part needs them.

- [ ] Feature/body linear and circular patterns (reuse the M6.0 popup/preview grammar)
- [ ] Feature/body mirror (sketch mirror lives in M6.0; this one uses `TopoRef` evolution)
- [ ] Datum axes and points (through-point planes, sweep paths) as enabling infrastructure
- [ ] Loft/sweep — deferred until a real part needs them; the revolve axes are already
      in-plane sketch lines.
- [ ] Helix (threads, springs) — optional
- [ ] **Combine** — join / cut / intersect, keep tool bodies, use a body as a tool
      (elevate general body booleans to a real feature). Target and tool are a selection
      in the feature popover, not a second document list.
- [ ] **Split Body** — split with a plane / face / body, keep both halves as independent
      bodies with stable references; a split mints new body ids carrying a role +
      geometry `TopoRef`, and a lost splitting plane/face uses the lost-support
      precedent (error + reselect/revert, never a silent fallback).
- [ ] **Move / Copy bodies** — persistent, re-editable feature: a move references its
      body (`→`), a copy produces a new body chip (`+`); downstream steps follow it
- [ ] **Align** — line up bodies/faces without hand-measuring

### Timeline: bodies and groups

Design contract: [`docs/showcase/TIMELINE.md`](../showcase/TIMELINE.md) and
[`bodies.html`](../showcase/bodies.html). The step block, output chip, insert gap,
selection-as-cursor and readout-only bottom line landed in M3. Bodies and groups wait for
the multi-body work.

- [ ] **Bodies in the timeline.** One step can produce a set of bodies; disjoint results
      stay separate and shared-edge results fuse. Steps show bodies, sketches and planes,
      each with its type dot. Body/sketch/plane chips are selectable things: selecting one
      highlights it in 3D and opens its popover. The chip owns rename (double-click) and
      the **eye split control**; visibility is never a footer command. Only the
      body-creating step owns appearance (document data). Consumed bodies strike through
      their name only; lost bodies show ink, a dotted rule and `!` with reselect/open
      sketch, and recovery **offers follow-the-merge** (never automatic). Body ids must be
      namespacable later as `componentId/bodyId`.
- [ ] **Body identity through booleans.** A join/cut references (`→`) an existing body;
      Combine/Split Body (above) create, consume and split body identities, and downstream
      references surface a lost body visibly. A join whose result is disjoint must surface
      (not become a second body); detecting that reliably needs the multi-body/Combine
      work because OCCT can return a touching fuse as a compound.
- [ ] **Groups.** Named, collapsible groups of related history steps; a bracket across the
      members, a stack chip when collapsed (mark + name + count; **no peek**), collapse
      always allowed (if the cursor is inside, it moves to the end with no active step,
      exactly like the empty tail), drag-step-onto-adjacent-step to group,
      contiguous members only, a one-step group dissolves. The active-step-inside-group
      double rule (while expanded) and divider/`+` inset are decided (keep as designed).
      Groups are used heavily (about ten in the target workflow). Pattern/mirror/offset are
      sketch objects listed in the sketch step's detail, not timeline rows.
- [x] **Bottom status line is readout-only**: lost support, the remaining actions and the
      autosave note; it does not repeat the step block. The lost-body message joins it
      when bodies land.
- [x] **No silent fallbacks.** A first join with no base is a visible worker error; the
      extrude draft defaults to `new` when there is no unsuppressed body. Lost-body
      recovery offers follow-the-merge. Disjoint-result detection is queued with
      multi-body/Combine.

## M7 — Parameters

- [ ] Named parameters with units; `Expr` evaluation + dependency ordering
- [ ] Expression editing on every dimension field
- [ ] Parameter table UI, rename with reference updates
- [ ] Cycle detection with a clear error

## M8 — Later / maybe never

Assemblies and joints, drawings, STEP import, curved-face sketches, sheet metal,
collaboration, plugin API.

### Assemblies (largest structural gap)

Multi-component assemblies are the largest structural gap between the current single-body
scope and the target workflow. This is a layer, not one feature, and needs its own design
pass before scope is fixed.

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

## M9 — Out of scope / deferred (unscheduled)

This is the limitations list, not a delivery milestone. Promote an item only with a real
milestone, an ADR if it changes a design decision, and numeric tests.

### Sketch entities and tools

- Ellipses, parabolic/hyperbolic arcs, general conics and general B-splines/NURBS. The
  solver has no entity for these; approximate with lines/arcs until promoted.
- Cubic Bézier (`E_CUBIC` exists in the solver, but the document, tool, profile extraction
  and kernel path do not expose it).
- Free 3D sketch entities and 3D constraints; the document and solver are 2D-plane.
- Sketch text/images.
- Split-at-point / divide-into-N: only intersection splits and trim exist today.
- Full sketch offset is part of M6.0; feature/face offset is the separate M5 offset step.

### Features, bodies and assemblies

- Loft and sweep; a 3D sweep also needs the free-3D-curve work above.
- Draft, multi-face Press/Pull/thicken, holes/threads, helix features.
- Feature/body patterns and mirror, Combine and Split Body (M6), including stable body
  identity and `TopoRef` evolution.
- Drawings, STEP import, sheet metal, curved-face sketches, collaboration and a plugin API
  (M8).
- Full projection/import of arbitrary solid geometry; the M4 subset only projects the
  supporting face boundary and body edges.
- Assemblies and joints (M8).

### Dropped

Slot · sketch scale · sketch extend · sketch chamfer · arc-length/tangent-distance/
ordinate dimensions · Rib · Web · Emboss · primitive bodies · silhouette split · replace /
delete face · boundary fill · stitch/unstitch/simplify · direct modeling without history.

### Open design questions

- **Combine / Split Body:** tool bodies as a selection in the feature form or a separate
  document list; how split result bodies keep stable `TopoRef` identity.
- **Section Analysis:** view-only overlay (never in history), and how it relates to the
  visibility/isolate surface.
- **Move / Copy bodies:** persistent feature vs one-shot transform.
- **Visibility toggles:** show/hide sketches, bodies, constraints, construction,
  dimensions; isolate/opacity as one coherent surface.
- **Assemblies:** component/occurrence model and `TopoRef` addressing across instances.
- **Timeline groups:** document data or presentation state; interaction with the cursor
  and suppression.
- **Projection grammar:** projection feature, sketch import or view transform.

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
