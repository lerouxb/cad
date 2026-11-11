# Interaction modes and input rules

> Status: **contract**, 2026-11-07; the timeline/escape additions of 2026-11-08
> are pending implementation. Decisions D1–D12 are accepted
> (see §5) and the app otherwise implements the tables in §3. §4 records the
> outcome of the original audit: every divergence is fixed or explicitly
> deferred. Keep the `⚠` markers out of §3 — a cell that disagrees with the code
> is a bug in one of them, not an annotation.
>
> Companion docs: [`INTERACTION.md`](INTERACTION.md) (surfaces, actions,
> popovers) and [`TIMELINE.md`](TIMELINE.md) (steps, bodies, insertion).
> When code and this table disagree, one of them is wrong — decide which, then
> update both.

## 0. The one-line version

**Escape cancels, Enter commits, a background click never commits, and the
timeline never commits.** Every surprising state is a violation of one of those
four.

## 1. "Sketch mode vs model mode" is only one axis

There are five mostly independent layers. Most inconsistency comes from
treating one layer as if it were another, or from letting a hidden layer keep
holding input state.

| # | Layer | Values | Owns | Lives in |
| --- | --- | --- | --- | --- |
| L0 | **Stage** | `model` / `sketch` | which canvas is on the stage | `mode` |
| L1 | **History cursor** | no step / a step id | render prefix, which step is being edited | `activeFeatureId` |
| L2 | **Gesture** | idle / drawing / marquee / placing a dimension / dragging / inline editor | one pointer gesture at a time | `SketchCanvas`, `Viewport` |
| L3 | **Selection** | sketch ids / profile regions / model edge set / face set / single pick | what the next action acts on | `App` + viewer |
| L4 | **Operation** | none / draft / edit (extrude, datum, fillet, chamfer, shell, support, sketch fillet, export, measure) | a form with a primary and a cancel, or an immediate palette | `App` |
| L5 | **Overlay** | insert menu / file menu / rename / readouts | transient menus and status chips | `App` |

A stage is not a mode in the sense of owning Escape. A sketch stage can have
*no* operation, a *draft* extrude, an *existing* extrude editor, a selected
entity, or a line draft — all different answers to "what does Escape do?".

**Layer invariants**

- **I1** There is at most one *operation* open. Opening another cancels or
  replaces it; two forms never stack.
- **I2** There is at most one *gesture* in progress. Starting a new gesture
  cancels the old one.
- **I3** An operation belongs to a stage. An extrude draft lives in sketch
  mode; fillet/chamfer/shell/datum/support live in model mode. Crossing to the
  other stage cancels the operation; it is never left hidden.
  [`DRAFT_VIEW.md`](DRAFT_VIEW.md) proposes moving the new extrude/revolve draft
  to model mode so the operation and its preview share a stage; that is not
  implemented yet.
- **I4** A hidden stage holds no live input state (no draft, no marquee, no
  inline editor, no armed tool).
- **I5** Selection is not a mode. It is data that the current operation reads.
  Escape can clear it; it never blocks the next click.

## 2. Input rules

### R1 — Escape pops exactly one layer (D1)

Escape acts on the topmost layer only, in this order:

1. an open menu (insert, file);
2. a constraint chooser / cluster list (when open);
3. an inline editor (dimension, point X/Y);
4. an operation (extrude draft/editor, datum, fillet/chamfer, shell, support,
   sketch corner fillet, export, measure);
5. the current gesture (line draft, marquee, dimension target), **keeping the
   armed tool**;
6. the armed tool → `select`;
7. the selection / picks;
8. the **history cursor** → no step, exactly like clicking the end tail: the
   full document renders, the stage returns to the model, no step or step
   popover is active, the selection is empty, and the track sits at its end.
   If there is no active step, this is the final no-op.

One press = one outcome. Escape changes the history cursor only after every other
layer is empty, and then it does exactly what the end tail does — including
leaving the sketch stage for the full model. It never leaves the stage for any
other reason, except when cancelling an operation whose *baseline* mode is the
other stage (the extrude editor returns to the mode it opened from).

> Why this differs from today: the app currently resets the tool, the draft,
> the selection and every pick in one press (fine), but skips several
> operations entirely (not fine). See F1.

