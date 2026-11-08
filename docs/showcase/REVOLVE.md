# Revolve

> Status: **implemented v1**, 2026-11-08. The visual companion is
> [`revolve.html`](revolve.html). This is the contract for sweeping a sketch
> profile around an axis. It complements [`SELECTION.md`](SELECTION.md) (the
> profile feature chips), [`INTERACTION.md`](INTERACTION.md) (the popover
> surface) and [`MODES.md`](MODES.md) (the draft and the axis pick).
>
> Revolve is **not in the reference part** (PLAN M9), so this is a design study
> first; the kernel operation already exists.

## The one line

**Select a closed sketch profile and an axis in the sketch plane, set an angle,
and turn the profile into a solid of revolution.** The result is a history step
like extrude: new body/join/cut/intersect, re-editable, suppressible, carrying the body
downstream.

## 1. What it makes

The profile is a **cross-section**; the axis is a line in the same sketch plane.
The sweep makes the circular/arc forms that are awkward to build from extrudes:

| Profile | Axis | 360° result |
| --- | --- | --- |
| rectangle offset from the axis | outside the profile | tube / cylindrical ring |
| rectangle touching the axis | one edge on the axis | solid cylinder |
| right triangle, one edge on the axis | that edge | cone |
| half-disc, diameter on the axis | that diameter | sphere |
| circle offset from the axis, one side | outside the profile | torus |
| L-shape on the axis | the axis | stepped shaft |
| any profile, 1–359° | in-plane line | arc/wedge with two end faces |

The profile must stay on **one side** of the axis or touch it; a profile that
straddles the axis is an error (O2).

## 2. What it is not

- **Not a 3D axis.** The axis must lie in the sketch plane: a sketch line, a
  construction centreline, or the sketch's X/Y reference. A world axis outside
  the plane needs a datum axis (M6/M9) and is out of scope.
- **Not a sketch circular pattern.** That copies sketch geometry; this makes a
  solid.
- **Not a sweep or loft.** The profile rotates; it does not follow a path.
- **Not a 2D rotate.** The document feature is a 3D body operation.
- **Not a direct edit.** It is a history step, not a transform of a face.

## 3. The gesture

1. Select a sketch profile (one or more filled regions). The profile selection
   popover offers the feature chips.
2. Choose **`revolve…`** beside **`extrude…`**. The selection popover closes and
   a UI-only revolve draft opens.
3. The form has the profile and an **axis** row. Pick the axis from a sketch
   line or the X/Y reference; the stage enters axis-pick mode.
4. Set the angle (default 360°), the direction for a partial angle, and the
   operation. The profile/axis relation is validated live; the body previews
   through the kernel.
5. `revolve` inserts the step after the active step and selects it. `cancel`
   drops the draft and restores the body.

No click starts a revolve; the feature chip is the entry, like `extrude…`.
Double-clicking a profile does nothing special.

## 4. The axis

- **Candidates:** every line in the sketch (including construction), plus the
  sketch's fixed **X** and **Y** reference axes. Construction centrelines are
  the normal choice.
- **Infinite line:** the axis is the line's infinite extension; the profile does
  not have to touch the segment.
- **No silent default.** There is no "use X" or "longest line" fallback. Without
  an axis the primary is disabled and the hint says to pick one; picking an axis
  is a visible decision.
- **Axis pick mode:** choosing `select axis` enters a mode where the candidate
  lines are highlighted and the region fills are not pickable. Clicking a line
  sets the axis and returns to the form; Escape exits the pick and leaves the
  form open. Escape again cancels the draft. The axis row shows the chosen line
  (`line 04 · construction`) or `X axis` / `Y axis`.
- **Direction:** the axis line has a direction; a partial revolve sweeps around
  it by the right-hand rule. A `flip` reverses the sweep, including the side of
  the profile it starts on. A full 360° hides the flip.
- **Lost axis:** a sketch edit that deletes the chosen line is a lost support;
  the step reports it and offers reselect. Do not silently retarget to X/Y.
- **Profile relation:** the profile is on one side of the infinite line, or
  touches it. The side is the sign of the cross product; a profile that crosses
  the line is an error. A profile that only touches the axis is valid (cylinder/
  cone/sphere cases).
- **Two sides / symmetric:** a symmetric partial revolve (half the angle on each
  side of the profile plane) is not v1. A straddling profile is not a shortcut
  for it.

## 5. The profile

- One or more **closed regions** from the sketch, exactly like extrude. Multiple
  disjoint regions are revolved and fused; a region with holes keeps them
  (tube/annulus).
- The profile can be on a face support; the axis and profile live in that face
  plane. The result extends into 3D from the plane.
- **Validation:** every region must be wholly on one side of the axis or touch
  it. The check runs on the solved sketch before the preview; an error names
  the crossing region.
- **No profile = no draft**; the primary is disabled with the reason.
- Changing the sketch resets the profile and the axis (an axis belongs to a
  sketch). Do not carry a stale line id across sketches.

## 6. Angle and direction

