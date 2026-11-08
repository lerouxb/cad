# Selection, then action

> Status: **active contract**, 2026-11-08. The visual companion is
> [`selection.html`](selection.html). This is the contract for what a sketch or
> model selection means, which objects can mix, and where every action lives.
> It complements [`CONSTRAINTS.md`](CONSTRAINTS.md) (constraint marks and their
> selection) and [`INTERACTION.md`](INTERACTION.md) (the popover surface).
>
> When the code and this file disagree, one of them is wrong — decide which.

## The one rule

**A click selects. The selection popover holds the actions. Nothing creates a
feature just because you clicked its input.**

- Selecting a **profile** does not start an extrude. The profile popover offers
  `extrude`; choosing it starts the draft.
- Selecting a **model face** never offers `extrude`. It offers `new sketch`,
  `offset face…` and `shell…`; a face is a support, not a profile.
- Selecting **edges** offers `fillet`/`chamfer`; choosing one starts the draft.
- Selecting **geometry** offers constraints, dimensions and edit actions; the
  chips apply immediately.
- Selecting **dimensions** opens their edit/delete actions; selecting a
  **constraint** opens its name and delete. Neither is a feature.

## 1. Selection families

| Family | Members | Multiple | May mix with |
| --- | --- | --- | --- |
| **Sketch geometry** | points, lines, circles, arcs, including reference points/axes | yes, any mix of types | dimensions; reference geometry |
| **Sketch dimensions** | distance, point-line, angle, diameter/radius, reference | yes | geometry |
| **Sketch constraint** | one constraint mark | no | nothing |
| **Sketch profile** | filled regions (material or void) | yes | nothing (profile mode) |
| **Model edges** | BREP edges | yes | model edges only |
| **Model faces** | planar/curved faces | yes | faces only |
| **Model bodies** | bodies (future) | future | bodies only |
| **Feature step** | timeline step | no | not a selection popover; opens the step |

Two rules follow:

- **Within a family, any mix is allowed.** Two lines, a line + a circle, a point
  + an arc, or a rectangle's four lines are all one geometry selection.
- **Across incompatible families, a plain click replaces and Shift is blocked.**
  The model already does this for edges/faces; the sketch does it for
  constraints and profiles. It is one rule, not a per-surface exception.

## 2. Click and modifiers

| Gesture | Result |
| --- | --- |
| plain click on an object | replace the selection with that object |
| Shift / Cmd / Ctrl click | toggle the object within the current family |
| Shift click on an incompatible family | **blocked**: keep the current selection |
| plain click on empty space | clear the selection |
| Shift click on empty space | no-op (pan only) |
| click a constraint mark | select that one constraint; replace geometry/dimension selection |
| click a profile region | select the profile family; **do not start an extrude** |
| double-click a dimension label | make it the sole selection and open the inline editor |
| double-click a line/point/region | no special action (a feature is a chip, not a double-click) |
| click a reference point/axis | select for constraints/dimensions; projected lines also toggle construction/normal and expose their source face; never deletable |

**Selection order is preserved for the current gesture, not the document.** The
symmetric constraint uses the last-selected line as its axis when no reference
line is selected; that is why a Shift-click order matters. It is still ephemeral:
undo, tool change or Escape clears it.

## 3. Marquee: box and lasso

- **Box** selects objects **fully inside** the rectangle. **Lasso** selects
  objects **touched** by the path (inside or crossing).
- **The filter gates the marquee** exactly as it gates clicks:
  `all` (geometry + dimensions), `points`, `curves`, `dimensions` in the sketch;
  `all` / `edges` / `faces` in the model (bodies later).
- **Normal sketch select** marquees geometry/dimensions. **Profile mode**
  marquees profile regions; it is the exception, not the default.
- **Plain marquee replaces** the selection. **Shift marquee toggles** its
  objects into the current set. An **empty marquee is a no-op** — it never clears
  the selection.
- **Reference geometry is click-only.** A marquee never picks the origin or the
  axes; those are infrastructure, not a box-selectable object.
- **Backspace deletes the marquee selection** exactly like a click selection:
  all selected user geometry and dimensions, one undo entry. See §4.
- The marquee is ephemeral UI; it is not a feature, not a sketch object, and it
  never changes the document until the delete is performed.

## 4. Delete

