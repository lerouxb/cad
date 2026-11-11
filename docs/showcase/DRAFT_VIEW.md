# Feature drafts open on the model

> Status: **proposed design**, 2026-11-10. The visual companion is
> [`draft-view.html`](draft-view.html). This is a design target, **not
> implemented**: the app still keeps a new extrude/revolve draft in the sketch
> stage (§13). It complements [`INTERACTION.md`](INTERACTION.md) (the popover
> surface), [`PICKS.md`](PICKS.md) (form inputs),
> [`MODES.md`](MODES.md) (the input tables), [`SELECTION.md`](SELECTION.md)
> (selection families and feature chips), [`BOOLEANS.md`](BOOLEANS.md) (the
> preview language) and [`REVOLVE.md`](REVOLVE.md) (the axis).
>
> **Landed so far:** drafts open on the model with the preview, the source sketch
> overlay, the view-only sketch round trip, a background no-op, and the
> plane-aware oblique camera (§2.4). Profile/axis picking still switches to the
> sketch stage; the model pick modes, plane quad, on-geometry handles and the
> x-ray pick state remain.

## The one line

**A feature that consumes sketch geometry opens on the model stage, with the
source sketch laid on its plane, so the preview and the inputs are judged in
3D.**

Extrude and revolve are not sketch operations with a height field. They are
solid operations whose first input happens to be a sketch. The sketch is the
input; the model is the subject.

## 1. The problem

Today `extrude…` and `revolve…` leave the user in the sketch stage. The form is
correct — the profile row, the value field, the operation row, the footer — but
the thing being decided is invisible:

- **Depth is not on the page.** A 2D sketch can show the profile and an arrow,
  but not the solid that will appear, whether it collides with the body, or
  which side of a face it grows from.
- **The profile's relation to the body is hidden.** The sketch is on a plane in
  the model; the sketch view removes the body, the plane's angle, and every
  other body that the operation will join, cut or intersect.
- **The revolve axis is a 2D line.** The axis is easy to click in plan, but the
  tube/cone/sphere it produces, the side the profile sweeps to, and the
  end faces of a partial angle are not judgeable from the plane.
- **Editing and creating disagree.** Selecting an existing extrude step already
  opens the model and its form. Creating one should be the same surface. The
  current split makes the new draft feel like a different tool.
- **The sketch is already in the model.** The app draws the active sketch on its
  plane in the model view. The geometry exists in 3D; only the *camera* is 2D.

The sketch stage is still the right place to draw and constrain. It is the
wrong place to decide a solid.

## 2. What happens after the dialog opens

The transition is a **camera move and a preview**, not a new document state.

1. **Trigger.** The user chooses `extrude…` / `revolve…` in the profile
   popover, or `extrude` / `revolve` on the sketch step, or selects an existing
   feature step. The selected profiles are the seed (empty for the sketch-step
   entry).
2. **The source sketch becomes a draft overlay.** It is rendered on its own
   plane (world, face or datum frame) as read-only geometry: regions, edges,
   construction lines and the X/Y references. Dimensions and constraint marks
   stay in the sketch stage; they are authoring annotations, not feature input.
3. **The preview is requested immediately.** The worker builds the draft body
   while the camera moves. There is never a frame with an empty stage; the last
   good preview or a quiet `building preview` note is shown.
4. **The camera frames the operation.** It moves to an oblique view of the
   sketch plane and the preview, not to a canned world isometric. The plane is
   readable, the growth direction is visible, and the surrounding body is in
   frame. The camera does not spin; it tilts from the normal view to the
   drafting view. *Landed:* `Viewport.frameDraft` builds the direction from the
   resolved frame's axes so a sketch on an inclined face is not viewed edge-on;
   the frame is applied once per draft/editor, not on every value drag.
5. **The form appears.** The same draggable `FeaturePopover` opens top-right;
   it is never a modal and never replaces the stage.