- **Angle** is degrees, `1–360`, default `360`. The shared `MeasureField`
  (slider + exact field + unit) is the control. The slider ceiling is 360; the
  exact field cannot be outside 1–360 (a 0° revolve is not a feature).
- **360°** is closed; no direction control, no end faces.
- **1–359°** produces two planar end faces (the start profile and the rotated
  profile). A `flip` chooses the sweep direction around the axis; the summary
  shows the angle and direction (`90° · ccw`).
- **Symmetric** (half the angle on each side of the profile plane) is an open
  question (O5), not v1.
- **Precision** follows `formatLength` for the readout and `formatEditable` for
  the field; the unit is `°`.
- The dimension is not a sketch dimension; it is a feature parameter, not
  editable on the sketch.

## 7. The form

```
┌──────────────────────────────────────────────┐
│ NEW FEATURE / REVOLVE FEATURE                │  drag handle
│ Revolve                                      │
├──────────────────────────────────────────────┤
│ sketch       Sketch 1                        │
│ profile      2 profiles              select │
│ axis         line 04 · construction  pick    │
│ angle        [ 360 ] °   ───────●────        │
│ direction    ccw | cw        (angle < 360)   │
│ operation    new body·join·cut·intersect     │
├──────────────────────────────────────────────┤
│ profile must stay on one side of the axis    │
├──────────────────────────────────────────────┤
│ 360° · new body · 2 profiles   cancel apply  │
└──────────────────────────────────────────────┘
```

- **Kicker** `new feature` for a draft, `revolve feature` when editing a step.
- **Title** `Revolve`; the sketch row is fixed (changing it resets profile and
  axis) and matches extrude's sketch row.
- **Profile** row: count + `select`; enters region mode (the same region panel
  `all / voids / auto` as extrude).
- **Axis** row: current axis + `pick`; enters axis mode. The row shows the
  construction marker for a construction line and `X axis` / `Y axis` for a
  reference.
- **Angle** is the MeasureField; `direction` only for <360.
- **Operation** is the same four-way `new body / join / cut / intersect`
  segmented control as extrude, with the [`BOOLEANS.md`](BOOLEANS.md) preview
  language. `join`/`cut`/`intersect` require a base body (visible error
  otherwise); through all is cut-only.
- **Hint** names the current missing input (`pick an axis`, `pick at least one
  profile`, `the profile crosses the axis`) instead of a generic note.
- **Footer** summary + quiet cancel + primary `revolve`/`apply`. Disabled if no
  profile, no axis, angle out of range, or a known-invalid profile/axis pair.
- **Error** stays in the form and on the stage; the last good preview remains;
  no silent fallback.

## 8. Preview and stage

- The **profile and axis are highlighted** from the sketch overlay; the axis is
  a dash-dot centreline, the profile is a highlighter wash.
- The **preview body** is the result. A **start profile ghost** and an **angle
  arc** with an arrow show the sweep; a partial revolve also ghosts the end
  profile. The arc label is the angle; the flip reverses the arrow.
- The **profile/axis relation** is visible: the profile stays on one side; the
  crossing case shows the error before a preview is attempted.
- The **axis pick** highlights candidate lines and the X/Y references; the
  region fills are decoration until the pick returns to the form.
- The **operation** preview follows [`BOOLEANS.md`](BOOLEANS.md): new body and
  join show the result body; cut shows the removed volume in red; intersect keeps
  the overlap normal and ghosts the discarded target/tool.

## 9. History, roles and downstream

- New **`RevolveFeature`** history step:
  - `sketchId`, `regions: string[]`, `axis` (a sketch line id or `x`/`y`
    reference), `angle` (degrees), `operation`, and `direction` for a partial
    angle.
  - Output `+ body` for `new`, `→ body` for `join`/`cut`.
  - Step meta: `360° · new body · 2 profiles`.
- Selecting the step opens the same form; edits commit live; `cancel` restores
  the baseline. Suppress/delete are timeline actions.
- The **axis reference is a sketch line id or reference axis**, not a face/edge
  TopoRef. A sketch edit that deletes the line is a lost axis, with reselect/
  revert; no silent X/Y fallback.
- **Roles:** the result is a new body or a modified body; the worker re-derives
  face roles like extrude. Downstream sketches/edges follow the re-derived refs;
  a split/merge surfaces lost support.
- The step is deterministic: same sketch, profile, axis, angle, operation →
  same body.

## 10. Failure and limits

- **No axis / no profile**: primary disabled with the reason.
- **Profile crosses the axis**: visible error; no revolve. The profile must be
  on one side or touch.
- **0° / >360° / non-finite angle**: disabled/error; no degenerate step.
- **Self-intersection / invalid body**: the kernel result is validated; error,
  last good body, no silent step.
- **Full 360 with a profile on the axis**: allowed (cylinder/cone/sphere); seam
  faces are normal, not an open-shell error.
- **Join/cut without a base**: worker error like extrude.
- **Degenerate profile** (zero area/zero radius): error before the worker.
- **Axis not in the sketch plane**: impossible by construction (candidate set);
  a future 3D axis is out of scope.
- **No silent fallback**: no automatic X/Y axis, no profile re-target, no
  partial body.

## 11. Kernel