### R2 — Enter commits the topmost thing, or does nothing

Enter belongs to, in order:

1. the focused control (input/button/timeline step), which must
   `stopPropagation` so the stage never sees it;
2. the inline editor → commit;
3. the open operation → primary, **only when the primary is enabled**; a
   disabled primary is a visible no-op (R11);
4. a line draft with ≥ 2 points → commit the polyline, stay in the line tool;
5. an armed creation/selection tool with no gesture → end the tool (`select`);
6. idle `select` in sketch mode → finish the sketch, as today;
7. idle `select` in model mode → no-op.

Enter never navigates the history and never applies a form that is not ready.

### R3 — Delete deletes the selection, nowhere else

Delete/Backspace deletes the selected sketch geometry, dimension or constraint
only when the top layer is the sketch selection. Removing a constraint changes
no geometry and is one undo entry. It is a no-op in model mode for now (delete a
step from its timeline detail). In a text field it is text editing.

### R4 — A background click cancels or clears; it never commits

A stage-background click dismisses the top operation (same restore as its
footer `cancel`), otherwise clears the current selection/pick, otherwise does
nothing. Exemptions: `.stage-popover`, the tool rows, the stage foot, the
Select Other chip, and — while a picker is open — the viewport canvas, where the
click is *input*.

On a **drawing surface** the background click is input, not dismissal: it adds
a line vertex, starts a marquee, places a dimension, etc.

### R5 — The timeline never commits

Clicking a step, an insert gap or the **end tail** cancels the current gesture
and operation with the same semantics as its `cancel`, then moves the history
cursor (the end tail clears it). It never presses `apply`. A focused text
field is the one exception: it commits on blur as usual (R7).

- A step selects itself and changes the stage to match its type.
- A normal insert gap moves the cursor to the step before it, then opens the
  menu.
- The start insert gap keeps the cursor where it is.
- The **end tail** is the whole area to the right of the last step's insert gap;
  it fills the remaining track width, so clicking anywhere after the last step
  clears the cursor and shows the whole document.
- The leading 44px tail is the start target and also clears the cursor.
- **On load the cursor is empty**: the full document renders, the track is
  scrolled to the end, and no step or step popover is active. Selecting a step is
  explicit.

### R6 — A stage change cancels stage-local state

Entering model from sketch aborts the sketch gesture and disarms the sketch
tool. Entering sketch from model aborts any model draft that is not an extrude
operation. A hidden layer must not retain a draft that a later Enter can
commit.

### R7 — Text fields own their keys

While focus is in `input`, `textarea`, `select` or `[contenteditable]`, Enter
and Escape belong to the field; no global shortcut (including Delete) runs.

### R8 — Shortcut scope

Single-letter shortcuts (`v b g l p r c a d t`) do not act while a menu or an
inline editor is open, or while focus is in a form control. If an operation is
open they cancel it first, then arm the tool; they never change the stage behind
a form without closing it.

> **D6 (accepted):** pressing a tool key while a form is open cancels the form,
> then arms the tool — exactly like clicking the visibly enabled tool button.

### R9 — Cancel, Escape and background all mean restore

`cancel`, Escape and a stage-background click on an operation do exactly the
same restore: parameters return to their values when the operation opened.
`apply` is the only action that keeps the new values.

> **D5 (accepted):** navigating away (timeline, opening export) while an
> existing feature editor is open cancels and reverts it, exactly like the footer
> `cancel`. There is one meaning of "leave". See F14.

### R10 — One primary, one verb

Every operation has one primary (`apply`, `export`, `new sketch`, …), a quiet
`cancel`, and optionally a destructive action separated from both. Escape is
always equivalent to `cancel`, never to the primary. A disabled primary cannot
be triggered by Enter.

### R11 — No silent fallback or silent no-op

If Enter cannot do anything (an incomplete form, a disabled primary, an
operation with no input), it does nothing **and the footer says why**. Do not
quietly close, apply a default, or fall through to "finish sketch".

## 3. The matrix

**Abbreviations**

- `—` — no-op.
- `input` — the click feeds the active gesture (draw/add vertex/pick), it is not
  a dismissal.