6. **The stage becomes the draft's input surface.** Orbit/zoom work normally.
   The form's `pick` buttons switch the stage between `preview`, `profiles` and
   `axis`. The model's ordinary face/edge selection is suspended; the draft owns
   the canvas until it closes.
7. **Apply / cancel.** Apply inserts the step and stays in the model with the
   new step selected. Cancel restores the origin: the sketch stage with the
   original profile selection, or the model for an existing-feature editor.

The last frame of the sketch and the first frame of the draft share the same
geometry. The only thing that changes is the camera and the preview layer.

## 3. One scene, two cameras

This is the rule that makes the transition honest and the long-run sketch view
possible:

> **The sketch is always geometry on its plane in the model scene. The sketch
> stage is a camera normal to that plane, not a separate world.**

- The model stage has an orbit camera; the sketch stage has an orthographic
  camera along `+planeNormal`. Both render the same plane, the same body and the
  same sketch.
- Opening a draft is a camera animation from `normal` to `oblique`, plus the
  preview layer. It is not a scene swap, a route change, or a second renderer.
- `look at sketch` in the stage foot is a **view preset**, not a stage switch.
  It is available while the draft is open so the user can inspect the profile
  exactly, then turn back to the solid.
- The sketch camera stays orthographic and normal in v1 because drawing and
  snapping are precise there. The *long-run* direction is an orbitable sketch
  stage: the camera may leave the normal, but the geometry stays on the plane.
  "Partially 3D" means the view, not the solver.

The payoff is that a draft can keep the sketch visible and pickable without
making the user leave the model. It also means a sketch on a face or a datum
plane is not a special flat world; it is a plane with a frame.

## 4. What the sketch keeps while a draft is open

- **It is read-only input.** The draft suspends sketch editing: create tools,
  constraints, dimensions and trim are not available. To change the sketch,
  cancel the draft (the sketch is restored where it was).
- **It is drawn on its plane.** The draft overlay uses the resolved frame, not
  screen space, so a sketch on an inclined face is drawn on that face.
- **It is x-ray while a pick is active.** The body can occlude its own source
  plane. When the draft enters a profile or axis pick, the preview ghosts and
  the selected profiles, candidate axes and region boundaries are drawn above
  it so they stay readable and pickable. While the preview is solid (tuning the
  value), the body owns the plane; the source is not forced through it as a
  wireframe. After apply, the overlay returns to depth-tested drawing, as it is
  today.
- **It shows the regions, not the annotations.** Region fills/outlines, sketch
  curves and the X/Y references are in the overlay. Dimensions, constraint marks,
  the grid and the sketch's own selection popover are not; they belong to
  authoring.
- **A faint plane quad** marks the sketch plane while the draft is open. It is a
  view aid, not document data, and it disappears with the draft.

## 5. Picking profiles in the model

Profiles are **a model pick mode**, not a stage switch. The form's row changes
from `profile 2 selected  pick in sketch` to `profile 2 selected  pick` (and
`done` while picking).

- Entering profile mode makes the **region fills** the primary pick targets:
  material regions and void profiles, exactly the same region ids the sketch
  stage uses. The preview body ghosts (a low-opacity result) so the plane and the
  fills can be seen.
- A plain click toggles a region. Shift adds. Box and lasso select regions in
  bulk on the plane. An empty click in profile mode does **not** cancel the
  draft; it clears the transient hover/pick and stays.
- The model tool row shows the draft's input state (`profiles`) and a quiet
  `done`; it is read-only for ordinary selection families. The form's `pick` /
  `done` is the same switch.
- The profile list (`Profile N · area · remove`) is the truth. It updates on
  every pick; removing from the list updates the stage. Zero profiles shows
  `0 selected`, no list, a hint and a disabled primary.
- **Deselecting all profiles does not cancel the draft.** Like the sketch-stage
  profile selection (MODES D7), it leaves the form open with an explanation.
- A void profile is selectable as a void, not silently folded into its parent.
  The same `All / Voids / Auto` helper is available when there is more than one
  region.

Why a pick mode rather than always-live fills?