| Selection | Backspace / Delete |
| --- | --- |
| sketch geometry | delete the selected user geometry; cascade-prune dependent constraints/dimensions |
| sketch dimension | delete the selected dimension(s) |
| geometry + dimensions | delete all of them in one undo entry |
| sketch constraint | remove the constraint; no geometry change |
| reference geometry | skipped — never deleted |
| profile regions (normal or draft) | **clear the region selection**; do not delete the sketch |
| model edge/face/body | no-op; delete the feature step instead (D10) |
| nothing | no-op |

- One deletion gesture is **one undo entry**, whatever mix is selected.
- Cascade pruning removes the constraints and dimensions that referred to a
  deleted curve or point; no orphan mark may point at nothing.
- Selection ids are pruned after the delete and after undo.
- A text field owns Backspace while it has focus; a number field being edited is
  not a deletion.

## 5. Actions by selection

The popover groups actions in this order. Empty groups are omitted; if no group
applies, the hint says so and only `delete` remains.

```
selection
  summary · rows (objects)
  ─ CONSTRAIN   immediate chips (horizontal, parallel, …)
  ─ MEASURE     dimension / radius / angle chips
  ─ EDIT        construction, fix, trim, fillet (sketch)
  ─ FEATURE     extrude / revolve / new sketch / offset face / shell / fillet / chamfer (starts a draft)
  ─ FOOTER      summary + quiet delete
```

| Selection | CONSTRAIN | MEASURE | EDIT | FEATURE |
| --- | --- | --- | --- | --- |
| 1 point | — | — | X/Y inline, fix | — |
| 2 points | coincident | distance | — | — |
| 1 line | horizontal / vertical | length | construction, trim | — |
| 2 lines | parallel / perpendicular / collinear / equal | angle | construction, fillet | — |
| 3 lines | symmetric (two edges about the third) | — | construction | — |
| 1 circle / arc | — | diameter / radius | construction, trim (arc) | — |
| 2 circles | equal | — | construction | — |
| point + line | point on line, midpoint | point-line distance | construction | — |
| point + circle/arc | point on circle | — | construction | — |
| line + arc | tangent | — | construction | — |
| mixed geometry | only the exact chips the subset supports | only a valid inferred dimension | construction where all support it | — |
| 1 dimension | — | edit / driving / reference | — | — |
| 2+ dimensions | — | delete only (edit one at a time) | — | — |
| geometry + dimensions | constraint/dimension chips on the geometry subset | one dimension row to edit | construction on geometry | — |
| 1+ profiles | — | — | all / voids / auto (selection helpers) | **extrude…**, **revolve…** |
| 1 face | — | — | — | **new sketch** (planar), **offset face…**, **shell…** |
| 2+ faces | — | — | — | **offset face…** (parallel), **shell…** |
| 1+ edges | — | — | — | **fillet…**, **chamfer…** |
| body (future) | — | — | — | appearance / isolate |
| constraint | — | — | reset position | — |
| reference point/axis | chips that use it | dimensions that use it | — | — |

The constraint and dimension chips come from the existing pure helpers
(`applicableConstraints`, `dimensionTargetForSelection`); the selection surface
does not invent a new combination rule. A chip that would make the sketch
inconsistent is a checked **preview**, not a written constraint.

**Immediate vs draft.** A constraint, construction, fix, trim or dimension chip
acts immediately (a dimension chip starts the dimension placement ghost, which is
the same action). A **feature** chip is a command: it starts the draft/editor and
the selection popover closes. The draft owns its inputs until apply/cancel.

## 6. Profiles and feature actions

### Sketch profile — this is what you extrude

- A profile is a **filled region** of the active sketch. It is a separate family:
  clicking one does not start a draft.
- The profile popover shows:
  - `REGIONS`: `all` / `voids` / `auto` (selection helpers; current region panel);
  - `FEATURE`: `extrude…`, `revolve…`;
  - footer: a summary of the region count; `clear` (clears the region selection).
- `extrude…` starts the new-extrude draft with the selected region(s); the draft
  popover is the height/operation form. The draft's profile mode can add or remove
  regions with clicks or a marquee.
- `revolve…` starts the revolve draft with the same profile; its form adds an
  axis and an angle (see [`REVOLVE.md`](REVOLVE.md)). The region set is still the
  one selection.