`brepjs` already exposes:

```ts
revolve(face, { axis?: Vec3; at?: Vec3; angle?: number })
```

- The face is the profile face in world space; `axis` is a direction vector,
  `at` a pivot point on the axis, `angle` in radians.
- The worker builds the planar face from the profile regions (the extrude face
  builder is close), places it on the sketch frame, and revolves it.
- Full/partial angle; the result is validated as a solid and joined/cut/new.
- A full 360 of a profile touching the axis should be tested for a seam and
  BRepCheck validity; a partial angle for end caps.
- The operation is available, unlike offset faces; this feature is a UI/history
  step, not a kernel spike.

## 12. Decisions

| # | Decision | Why |
| --- | --- | --- |
| V1 | **Select first, revolve second.** Profile popover has `revolve…`; the chip starts the draft. | Consistent with `SELECTION.md` S1/S6. |
| V2 | The axis is **in the sketch plane**: a line, construction line, or X/Y reference. | The sketch is 2D; a 3D axis needs a datum axis. |
| V3 | **No silent axis default**; the primary is disabled until picked. | An axis is a decision, not a guess. |
| V4 | Profile must be **on one side of the axis or touching**; crossing is an error. | Avoids self-overlap/ambiguous solids. |
| V5 | Angle is **1–360°**, default 360; direction flip only for partial. | One field, one meaning; no 0° step. |
| V6 | The form is the **same shape as extrude** (sketch, profile, operation, MeasureField, footer). | One feature grammar; the operation row follows [`BOOLEANS.md`](BOOLEANS.md). |
| V7 | A revolve is a **history step** (`+`/`→ body`), re-editable and suppressible. | Round shapes are part of history, not a direct edit. |
| V8 | **No symmetric/two-sided** in v1. | Keep one profile plane; open question. |
| V9 | The axis is a **sketch line id / X-Y reference**, not a face/edge `TopoRef`. | It lives in the sketch; a lost line is a lost axis. |
| V10 | **No silent fallback** for lost axis, crossing profile, invalid body, or missing base. | The app's general rule. |

## 13. Open questions

| # | Question | Current proposal | Status |
| --- | --- | --- | --- |
| O1 | Should a construction line be required, or is any sketch line allowed? | Any line; construction is the recommended centreline. | Proposed |
| O2 | Is a profile that straddles the axis ever allowed? | No v1; one side or touching only. | Proposed |
| O3 | Does the axis pick use the stage overlay or a dropdown? | Stage pick, with X/Y as explicit chips; the row shows the result. | Proposed |
| O4 | Should the angle have 90/180/270/360 presets? | The MeasureField is enough; presets are optional. | Open |
| O5 | Symmetric/two-sided partial revolve? | Not v1. | Deferred |
| O6 | Partial end faces: same material/appearance? | Yes; one body, same appearance. | Proposed |
| O7 | A profile with a hole and the axis through the hole? | Revolving the material on one side; validate. | Open |
| O8 | Full 360 seam handling on a touching profile? | Test the kernel; seams are normal, not a failure. | Open |
| O9 | Can a revolve axis be a datum axis outside the sketch plane? | Out of scope until datum axes; needs a 3D axis. | Deferred |
| O10 | Should the sketch step detail also offer `revolve`, or only the profile popover? | Both, like extrude's sketch-step entry. | Proposed |
| O11 | What is the step type/name? | `revolve`, `Revolve 1`, output `+`/`→ body`. | Proposed |
| O12 | Lost axis: reselect only, or also convert to X/Y? | Reselect/revert only; never silently retarget. | Proposed |

## 14. Current implementation and gap

Implemented (2026-11-08):

- Schema v14 `RevolveFeature` (`sketchId`, `regions`, explicit `axis`, 1–360° `angle`,
  partial `direction`, `operation`, `suppressed`), validation and migration.
- `revolve…` in the profile selection popover starts a UI-only draft. The form has the
  sketch/profile rows, explicit X/Y/sketch-line **axis chips**, and clicking a sketch line
  or the X/Y reference in the stage sets the same axis; the shared `MeasureField` angle,
  ccw/cw for partial angles, and new/join/cut follow.
- The engine resolves the axis against the solved sketch, rejects a missing/degenerate
  axis and a profile that crosses the infinite axis, and the worker builds each region
  with `brepjs.revolve`, fuses multiple regions, applies the sketch frame and runs the
  normal history boolean/role path.
- Apply inserts a re-editable step; edits commit live and `cancel` restores the baseline.
  The timeline shows `revolve`, the profile/angle/operation meta and the body chip.
- Full 360° touching profiles (cylinder/cone/sphere) and partial end faces are covered by
  the kernel spike and e2e.

Still open:

- **candidate highlighting during axis pick**; the stage click and chips already select
  the axis, but candidates are not pre-highlighted.
- **intersect** (the shared four-way boolean row is not in extrude either yet).
- the start-profile ghost and angle-arc preview; v1 previews the result body.
- **BOOLEANS.md** preview language for cut/intersect (the same gap as extrude).
- a 3D axis outside the sketch plane (needs datum axes).