- The preview body needs to be solid while the user is tuning the value; a
  permanently clickable x-ray plane would make every orbit end in a profile
  toggle.
- The axis pick already uses a temporary candidate mode. Profiles are the same
  kind of decision: one family of candidates, one mode, one visible exit.
- The filter/family is explicit, so a click on the body can never mean "select a
  face" while the draft is open.

## 6. Picking the axis in the model

The axis row is still `axis · line N · construction · pick`, and the stage is
still the candidate list. The difference is that the candidate list is rendered
in 3D on the sketch plane.

- **Candidates:** every sketch line (construction included) and the X/Y
  references. They are highlighted in axis mode; the region fills are
  decoration. Clicking a candidate sets the axis and returns to the form.
- **No silent default.** A new revolve opens with no axis; the primary is
  disabled and the hint says to pick one. The study's live scene starts after
  that pick so the preview is visible.
- **The chosen axis is an infinite dash-dot line** through the sketch plane,
  drawn with the same highlighter block + ink centerline as a selected sketch
  line. It extends past the sketch so the profile's side is obvious.
- **The profile/axis relation is visible.** The profile must be on one side of
  the infinite line or touch it. An axis that crosses the profile is shown in
  cut red with an inline error; the primary is disabled. No profile re-target and
  no silent X/Y fallback.
- **A partial angle draws the end profile** as a ghost and the angle arc around
  the axis. A full 360° has no end faces and no direction control.
- **v1 keeps the axis in the sketch plane.** A model edge as a 3D axis is a
  natural extension of the same pick surface, not a v1 promise; it needs a
  datum-axis model.

## 7. The preview language

The draft is still a normal feature preview:

- The result body is the subject. It is solid while the user is tuning values.
- In a pick mode, profiles and the axis are overlaid in the sketch's own
  language: selected profiles are a highlighter wash with an ink boundary;
  construction is dashed; reference axes are quiet. The preview ghosts so the
  plane is readable.
- The operation follows [`BOOLEANS.md`](BOOLEANS.md): `join` adds highlighter
  material, `cut` removes cut red, `intersect` keeps the overlap normal and
  ghosts the rest, and `new body` keeps the result-body preview.
- A **distance arrow** on the profile and an **angle arc** around the axis are
  the on-geometry controls. Dragging them changes the same value as the
  `MeasureField`; the field remains the exact input.
- The preview ghosts while a pick mode is active, so the plane is readable, and
  returns to solid when the pick ends.
- A failed preview keeps the last good body visible, names the failure in the
  form, and never drops the inputs.

## 8. Entry, exit and input rules

### Entry

| Entry | Seed | Stage after |
| --- | --- | --- |
| `extrude…` / `revolve…` in the profile popover | the selected regions | model, draft open |
| `extrude` / `revolve` on a sketch step | no profiles; profile mode | model, draft open, profile pick |
| selecting an existing extrude/revolve step | the stored inputs | model, editor open |
| new feature from the insert menu | — | not a thing; a feature needs a sketch |

### Exit

| Action | Result |
| --- | --- |
| `apply` (or Enter when the primary is enabled) | insert the step, stay in model, select the new step |
| `cancel` (or Escape with no pick open) | drop the draft and restore the origin: the sketch with the seed selection, or the existing editor's baseline in model |
| timeline click | same as `cancel`, then navigate (MODES D5 / R5) |
| background click in the draft | **does not cancel.** It clears the transient hover/pick; the form is the only cancel |
| Escape while picking | exit the pick, keep the draft; the next Escape cancels |
| Enter while picking | exit the pick (`done`), not apply |
| Delete while profile-picking | clear the profile set and keep the draft (the D7 behaviour, extended to the model pick) |

The background-click rule is the one deliberate difference from the current
model forms (MODES D8). The draft's canvas is the preview and the pick surface,
not a modal backdrop; a stray click during an orbit must not throw away the
feature. The form's quiet `cancel` and Escape are still the one meaning of
"leave".