- The form's **operation row** (`new body` / `join` / `cut` / `intersect`) is the
  shared contract in [`BOOLEANS.md`](BOOLEANS.md). The selection popover starts
  the feature; it never chooses the boolean itself.
- A **void** region is a valid profile: extruding it fills the negative space.
  The region parity is shown in the popover.
- An **existing extrude's** profiles are edited from its timeline step (the
  feature popover's `select profiles`), not by selecting a region in ordinary
  sketch editing.

### Model face — this is a support, not a profile

- A face selection offers **`new sketch`** (opens the support picker with the
  face preselected), **`offset face…`** (moves the face by a distance; see
  [`OFFSET_FACES.md`](OFFSET_FACES.md)) and **`shell…`** (one or more open
  faces). It **never** offers `extrude`.
- To extrude from a face: `new sketch` on the face, draw a profile, select the
  profile, `extrude…`. This is the same path as any other sketch.
- A curved face is not a valid sketch support in v1; `new sketch` is not offered
  for it (the support picker says why). Offset face v1 accepts planar/prismatic
  faces and full cylindrical through holes/bosses; partial cylinders, blind holes
  and non-prismatic neighbours are surfaced as errors.
- Multi-face selection is for offset/shell work; `new sketch` requires one
  planar face.

### Model edge — a blend input

- Edge selection offers **`fillet…`** and **`chamfer…`**; the existing draft
  previews through the kernel. It does not offer `extrude` or `delete`.

### Model body — future

- Appearance, isolate and visibility belong to the body chip/popover, not to a
  feature. Do not invent a body action now.

### Feature steps

- A timeline step is not a selection family. Clicking it opens the step's own
  editor (sketch canvas, feature popover, datum editor). It never becomes a
  mixed selection.

## 7. Mixed selections

- **Geometry + dimensions is allowed.** They are both sketch objects; the
  popover says e.g. `2 lines · 1 dimension`. Constraint/dimension chips apply to
  the geometry subset; the dimension row has `edit`/`delete`; the footer delete
  removes everything in one undo.
- **Multiple dimensions are allowed.** The popover shows a count and a row per
  dimension; editing is one at a time (double-click one dimension to make it the
  sole selection and open its editor).
- **A constraint is single.** Clicking one replaces the geometry/dimension set;
  Shift on a constraint while geometry is selected is blocked.
- **A profile is a separate mode.** Selecting one replaces geometry/dimensions;
  it cannot mix with them. The same is true in reverse.
- **Model edges, faces and bodies do not mix** in v1. A plain pick replaces the
  other family; Shift on another family is blocked. Face multi-select is for
  shell; edge multi-select is for blends.
- **Reference geometry may mix with user geometry.** It is a valid participant
  for a constraint/dimension, but it is never deleted or made construction. The
  row shows a `fixed` note; delete skips it.
- A mixed selection hides actions that do not apply to the whole relevant
  subset; it never shows a wall of disabled chips.

## 8. One selection language

Selection means the same thing in the sketch and the model. The highlighter is a
**block mark**, not a blur or a neon glow; the ink is what makes the line read.

| Selection | Sketch | Model |
| --- | --- | --- |
| **line / edge** | highlighter block (soft token, ~12 px) under an ink centerline (~1.6 px) | the **same pair**: highlighter block (~8 px) under an ink centerline (~1.6 px) |
| **face / region** | highlighter wash fill; the ink boundary stays visible | highlighter wash fill; the body edge ink stays visible |
| **point** | marker fill + ink ring | no vertex selection yet |
| **constraint** | its own mark, ink/paper; participants washed | — |
| **dimension** | label editor at the label | — |

- **Hover is the same block at lower opacity**, with the base ink line still
  visible. Selection is the full block plus the ink centerline.
  - line/edge hover: glow ~5 px, ~0.7 opacity, no ink change;
  - line/edge selected: glow ~8–12 px, ~0.45 opacity, ink ~1.6 px.
- **Never a highlighter-only edge.** A model edge is a line; it gets the same
  ink centerline as a sketch line. A single opaque marker line that hides the
  body edge is the current model bug, not the style.
- **The pair is drawn above the selected face** (polygon offset) so the glow
  reads against the solid, but it is still depth-tested against other geometry:
  a selected back edge stays hidden behind a boss or cylinder. The ink
  centerline is what survives a screenshot and a highlighter change.
