# Offset faces

> Status: **implemented v1 (planar/prismatic + full cylinders)**, 2026-11-08. The visual companion is
> [`offset-faces.html`](offset-faces.html). This is the contract for moving
> selected faces by a distance. It complements [`SELECTION.md`](SELECTION.md)
> (the face selection and its feature chips), [`INTERACTION.md`](INTERACTION.md)
> (the popover surface) and [`MODES.md`](MODES.md) (the draft's inputs).
>
> The kernel path is decided for the planar/prismatic slice and full cylindrical
> through holes/bosses (§9); blind/partial cylinders and the tangent chain remain
> open. Do not fake unsupported cases with a
> whole-body offset, a shell, a scale or an unchecked extrusion.

## The one line

**Select faces, choose `offset face…`, set a distance and direction in a
previewed history step. It moves boundary faces and rebuilds their neighbours;
the body stays one body.** This is a **model-stage feature**; it never appears in
sketch mode.

This is not:

- **an offset of the whole solid** (`offset(shape, d)` moves every face);
- **a shell** (a shell hollows the body and removes open faces);
- **a thicken** (a surface becomes a solid);
- **a sketch offset** (a sketch operation, not a body feature);
- **Press/Pull** (a multi-face direct edit; keep it separate, M9).

## 1. Why it matters

The design audit found **11 uses** — the third most-used modelling feature after
extrude and chamfer — all tolerance/fit work: glass tolerance, PCB tolerance,
gasket tolerance, enlarging battery space. It is **Keep at M5/M6**, not a drop.

The feature is a **history step**:

- it modifies the existing body (`→ body`), never creates a new one;
- selecting the step reopens the same popover; changes rebuild live;
- suppress and delete are timeline actions;
- downstream features and face sketches rebuild, or surface a lost support.

## 2. The gesture

1. Select one or more faces on the model (`faces` filter; Shift-click, or the
   face marquee). The face selection popover opens.
2. Choose **`offset face…`** from its `FEATURE` row. The other face actions are
   `new sketch…` (one planar face) and `shell…`.
3. The selection popover closes and a UI-only **offset draft** opens with those
   faces. The canvas becomes the face pick surface: click a face to add it,
   click a selected face to remove it; the preview updates.
4. Set distance, direction and (if applicable) tangent chain. The stage shows
   the result; the popover lists the selected faces.
5. `apply` inserts the `OffsetFaceFeature` after the active step and selects it.
   `cancel` drops the draft and restores the body.

**No click starts the offset.** The feature chip is the only entry, exactly like
`extrude…`, `shell…`, `fillet…` and `chamfer…` (`SELECTION.md` S1/S6). Double-
clicking a face does nothing special.

Editing an existing offset step uses the same popover: changes commit live,
`cancel` restores the face set and value from when the popover opened.

## 3. The popover

```
┌──────────────────────────────────────────────┐
│ NEW FEATURE / OFFSET FEATURE                 │  drag handle
│ Offset face                                  │
├──────────────────────────────────────────────┤
│ faces        2 selected                       │
│  Face 1      planar · 640 mm²          remove│
│  Face 2      cylindrical · 188 mm²     remove│
│ distance     [ 2.0 ] mm   ─────●─────        │
│ direction    out  |  in                       │
│ chain        tangent chain                   │
│ result       Ø 20.0 → 20.4 mm                │
├──────────────────────────────────────────────┤
│ moves the selected faces along their normals │
├──────────────────────────────────────────────┤
│ +2.0 mm · 2 faces               cancel  apply│
└──────────────────────────────────────────────┘
```

- **Kicker** `new feature` for a draft, `offset feature` when editing a step.
- **Title** `Offset face` for one, `Offset N faces` for several.
- **Faces** rows: a `faces 2 selected` header row, then one `Face 1 … remove`
  row per face with a short surface detail (planar/cylindrical, area). Clicking
  the stage also adds/removes. The list is the input's detail and scrolls; long
  sets do not grow the popover. See [`PICKS.md`](PICKS.md) for the shared input
  row/list grammar.
- **Distance** is the shared `MeasureField` (range + exact field + unit). The
  slider ceiling is adaptive (a sensible fraction of the shortest adjacent/
  body dimension); the number field may exceed it to surface a failure, never to
  silently clamp.
- **Direction** is `out` / `in` relative to each face's normal (a flip). The
  distance stays positive; the summary shows `+`/`−`.
- **Chain** is a toggle that expands the selection to the tangent-connected
  faces; it is a selection helper, not a second distance. If the kernel cannot
  offset a chain reliably, the error is visible; do not silently drop the chain.
- **Result** is a derived readout for a single cylindrical face: e.g.
  `Ø 20.0 → 20.4 mm`, with `enlarge`/`shrink` when the face is a hole/boss wall.
  It is not document state. For planar/mixed selections it is omitted.
- **Footer** summary: `+2.0 mm · 2 faces`, `Ø 20.0 → 20.4 mm · 1 face`, etc.
  Quiet `cancel`, primary `apply` (or `offset` for a draft). The summary is
  value · input; the list is not repeated.
- **Disabled primary**: no faces, distance 0, or a known-invalid preview.
  Enter with a disabled primary is a visible no-op with the reason.
- **Error**: inline in the popover, honest and specific: "The offset is too
  large for the adjacent faces", "The result is not a closed body", "This face
  has no stable reference after the edit". The last good preview stays visible;
  apply stays disabled. No silent fallback.

## 4. Distance and direction

- **Distance is unsigned** in the popover; `direction` is a flip. The document
  stores a **signed distance** (positive = out along each face normal). A
  negative number in the exact field normalises to its absolute value and flips
  the direction. The UI/log summary always shows the sign.
- **`0` is a no-op**: the primary is disabled, no history step is created.
- **`out` / `in` is per face normal**, not world up/down. On a hole wall the
  arrow may point into the hole while the hole grows; the circular readout makes
  the result explicit. On a boss wall the same direction shrinks the boss.
- **The normal arrow** is drawn at the selected face centre, with the distance
  beside it. Flipping the direction moves the ghost to the other side of the
  face. The arrow is a preview, not a pick target.
- **No symmetric / two-sided / to-reference** mode in v1. Those are separate
  open questions (O6/O7); one distance, one direction.
- **The number can exceed the slider** to probe a failure; the rail is a
  shortcut, not a hard limit (the same rule as every other length control).

## 5. Which faces

| Face / selection | Expected behaviour |
| --- | --- |
| **Planar top/bottom** | moves the face along its normal; thickness/extent changes; adjacent walls stretch |
| **Planar side** | moves the wall in/out; the body grows/shrinks; opposite wall stays |
| **Cylindrical boss wall** | changes the boss radius; the circular readout shows `Ø old → new` |
| **Cylindrical hole wall** | changes the hole diameter; `enlarge`/`shrink`; the wall stretches through the body |
| **Two opposite faces** | both move; the span grows/shrinks; too far inward collapses → error |
| **Two adjacent faces** | the shared edge moves; the corner rebuilds; self-intersection → error |
| **Disjoint faces** | each moves independently by the same distance; one body |
| **Face with a hole / inner wire** | the face and its inner loop move; the hole wall stretches; too close to an edge → error |
| **Face with a boss or a downstream feature** | history order decides; the edit may consume/intersect it → visible error, never a silent skip |
| **Tangent chain** | `chain` expands to tangent-connected walls/fillets; the chain moves together; kernel-dependent (O3) |
| **Fillet / free-form face** | allowed to try; a failure is visible; the study prioritises planar and cylindrical |
| **Face on a shelled body** | not v1; either a clear error or a later decision (O8) |
| **Faces on more than one body** | not v1; one body per feature (multi-body later) |

The feature uses the **source prefix** face refs. During the draft, additional
picks resolve against that prefix, not the preview body — the same rule as the
shell and blend drafts. The preview body is the result, not a new pick surface.

## 6. Preview and selection overlay

- The input faces keep a **highlighter wash** on the source prefix; the normal
  arrow and distance sit on the face.
- The **preview body** shows the result. The worker returns two boolean-difference
  meshes: added material in the highlighter and removed material in red, over a
  faint ghost of the pre-offset body. The ghost and difference are previews,
  never pick targets. A dashed **ghost of the input face** and normal arrow are
  still open. This added/removed/ghost grammar is the source of truth for every
  boolean preview; see [`BOOLEANS.md`](BOOLEANS.md).
- **Offset faces has no operation row.** It always modifies the selected body
  (`→ body`); `out`/`in` is a signed distance, not `join`/`cut`. Do not add
  `new body / join / cut / intersect` to this form.
- The selected face rows in the popover are the source of truth for the input
  set; stage clicks toggle that set.
- On apply the preview becomes the step's body. On cancel the original body
  returns.
- The face selection overlay during the draft follows the same rule as the
  fillet/shell drafts: the source prefix provides the highlighted faces; the
  preview mesh is the kernel result.

## 7. Failure, limits and health

- **Adaptive quick range**: half the shortest adjacent dimension is a sensible
  slider ceiling; the exact field can exceed it. The rail is not a limit.
- **Too large / self-intersection**: the adjacent faces cannot absorb the move.
  Show the error in the popover and keep the last good body. Apply disabled.
- **Inward collapse**: a distance that would invert a wall or close a solid is
  an error, not a zero-thickness body.
- **Invalid result**: the worker checks `isValid` / closed shell; a result that
  is not a single valid body is rejected.
- **No movement**: a result that does not actually move the selected face is an
  error ("The offset did not change the face"), not a success with a no-op step.
- **Health**: body stats and the export page use the same `valid` flag; an
  offset that leaves an open shell cannot be exported.
- **No silent fallback**: do not substitute a whole-body offset, a shell, a
  scaled body, or a degenerate extrude.

## 8. History, roles and downstream

- The feature type is an **`OffsetFaceFeature`** (name TBD), a history step with
  face refs, a distance and a direction. It modifies the existing body
  (`→ body`), not a new body.
- The step meta: `+2.0 mm · 2 faces` or `Ø 20.0 → 20.4 mm · 1 face`; the output chip is
  `→ ○ body`.
- Selecting the step opens the same popover; edits commit live; `cancel`
  restores the baseline. Suppress/delete are timeline actions.
- **Roles**: the moved face keeps its role if it is the same face; the worker
  re-derives every old role geometrically after the offset (like the fillet/
  shell steps). A face that splits/merges loses its role and downstream refs
  surface `lost support` with reselect/revert.
- **Downstream sketches on the moved face** follow the re-derived frame; if the
  face is gone, the lost-support path is used. No silent re-target.
- The feature must be deterministic: same input faces/distance → same body.
- The step lands **after the active step**, like every insert; the prior prefix
  is its input.

## 9. Kernel feasibility

`brepjs` today exposes:

- `offset(shape, distance)` — offsets **all** faces of a solid (and returns a
  shell in this kernel);
- `offsetFace(face, distance)` — returns an offset **`Shape3D` from a face**,
  not a modified solid;
- `shell`, `thicken`, `removeFaces`.

There is no selected-face-on-a-solid operation. **v1 implements the planar,
prismatic slice** as a checked rebuild, plus a full cylindrical wall path:

1. resolve each selected face on the source prefix and require it to be planar;
2. require every selected normal to be parallel;
3. require every adjacent surface to be preserved by the sweep (a planar
   neighbour's normal is perpendicular to the move; a cylindrical neighbour's
   axis is parallel to it);
4. extrude the face by the signed distance and fuse (out) or cut (in);
5. reject an empty/multi-body/invalid result and a no-op, then re-derive roles
   and carry the moved face's role to its new face.

This is exact for a single planar face on a prismatic body (top/bottom, side,
faces with holes, opposite parallel faces). It is **not** a whole-body offset:
the unchecked prism leaves L-steps at adjacent faces and undercuts at tangent
top-edge fillets, which is why the checks reject those inputs.

Same-domain merge: `unifySameDomain` restores the minimal face count (a cube goes
10 → 6 faces; the example plate's top offset stays 7 faces). Calling it directly
on a shape that shares subshapes with the cached prefix corrupts a later fuse, so
v1 unifies an **isolated BREP copy** and adopts the result; the prefix is never
touched. The raw unify bug is still worth an upstream ticket.

**Cylindrical slice:** one full 360° wall with `area ≈ 2πrh`. A through hole is
enlarged with a larger cut cylinder and shrunk by fusing an annular tube; a boss
is grown by fusing an annular shell (a solid cylinder would fill a coaxial bore,
e.g. a revolve tube) and shrunk by cutting an outer annular tube. The
new wall keeps the old role, matched by its axis and new radius. Blind holes and
partial cylinders are visible errors.

Still open, in order:

1. **Blind holes and partial cylindrical faces**;
2. **Adjacent non-parallel faces** (the shared corner must be rebuilt, not two
   bosses meeting);
3. **Tangent chain** and general curves/fillets.

If the kernel cannot do a case reliably, surface the error and defer it. Do not
ship a whole-body offset with a face-selection label; the result would be a
different feature.

## 10. Decisions

| # | Decision | Why |
| --- | --- | --- |
| F1 | **Select first, offset second.** The face popover has `offset face…`; the chip starts the draft. | Consistent with `SELECTION.md` S1/S6. |
| F2 | The offset is a **history step** that modifies the body (`→ body`), never a new body. | Re-editable, suppressible, downstream rebuild. |
| F3 | Distance is unsigned in the popover; **direction is a flip** (`out`/`in`). The document stores a **signed distance**. | A positive rail is intuitive; the summary carries the sign; the worker applies one signed move. |
| F4 | Use the shared **MeasureField**; the slider ceiling is adaptive and the number can exceed it. | Every length uses the same control; a failure must be surfaceable. |
| F5 | The input faces come from the **source prefix**; the preview body is the result, not a pick surface. | Same rule as shell/blend drafts. |
| F6 | **No silent fallback.** Too large / self-intersection / no movement / invalid body is a visible error; the last good body stays. | The app's general rule. |
| F7 | The worker **re-derives face roles** and downstream refs follow or report lost support. | Downstream sketches, fillets and booleans must not silently break. |
| F8 | The face popover keeps `new sketch`, `offset face…` and `shell…`; they are different features, not aliases. | A face is a support; offset moves it; shell hollows the body. |
| F9 | v1 allows **planar/prismatic** faces; cylindrical walls and other surfaces are v2 or fail visibly. | The sweep is exact only where the neighbours are preserved; the real tolerance uses still need the cylindrical slice. |
| F10 | No **symmetric / two-sided / to-reference** offset in v1. | Keep one distance, one direction; revisit with a real fit case. |

## 11. Open questions

| # | Question | Current proposal | Status |
| --- | --- | --- | --- |
| O1 | Exact kernel operation for selected faces on a solid? | v1: checked face sweep + boolean for planar/prismatic faces and full 360° cylindrical walls. Blind/partial cylinders still need a rebuild strategy. | **Decided for planar and full cylinders; blind/partial open** |
| O2 | Store a signed distance or positive + `flip`? | **Decided: signed `distance`**; the UI shows a magnitude and an out/in flip. | Implemented |
| O3 | Is `chain` a selection helper or a kernel offset mode? | Selection helper that expands to tangent faces; the same distance applies. | Open — not in v1 |
| O4 | Show a diameter/radius readout for a single cylindrical face? | Yes, derived: `Ø 20.0 → 20.4 mm`; `enlarge`/`shrink`. | Implemented for a single full cylindrical face |
| O5 | Are disjoint/opposite faces one feature? | Yes, one distance, one step; each face moves along its normal. | Proposed |
| O6 | Symmetric or two-sided offset? | Not v1. | Deferred |
| O7 | Offset to a face/reference? | Not v1; a different relation. | Deferred |
| O8 | Faces on a shelled body? | Not v1; error or later. | Open |
| O9 | Multi-body face selection? | Not v1; one body per feature. | Deferred |
| O10 | How is the source-face ghost drawn during the preview? | Dashed ghost + normal arrow; input faces from the prefix. | Open — not in v1 |
| O11 | What is the step type/name and output? | `offset` step, `Offset 1`, `→ body`; rollback prefix input. | Proposed |
| O12 | Does an offset that removes a face feature (boss/hole) get a special error? | Let the kernel fail; surface the diagnostic; no silent fallback. | Proposed |
| O13 | How does the feature interact with a downstream sketch on the moved face? | Re-derived role; lost support with reselect/revert if gone. | Proposed |
| O14 | Press/Pull as a separate direct edit? | Keep separate (M9); this study is the history step. | Deferred |

## 12. Current implementation and gap

Landed (schema v12, current 2026-11-10):

- `OffsetFaceFeature` (`type: "offset"`) with face refs and a signed distance;
  migration v11 → v12; rebuild evaluator and worker operation.
- The face popover's `offset face` chip opens a UI-only draft; distance,
  direction, face rows and live preview work, and `apply` inserts the history
  step after the active step.
- The worker rebuilds the planar/prismatic slice and the full cylindrical
  hole/boss slice from §9, re-derives roles, carries the moved face's role, and
  surfaces invalid/empty/no-op results in the popover and the stage status.
  Cylindrical holes are enlarged with a bigger cut; bosses are grown with an
  annular shell so a coaxial bore (a revolve tube) stays hollow.
- The `Ø old → new` readout is derived from `TopoRef.hint.radius`/`radialSign`.
- The draft shows true added/removed boolean-difference meshes (added in the
  highlighter, removed in red) over a faint ghost of the whole pre-offset body,
  so the material change is visible while the form is open.
- Editing an existing step commits live; `cancel` restores the baseline.
- The form follows [`PICKS.md`](PICKS.md): `faces N selected` and a `Face N` list
  sit above the distance row, the list scrolls, and the footer summary is
  `+2.0 mm · 2 faces`.
- A same-domain face split left by the kernel is coalesced for refs, the seam
  edge is hidden, and the reported face count is the logical one.

Still missing:

- blind holes and partial cylindrical faces;
- adjacent non-parallel face sets (they are rejected in v1);
- the tangent-chain toggle;
- the normal arrow and dashed source-face ghost (the whole-body ghost and
  boolean-difference overlays are in);
- the adaptive slider ceiling from the shortest **adjacent** dimension (the
  current ceiling is the body's shortest dimension);
- faces on a shelled body (O8).

Same-domain merging landed through an isolated BREP copy; the raw
`unifySameDomain` prefix bug is documented for an upstream ticket. A kernel build can
still leave one adjacent cylinder split after a planar offset on a filleted plate; the
worker coalesces adjacent same-surface faces for refs, hides the seam edge and reports
the logical face count, leaving the B-rep itself untouched.