### The five-cell mode row

| State | Enter | Escape | Stage background | Timeline | Delete |
| --- | --- | --- | --- | --- | --- |
| Feature draft · model · no pick | apply if valid | cancel (restore origin) | preview: no-op; pick surface: input | cancel, then `nav` | — |
| Feature draft · profile pick | done → preview | exit pick, keep draft | input (toggle a region); an empty click clears hover, keeps draft | cancel, then `nav` | clear profiles, keep draft |
| Feature draft · axis pick | done → preview | exit pick, keep draft | input (pick a candidate); non-candidate is blocked | cancel, then `nav` | — |

This row replaces the sketch-stage S10/M17 draft cells when the design lands.
The existing rows stay in `MODES.md` until the implementation catches up.

## 9. What does not change

- **The form.** Same kicker/title/rows/list/footer; same `MeasureField`; same
  operation row; same `cancel` restores the baseline. Only the stage behind it
  changes. See [`INTERACTION.md`](INTERACTION.md) and [`PICKS.md`](PICKS.md).
- **The document.** The draft is still ephemeral UI state. The feature still
  stores `sketchId`, `regions`, values and operation. No new document data, no
  schema bump.
- **The rebuild.** The same feature is evaluated by the same engine and worker.
  The preview is the same kernel result.
- **The sketch's region model.** Same regions, same ids, same `All / Voids /
  Auto`. The model pick is a second surface onto the same data.
- **Selection.** No new selection family is stored; profile picks are the
  draft's input, not a document selection.

## 10. Why this is the right long-run shape

The draft is the first place where the two stages must agree. Building it as a
camera change, not a second renderer, gives the app a single scene:

- a sketch on a face or datum plane is drawn in the same frame as the body;
- every future sketch-consuming feature (sweep, loft, thicken, split) inherits
  the same open-in-model behaviour;
- the sketch stage can later keep the 3D view while drawing, because the drawing
  plane, not the camera, is the constraint;
- the model view and the sketch view share picking, highlights and the
  highlighter, so a selected profile looks the same in both.

The sketch remains the precise 2D authoring surface. It stops being the only
place a sketch can be seen.

## 11. Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | **A sketch-consuming feature opens on the model stage.** | The solid and its relation to the body are the decision; the sketch cannot show them. |
| D2 | **One scene, two cameras.** The sketch stage is a normal-to-plane camera; the draft is the same scene from an oblique camera. | Makes the transition a camera move, keeps the sketch on its real plane, and opens the door to an orbitable sketch view. |
| D3 | **The sketch is read-only input while the draft is open.** | The draft is an operation on the model; changing the source sketch mid-draft would invalidate the inputs. |
| D4 | **Profile picking is a model pick mode**, with the preview ghosted; no stage switch. | The profile is a plane region in the same 3D scene; a mode makes the pick family explicit. |
| D5 | **The axis is picked in 3D but stays in the sketch plane (v1).** | The axis is a sketch line; a 3D edge axis needs a datum axis. The 3D view still makes the sweep obvious. |
| D6 | **The preview is the subject; the sketch is an overlay.** The body is solid while tuning; the overlay becomes x-ray in a pick mode and the plane quad marks the source. | The result must read as a solid; the profile must be readable when the user is actually picking it. |
| D7 | **The camera frames the operation**, an oblique view of the sketch plane plus preview, not a world iso. | Preserves the user's orientation and works for face/datum sketches. |
| D8 | **The form does not change shape.** The same popover and rows; `pick in sketch` becomes `pick`. | One feature grammar; editing already uses this popover. |
| D9 | **Cancel restores the origin.** Apply keeps the model and selects the new step. | "Leave" has one meaning; the user can go back to the sketch without losing the seed selection. |
| D10 | **The draft owns the stage.** Ordinary model face/edge selection is suspended while it is open. | A draft input must never be confused with a document selection. |
| D11 | **A background click in a draft does not cancel.** Escape/cancel/timeline are the exits. | The preview fills the canvas; a stray orbit click must not destroy the feature. |
| D12 | **The sketch stage remains a normal orthographic camera in v1**; an orbitable sketch view is the long-run direction. | Drawing precision now; the scene model already supports the future. |

## 12. Open questions

| # | Question | Current proposal | Status |
| --- | --- | --- | --- |
| O1 | Should the draft show dimensions and constraint marks over the model? | No; they are authoring annotations. The profile/axis and the list are the input readout. | Proposed |
| O2 | Should profile fills be visible when not picking, or only in profile mode? | The preview body owns the plane while tuning; profile fills (selected and unselected) return in profile mode. The selected profile can keep a wash when the plane is genuinely visible, but never as a wireframe through the body. | Proposed |
| O3 | Can the draft start from a model edge axis? | Not v1; the same pick surface can later accept a 3D edge. | Deferred |
| O4 | Should `look at sketch` be a foot preset or a form row? | Foot, because it changes only the view. | Proposed |
| O5 | Does apply keep the camera where the user left it? | Yes; do not snap to a canned view after applying. | Proposed |
| O6 | Can a draft open the sketch for editing? | No; cancel first. An `edit sketch` action would need to commit/cancel the draft. | Open |
| O7 | What does an empty model click do when no pick is active? | Nothing; the form is the cancel. | Proposed |
| O8 | Should the preview ghost while profile/axis picking, or stay solid? | Ghost; the plane and candidate lines must be readable through it. | Proposed |
| O9 | Should the sketch stage itself become orbitable before M6? | No; v1 keeps the normal camera. The draft is the first 3D sketch surface. | Deferred |
| O10 | How are multiple source sketches handled (a profile from sketch A, axis from sketch B)? | Out of scope; one source sketch per extrude/revolve, as today. | Deferred |

## 13. Current implementation and gap

**Not implemented.** Current behaviour:

- `beginExtrudeDraft()` and `beginRevolveDraft()` set `mode = "sketch"` and keep
  the draft in the sketch stage; the plan and MODES still describe the
  sketch-stage draft (S10, M17).
- The worker already builds the draft preview in either stage; the model view
  already draws the active sketch on its plane (`modelSketchOverlay`), including
  selected profile fills for an active extrude.
- The model view has face/edge picking, but the sketch overlay is not a pick
  surface; the profile row says `select` / `pick in sketch` and switches stages.
- The revolve axis pick is already a candidate mode in the sketch; it needs the
  same mode with the 3D cursor and overlay.

The implementation path is deliberately small:

1. Move the two `setMode("sketch")` calls to `setMode("model")` and frame the
   camera on the sketch plane + preview.
2. Render **all** regions (not only the used profiles) in profile mode, with the
   selected/unselected/void classes; x-ray the overlay while a pick is active.
3. Add a model profile pick mode: ray-plane intersection against the sketch
   frame, point-in-region against `regionsFromSketch`, and hover/selection
   overlays. Reuse the region ids.
4. Reuse the existing axis candidate pick against the projected sketch lines.
5. Add the input row to the model tool options, the `look at sketch` view preset,
   the height/angle on-geometry handles, and the draft exit rules above.
6. Tests: does `extrude…` land in the model with a preview; does a region click
   add/remove and update the list; does an axis click set the axis; does cancel
   return to the seed sketch; is a background click a no-op; is a lost/invalid
   axis still visible.

No kernel, document or schema change is required. The existing preview, region
extraction and axis validation are the engine.

## 14. Visual companion

[`draft-view.html`](draft-view.html) shows the study with a live stage:

- an extrude scene with a base body, three profile regions and a live preview;
- a revolve scene with a profile, candidate axes (including one that crosses the
  profile) and a partial/full tube;
- `preview` / `profiles` / `axis` input modes;
- `3/4` / `look at sketch` camera presets that animate the same scene;
- the form's profile and axis rows, list, height/angle, operation and footer;
- apply/cancel states.

The geometry is stylised for the interaction; it is not a B-rep.