- **Faces/regions are washes**, not marker outlines. The existing ink edge is
  the boundary; do not paint a second marker outline over it.
- **Multiple edges** each get the pair; a hover highlights one edge only.
- **The selection popover chip** uses the highlighter fill; the edge/line itself
  is never a chip.
- The same tokens are used in both stages: the highlighter's soft/wash variant
  for the block, the theme ink for the centerline. The timeline's active marker
  is not a selection and does not use this grammar.

## 9. The popover anatomy

```
┌──────────────────────────────────────────────┐
│ SELECTION                                    │  drag handle
│ 2 lines                                      │
├──────────────────────────────────────────────┤
│ line 04 · 70.0 mm                            │  selected rows
│ line 07 · 44.0 mm                            │
├──────────────────────────────────────────────┤
│ CONSTRAIN  │ parallel  perpendicular  equal  │  immediate
│ MEASURE    │ angle                         │
│ EDIT       │ construction  fillet           │
│ FEATURE    │ —                             │
├──────────────────────────────────────────────┤
│ 2 lines · 4 DOF                        delete│  summary + quiet delete
└──────────────────────────────────────────────┘
```

- The popover is the same draggable `StagePopover` chrome as every other form.
- **No primary / apply**: a selection is not a form. Constraint chips act at
  once; feature chips start a command. The footer has the summary and the quiet
  destructive action only.
- Groups are **omitted when empty**; a group with no applicable actions is not
  shown. If no group applies, the hint says `no action applies to this mix`.
- The selected rows scroll inside the popover; the title carries the summary
  (`2 curves`, `1 point + 1 line`, `2 lines + 1 dimension`, `2 regions`, …).
- The body is click-through except for its controls, so the popover never steals
  a point/edge click behind it (current behaviour).
- The chip row is the same `.sc-chip` grammar as constraints; applied constraints
  are active chips and clicking one releases it.

## 10. Selection state

- Selection is **ephemeral**: not in the document, not undoable, not persisted.
- It is cleared on tool change, Escape, delete, timeline navigation, entering a
  feature draft, and new/open document.
- Escape is per-press: it clears the selection first; with nothing left to
  cancel, the next Escape clears the history cursor and shows the full document
  (the end-tail state). See `MODES.md` R1.
- Undo/redo prunes ids that no longer exist.
- Selection order is preserved only for the current gesture (symmetric axis).
- The stage renders only the selected prefix; selecting a step is the history
  cursor, not a selection.

## 11. Decisions

| # | Decision | Why |
| --- | --- | --- |
| S1 | **Select first, action second.** Clicking a profile/face/edge never starts a feature. | A click must be reversible and inspectable. |
| S2 | One family at a time; geometry + dimensions is the one allowed mix. | The popover stays coherent; delete can still span the allowed pair. |
| S3 | Box/lasso select the current filter; Backspace deletes the resulting set. | A marquee is a selection, not a profile shortcut. |
| S4 | Profile selection is its own family and `extrude…` / `revolve…` are feature chips. | The profile is the input; the feature is a decision. |
| S5 | A model face offers `new sketch` / `offset face…` / `shell`, never `extrude`. | A face is a support; a profile is what extrudes. |
| S6 | Feature chips start drafts/editors; they never apply immediately. | Consistent with the feature popovers' apply/cancel. |
| S7 | Geometry + dimensions mix for selection and deletion; constraints/dimensions apply to the geometry subset. | One box-select/delete path; actions stay truthful. |
| S8 | A constraint is a single selection and replaces everything else. | It is one object with one delete/reset. |
| S9 | Multiple dimensions can be selected; editing is one at a time. | Bulk delete is useful; bulk value editing is not. |
| S10 | Reference geometry is click-only, never marquee-selected, never deleted. | It is infrastructure, not user geometry. |
| S11 | Delete in model mode is a no-op for edges/faces; delete the feature step. | Deleting a BREP edge is not a feature. |
| S12 | Selection stays ephemeral, order only for the gesture. | Matches the existing document rule. |
| S13 | Profile mode owns marquee region selection; normal sketch marquees geometry/dimensions. | Remove the "box selects profiles" surprise. |
| S14 | No feature on double-click. | Double-click is edit/rename, not create. |
| S15 | **One selection language.** A selected line/edge is a highlighter **block** under an ink centerline; a face/region is a highlighter wash; hover is the same block at lower opacity. Never a single opaque highlighter line. | Sketch and model must read the same, and the ink keeps the geometry legible. |