- `nav` — cancel the stage-local layers, then move the history cursor (R5).
- `clear` — clear the selection/pick but stay in the stage.
- `⚠ F#` — current behaviour differs; see §4.
- `D#` — the accepted decision in §5 applies.
- `[popover]` — the surface is open.

**The Escape column is the first press.** The stack is per-press: once the
popover, gesture, tool or selection is gone, the next Escape clears the history
cursor exactly like the end tail (full document, no step, track at the end).

### 3.1 Sketch stage

| ID | State | Enter | Escape | Stage background | Timeline | Delete |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | Idle · `select` · nothing selected | finish sketch → model D2 | clear history cursor → full document (no-op if none) | — | `nav` | — |
| S1 | Sketch geometry / dimensions selected (any mix; `selection-panel`) | — | clear selection / close popover | `clear` | `nav` | delete the selected geometry/dimensions (references skipped; one undo) |
| S1b | **Constraint mark selected** (the constraint's marks highlight; participant geometry is washed; constraint popover) | — | clear selection / close popover | `clear` | `nav` · clear | remove the constraint (one undo; no geometry change) |
| S1c | **Profile selected** (normal sketch select; profile popover) | — | clear profile selection / close popover | `clear` | `nav` · clear | clear the profile selection; no geometry change |
| S2 | Tool armed, no gesture (`line`/`rect`/`circle`/`arc`/`dimension`/`trim`/`box`/`lasso`) | end tool → `select` D3 | → `select` | `input` (see S3–S6) | `nav` · abort | — |
| S3 | Line draft · 1 point | — | drop draft, stay in `line` D1 | `input` · add vertex | `nav` · drop draft | — D11 |
| S4 | Line draft · ≥ 2 points | commit open polyline, stay in `line` | drop draft, stay in `line` D1 | `input` · add vertex / close on first point | `nav` · drop draft | — D11 |
| S5 | Rect / circle / arc mid-gesture | | abort gesture, stay in tool D1 | `input` · continue gesture | `nav` · abort | — |
| S6 | Box / lasso marquee in progress | | abort marquee, stay in tool D1 | `input` · start marquee | `nav` · abort | — |
| S7 | Dimension tool · choosing a target | — | drop the target, stay in the dimension tool D1 | `input` · place the dimension if a target is chosen | `nav` · drop target | — |
| S8 | Inline dimension editor | commit | cancel | cancel D4 (today: commits) | cancel, then `nav` D5 (today: commits first) | text edit |
| S9 | Point X/Y inline editor | commit | cancel | cancel D4 | cancel, then `nav` D5 | text edit |
| S10 | Profile selection · **new extrude draft** | apply if ≥ 1 region; else visible no-op (footer explains) | cancel the draft, stay on the source sketch step | empty click: clear the region selection, keep the draft D7 | `nav` · cancel draft | clear the selected profiles D7 |
| S11 | Profile selection · **existing extrude** | done → model (close editor) | cancel editor (revert) → model | empty click: clear region selection, stay | `nav` · cancel editor D5 | — |
| S12 | Sketch corner fillet `[popover]` | apply if the radius is valid | cancel, restore the radius | cancel | `nav` · cancel | — |

Notes:

- Region/point/curve/label clicks `stopPropagation`; they never reach the SVG
  background branch.
- In **normal sketch select**, a region click selects the profile family and opens
  the profile popover; it does **not** start an extrude. The popover's `extrude…`
  chip enters S10. Box/lasso at this level marquees sketch geometry/dimensions
  through the current filter; in **profile mode** (S10/S11) it marquees regions.
  Backspace deletes the geometry/dimension set, or clears the profile set.
- Double-click a line draft commits it; double-click a dimension label edits it.
- A **constraint mark** is a selectable annotation: hover previews the companions
  and participants, click selects the whole constraint, Backspace/Delete removes
  it. It is mutually exclusive with a geometry/dimension selection. A constraint
  chooser or cluster list is a transient overlay above the selection; Escape
  closes it before it clears the selection.
- A **selection is not a command**: feature actions (`extrude…`, `revolve…`,
  `new sketch`, `offset face…`, `shell…`, `fillet…`, `chamfer…`) are chips in the
  selection popover, not the result of a click. See `SELECTION.md`,
  `OFFSET_FACES.md` and `REVOLVE.md`.

### 3.2 Model stage

| ID | State | Enter | Escape | Stage background | Timeline | Delete |
| --- | --- | --- | --- | --- | --- | --- |
| M0 | Idle · `select` · nothing picked | — | clear history cursor → full document (no-op if none) | — | `nav` | — D10 |
| M1 | Single pick (body / datum / edge readout) | — | `clear` | `clear` | `nav` · `clear` | — |
| M2 | Edge set (`body-selection-popover`) | — | `clear` edges, close | `clear` (empty click) | `nav` · `clear` | — |
| M3 | Face set (`face-selection-popover`) | — | `clear` faces, close | `clear` | `nav` · `clear` | — |
| M4 | Extrude editor `[popover]` | apply / close | cancel (revert), close | cancel (revert) | `nav` · cancel (revert) D5 | — |
| M5 | New datum draft `[popover]` | apply if the frame resolves | cancel | cancel | `nav` · cancel | — |
| M6 | Datum editor `[popover]` | apply / close | cancel (revert) | cancel (revert) | `nav` · cancel (revert) D5 | — |
| M7 | New fillet / chamfer draft `[popover]` | apply if ≥ 1 edge | cancel (current) | cancel; the canvas is the pick surface | `nav` · cancel | — |
| M8 | Fillet / chamfer editor `[popover]` | apply / close | cancel (revert) | cancel (revert) | `nav` · cancel (revert) D5 | — |
| M9 | New / edited shell `[popover]` | apply if ≥ 1 face | cancel (revert) | cancel (revert) | `nav` · cancel (revert) D5 | — |
| M10 | New-sketch support picker `[popover]` | create the sketch if the support is valid | cancel | canvas: `input` (pick a face/datum); empty canvas: clear the face pick, keep the picker; outside the canvas: cancel D8 | `nav` · cancel | — |
| M11 | Export page | — | close | close | close, then `nav` | — |
| M12 | Insert menu | activate the focused item (native) | close the menu only | close | close, then `nav` | — |
| M13 | File menu | activate the focused item (native) | close the menu | close | close | — |
| M14 | Rename input (document / feature) | commit | cancel | commit on blur (text field) | blur commits, then `nav` | text edit |
| M15 | Measure mode `[popover]` (0–2 targets) | — | close, drop the targets | canvas: `input` (add/remove a target); elsewhere close | close, then `nav` | — |
| M16 | Offset face draft/editor `[popover]` | apply if ≥ 1 face and the preview is valid | cancel (revert) | cancel (revert); the canvas is the face pick surface | `nav` · cancel (revert) D5 | — |
| M17 | Revolve draft/editor `[popover]` | apply if the profile, axis and angle are valid | cancel (revert); an axis pick exits first | cancel (revert); the canvas is the profile/axis pick surface | `nav` · cancel (revert) D5 | — |

Notes:

- Empty model click clears the pick, unless Shift is held with a non-empty
  edge/face set (additive selection never throws the set away).
- A filtered-out pick (`all` / `edges` / `faces`) is *blocked*: it keeps the
  current selection instead of clearing it.
- In a blend/shell/offset/support operation the canvas is a pick surface. Edge/
  face clicks feed the operation; they do not cancel it. The offset draft's
  distance is a `MeasureField`; Enter applies only a valid preview. A feature
  form follows [`PICKS.md`](PICKS.md): model inputs are always live, profiles
  switch to the sketch stage, and an axis/support uses a candidate pick. The form
  forces its input family filter (`faces`/`edges`) and restores `all` on close.
- The project picker is a model multi form too: it keeps `all` (faces + edges)
  live, lists both families, and an empty model click cancels it and returns to
  the sketch (F22).
- In the revolve draft, `select axis` enters an **axis pick**: candidate sketch
  lines and the X/Y references are pickable, the region fills are decoration.
  Escape exits the pick first; the next Escape cancels the draft. `select
  profiles` returns to region mode. The profile must stay on one side of the
  axis.
- Selection filters (`all` / `edges` / `faces` on the model, `all` / `points` /
  `curves` / `dimensions` in the sketch) persist across stage and cursor changes,
  and reset on new/open document (D12).

### 3.2a In progress: the draft view

> Status: **in progress**, 2026-11-10. The design is
> [`DRAFT_VIEW.md`](DRAFT_VIEW.md). New extrude/revolve drafts and revolve editors
> now open on the model with the preview, and a background press on that preview is
> a no-op (DRAFT_VIEW D11). The profile/axis rows still switch to the sketch stage
> (S10/M17) until the model pick mode lands; the model pick rows below are the
> target, not current behaviour.

A sketch-consuming feature draft moves to the model stage. The source sketch is a
read-only overlay on its plane; the preview is the subject. The profile and axis
picks happen in the model, not by switching to the sketch stage.

| State | Enter | Escape | Stage background | Timeline | Delete |
| --- | --- | --- | --- | --- | --- |
| Draft · model · no pick | apply if valid | cancel (restore origin) | preview: no-op; pick surface: input | cancel, then `nav` | — |
| Draft · model · profile pick | `done` → preview | exit pick, keep draft | input (toggle a region); an empty click clears hover, keeps the draft | cancel, then `nav` | clear profiles, keep draft |
| Draft · model · axis pick | `done` → preview | exit pick, keep draft | input (pick a candidate); a non-candidate is blocked | cancel, then `nav` | — |

The deliberate difference from D8 is the background click: the draft's canvas is
a preview and a pick surface, not a modal backdrop, so an empty click is a no-op
rather than a cancel. The form's `cancel`, Escape and a timeline click remain
the one meaning of "leave".

For the landed preview forms this supersedes the **stage-background** cell of
M4/M17: an extrude/revolve draft or editor keeps the form on a background press
(the canvas is the orbit surface). The profile/axis row still switches to the
sketch, so S10/M17 still govern that temporary stage. Update M4/M17 and delete
S10's draft use once the model profile/axis pick lands.

### 3.3 Global keyboard

| Key | Idle sketch | Idle model | Form open | Text field focused |
| --- | --- | --- | --- | --- |
| `v` / `b` / `g` | `select` / `box` / `lasso`, clear selection | `select` / `box` / `lasso`, keep selection | cancel form, then arm D6 | ignored |
| `l p r c a d t` | force sketch stage, arm the tool, clear selection | same | cancel form, then arm D6 | ignored |
| `Enter` | finish sketch (idle) / commit draft / end tool | — | apply if enabled, else no-op | commit field |
| `Escape` | pop one layer (R1) | pop one layer (R1) | cancel | cancel field |
| `Delete` / `Backspace` | delete the selected geometry / dimension / constraint; clear a profile selection (normal or draft) | — | — | text edit |
| `Cmd/Ctrl+Z`, `Shift+Z` | undo / redo | undo / redo | cancel form first D9 | field undo |
| `Cmd/Ctrl+Y` | redo | redo | cancel form first D9 | field redo |
| `Space` / `Tab` | focused control only (native) | focused control only | focused control only | text |

### 3.4 What is deliberately *not* a cancel surface

| Surface | Why |
| --- | --- |
| Tool line / tool options row | They are actions, not dismissals. A tool change cancels the gesture (R6), not the operation. |
| Stage foot | Readout + view controls; changing the view must not discard work. |
| Datum visibility eye | Presentation only. It must not suppress the feature or cancel an editor. |
| Select Other chip / body-pick badge | Readouts, not buttons (see F19). |
| Theme / highlighter | View only. |
| Wheel scroll on the timeline | Scrolls the track; it is not a gesture and never cancels. |

## 4. Audit: outcomes

These were the divergences found against the code before the contract was
implemented. The status is the outcome of that work.

| # | Divergence | Status |
| --- | --- | --- |
| F1 | Escape skipped the extrude draft, feature/datum editors, datum draft, support picker, file menu and sketch-fillet restore. | **Fixed.** One keydown table walks menus → operations → gesture → tool → selection; the sketch fillet uses its footer `cancel`. |
| F2 | `SketchCanvas` had an unguarded window Enter listener that could finish the sketch from any layer, including model mode. | **Fixed.** The local listener only commits a line draft with ≥ 2 points, only while the sketch stage is visible, and never finishes the sketch. The global table owns every other Enter. |
| F3 | A focused timeline step did not stop propagation, and the insert menu had its own Escape listener. | **Fixed.** The step stops propagation after activating; the insert menu listener is gone and the shared stack closes menus. |
| F4 | Only sketch-step activation reset the tool/cancelled the gesture, so a hidden draft survived a stage change. | **Fixed.** Every stage/cursor change bumps `cancelToken`; `finishSketch` disarms the tool and clears the dimension target/notice. |
| F5 | Transitions omitted some ephemeral state (face set, fillet form, datum draft). | **Fixed.** `activateFeature`, `clearActiveFeature`, `beginExtrudeDraft` and `handleNewSketch` clear the state they leave behind. |
| F6 | A model click while an editor was open was processed as a pick *and* cancelled the form. | **Fixed.** The background click cancels first and `Viewport.suppressNextClick()` swallows the pick. Pick surfaces (blend/shell/support) are exempt. |
| F7 | The support picker was not cancelled by Escape or a background click. | **Fixed.** Escape closes it; the canvas click is input (clears the face pick) and a click outside the canvas cancels (D8). |
| F8 | The export page survived timeline navigation. | **Fixed.** Step, gap, tail, undo/redo and the file menu all close it before moving. |
| F9 | Escape closed the sketch fillet without restoring the radius. | **Fixed.** Escape calls `cancelFillet`, the same restore as the footer. |
| F10 | The dimension editor committed on outside click; point X/Y reset. | **Fixed.** A capture-phase outside pointerdown cancels both (D4). |
| F11 | A timeline click while the dimension editor was open committed the value first. | **Fixed.** The capture-phase outside handler cancels before the timeline click runs. |
| F12 | Shortcuts fired with a `<select>`/button focused or a menu/form open, and the tool keys bypassed `changeTool`. | **Fixed.** Text fields own all keys, Enter on a focused button/link is native, menus block letters, and tool keys cancel the form then go through `changeTool`. |
| F13 | Undo/redo left an editor open on a stale baseline. | **Fixed.** Both cancel the open operation before applying history (D9). |
| F14 | Navigation kept live edits while footer `cancel` reverted them. | **Fixed.** Timeline/export/file menu/undo share `cancelOpenOperationRef`, so "leave" restores (D5/R9). |
| F15 | Enter on an extrude draft with no profile looked broken and the footer did not explain. | **Fixed.** Enter is a visible no-op; the hint and summary say a profile is required. |
| F16 | An empty sketch click during profile selection cancelled the whole draft. | **Fixed.** It clears the regions and keeps the draft (D7). |
| F17 | Header actions did not share the dismissal rule. | **Fixed.** Opening the file menu, export, measure or undo cancels the open form; a form never stays behind a menu. |
| F18 | Escape flags were refreshed after render, so the first tick could miss them. | **Fixed.** The keydown effect re-registers every render and reads current state. |
| F19 | The Select Other chip looked like a control but was `pointer-events:none` and never called `cyclePick()`. | **Fixed.** The chip is a real button that cycles the overlapping candidates. |
| F20 | Delete is a no-op in model mode. | **Deferred** (D10). The timeline detail remains the only feature-delete path until a model selection owns deletion. |
| F21 | Enter during an IME composition could commit the inline dimension/point editor, a rename or a form primary. | **Fixed (2026-11-10).** The field and window handlers ignore composing Enter (`isComposing` / keyCode 229). |
| F22 | The project picker was a model multi form but an empty model click only cleared the pick and kept the form. | **Fixed (2026-11-10).** It now cancels like blend/shell/offset (D8); the form returns to the sketch stage. |

## 5. Decisions

Accepted **2026-11-07** for the first implementation pass. They are not
permanent: a decision can change, but changing one means editing its row,
updating every matrix cell that references it, and adding a line to the change
log below.

| # | Decision | Why / consequence |
| --- | --- | --- |
| D1 | **Escape pops one layer per press** (menu → editor → operation → gesture → tool → selection → history cursor), instead of resetting everything at once. | "Press Escape until it stops" becomes predictable: the final press clears the step and shows the finished model, exactly like the end tail. |
| D2 | **Enter in idle sketch finishes the sketch.** | It is the documented gesture and mirrors the `finish sketch` button. |
| D3 | **Enter with an armed creation tool and no gesture ends the tool** (→ `select`). | Two Enter presses finish the sketch; one Enter must not abandon the stage. |
| D4 | **An outside click cancels an inline editor** (dimension and point X/Y alike). | Matches `INTERACTION.md` and Escape. Committing on a stray click is the more dangerous mistake. |
| D5 | **Navigating away cancels and reverts an open editor** (timeline, opening export, anything else that leaves it). | One meaning of "leave"; also removes the stale-baseline risk (F14). |
| D6 | **A tool key or tool button while a form is open cancels the form, then arms the tool.** Except during profile selection, where the sketch tools are inputs to the open extrude form and must not cancel it. | The toolbar is visible and looks usable; a greyed-out toolbar is a bigger change. Profile selection is the form's pick surface. |
| D7 | **An empty sketch click during profile selection clears the regions and keeps the draft.** Delete/Backspace does the same; deleting sketch geometry requires leaving profile selection. | The draft still has a visible `cancel`; losing the whole draft to a deselect click is surprising. Profile regions are not geometry, so the delete key removes them from the operation, not the sketch. |
| D8 | **An empty click in a picker follows validity.** Fillet/chamfer/shell have nothing to apply with no input → cancel. Support has a valid world-plane fallback → clear the face pick and keep the picker. | Do not keep an operation that cannot apply; do not throw away one that can. |
| D9 | **Undo/redo cancels an open form first, then acts.** | A form baseline must never survive a document change. |
| D10 | **Delete does not delete a feature in model mode** for now; the timeline detail stays the only path. Deferred to the multi-body/step work. | Keeps Delete scoped to sketch selection until a model selection owns deletion. |
| D11 | **Delete/Backspace during a line draft is a no-op** for now. Removing the last vertex is nice-to-have, not required for consistency; revisit when the draft supports undo. | — |
| D12 | **Selection filters persist across stage and cursor changes**, and reset on new/open document. | They are view-like, not document state. |

### Change log

| Date | Decision | Change |
| --- | --- | --- |
| 2026-11-07 | D1–D12 | Initial acceptance of the recommendations in the audit. |
| 2026-11-07 | D5 | Clarified that "navigating away" includes the header file menu and undo/redo, not only the timeline and export (F17). |
| 2026-11-07 | D6 | Added the profile-selection carve-out: box/lasso/tool buttons are form input while an extrude form is choosing regions. |
| 2026-11-08 | D7 | Delete/Backspace now clears the selected profiles of a new extrude draft, matching the empty click; it never deletes sketch geometry from profile selection. |

## 6. Adding a new mode or input: checklist

1. **Assign the layer.** Is it a stage, gesture, selection, operation or overlay?
   If it is an operation, it must be mutually exclusive with every other
   operation.
2. **Fill in five cells.** Enter, Escape, stage background, timeline click,
   Delete. If any cell is "it depends", the state is not defined enough.
3. **State the primary and cancel.** What does `apply` mean? What exactly does
   `cancel` restore? What makes the primary disabled?
4. **Define the boundary.** What does opening it cancel? What does closing it
   clear? What happens if the stage changes underneath it?
5. **Put Escape in the stack, not in a new listener.** A component-local
   `keydown` that does not stop propagation is how F2/F3 happened.
6. **Test the exits.** Add e2e coverage for Enter, Escape, a background click
   and a timeline click, not only the happy path.

## 7. Open questions not yet in the matrix

- **Pointer cancel / window blur.** If the pointer is lost mid-drag (window
  blur, alt-tab), the draft currently survives. Should blur cancel the gesture?
- **Touch.** "Tap outside" is defined as cancel for inline editors; is that
  discoverable enough on touch, or does the inline editor need a `done`?
- **Undo while a gesture is in progress.** The `mergeKey` contract covers point
  and slider drags, but a line/circle draft is not in the document yet; undo
  during it currently undoes the previous document change.
- **Header actions.** New/open/clear while a form is open: the document reset
  clears state, but it is not expressed as "cancel first" anywhere.

Resolved since the audit:

- **IME composition** (2026-11-10). Enter that confirms an IME composition no
  longer commits the dimension editor, point X/Y, a document/feature rename or a
  global form primary; the field and window handlers check `isComposing`.
- **The Select Other chip.** It is a real button that cycles the overlapping
  candidates (F19).