## 12. Open questions

| # | Question | Current proposal | Status |
| --- | --- | --- | --- |
| O1 | Add a `regions` filter to the tool options row? | No; profile mode owns regions, normal select owns geometry. | Proposed |
| O2 | Can a box/lasso select profiles outside profile mode? | No; enter via a region click (single/multi) or a feature chip (`extrude…`/`revolve…`), then marquee in the draft. | Proposed |
| O3 | Double-click one dimension inside a multi-selection? | Make it the sole selection and open the editor. | Proposed |
| O4 | Show an inapplicable feature chip disabled or hide it? | Hide it; the hint explains when nothing applies. | Proposed |
| O5 | Is `new sketch` also in the face popover, or only the insert gap? | Both; the face popover is the direct path. | Proposed |
| O6 | Does Delete delete a selected feature step? | No; use the timeline detail (D10). | Proposed |
| O7 | Does a feature chip show a preview before the draft? | No; it starts the draft, which is the preview. | Proposed |
| O8 | Is a void-only profile extrudable? | Yes; the region is the profile; parity is shown. | Proposed |
| O9 | Should the delete summary mention skipped references? | Yes: e.g. `2 user objects · 1 reference skipped`. | Open |
| O10 | Box/lasso in the model + Backspace? | No-op for edges/faces; delete the feature step. | Proposed |
| O11 | Is there a select-all shortcut? | Not in v1. | Deferred |
| O12 | Do bodies get a selection popover? | Later; appearance/isolate/visibility, not a feature. | Deferred |
| O13 | Does a single click on a dimension open the editor? | No; double-click edits, the popover offers edit. | Proposed |
| O14 | Can a reference-only selection be deleted? | No; the row says `fixed`; Delete is a no-op. | Proposed |

## 13. Current implementation and gap

Implemented (2026-11-08):

- **Profiles are a selection family.** A filled region selects the profile and
  opens `profile-popover` (`all / voids / auto`, `extrude…`, `revolve…`,
  `clear`); it never starts a draft. `extrude…` starts the new-extrude draft with
  the chosen regions; `revolve…` starts the revolve form with the same profile.
- **Normal sketch marquees select geometry and dimensions through the filter.**
  Box is fully inside, lasso is touched/crossing; empty is a no-op, Shift toggles,
  references are excluded. Profile mode (a draft or an existing extrude editor)
  is the only region marquee.
- **Delete spans the allowed mix.** Geometry + dimensions delete in one undo;
  profile regions clear; a constraint removes itself; references are skipped;
  model edge/face/body delete stays a no-op.
- **Feature chips:** profile `extrude…`/`revolve…`, face `new sketch` (one
  planar face), `offset face…` and `shell…`, edge `fillet…`/`chamfer…`. A face
  never offers extrude. The offset chip opens the draft from
  [`OFFSET_FACES.md`](OFFSET_FACES.md); v1 accepts planar faces whose neighbours
  the move preserves plus full cylindrical through holes/bosses, and surfaces
  the rest as errors. Revolve starts the form in
  [`REVOLVE.md`](REVOLVE.md) with the same profile.
- **Mixed geometry + dimensions:** the popover lists both, constraints apply to
  the geometry subset, and one selected dimension has an `edit` chip (the label
  still supports double-click).
- In-app hints no longer say a region click starts an extrude.
- **Selection uses the pair in both stages.** `SketchCanvas.tsx` draws the soft
  marker at ~12 px under the ~1.6 px ink curve, with a ~5 px hover glow at 0.7.
  `Viewport.addOverlay` draws a selected model edge as a ~9 px block at 0.5 under
  a ~1.7 px ink centerline, and hover as the ~5 px block at 0.7; it never uses a
  single opaque marker line.

Remaining / open:

- O9 (delete summary mentions skipped references), O11 (select-all), O12 (body
  family), O14 (reference-only delete) remain as proposed/deferred.
- A profile marquee outside profile mode is still click/Shift-click only; O2
  keeps that deliberate.
- The profile popover's `auto` is the existing "largest material region"; a
  future regions filter is O1.
- Kernel/OCCT is not involved. New e2e covers profile → extrude, marquee +
  Backspace, mixed geometry/dimension delete and the face action set.
