# Interaction modes and input rules

> Status: **accepted contract**, 2026-11-07. Decisions D1–D12 are accepted
> (see §5); the app does not implement them yet. The tables in §3 are the target
> rule set. `⚠ F#` marks a cell where the app currently does something different
> (see §4).
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
- **I4** A hidden stage holds no live input state (no draft, no marquee, no
  inline editor, no armed tool).
- **I5** Selection is not a mode. It is data that the current operation reads.
  Escape can clear it; it never blocks the next click.

## 2. Input rules

### R1 — Escape pops exactly one layer (D1)

Escape acts on the topmost layer only, in this order:

1. an open menu (insert, file);
2. an inline editor (dimension, point X/Y);
3. an operation (extrude draft/editor, datum, fillet/chamfer, shell, support,
   sketch corner fillet, export);
4. the current gesture (line draft, marquee, dimension target), **keeping the
   armed tool**;
5. the armed tool → `select`;
6. the selection / picks (already empty after step 5 in most cases).

One press = one outcome. Escape never changes the history cursor and never
leaves the stage, except when cancelling an operation whose *baseline* mode is
the other stage (the extrude editor returns to the mode it opened from).

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

Delete/Backspace deletes sketch geometry or constraints only when the top
layer is the sketch selection. It is a no-op in model mode for now (delete a
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

Clicking a step, an insert gap or the empty tail cancels the current gesture
and operation with the same semantics as its `cancel`, then moves the history
cursor (the empty tail clears it). It never presses `apply`. A focused text
field is the one exception: it commits on blur as usual (R7).

- A step selects itself and changes the stage to match its type.
- A normal insert gap moves the cursor to the step before it, then opens the
  menu.
- The start insert gap keeps the cursor where it is.
- The empty tail clears the cursor and shows the whole document.

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

### 3.1 Sketch stage

| ID | State | Enter | Escape | Stage background | Timeline | Delete |
| --- | --- | --- | --- | --- | --- | --- |
| S0 | Idle · `select` · nothing selected | finish sketch → model D2 | — | — | `nav` | — |
| S1 | Sketch geometry selected (`selection-panel`) | — ⚠F2 | clear selection / close popover | `clear` | `nav` | delete selection |
| S2 | Tool armed, no gesture (`line`/`rect`/`circle`/`arc`/`dimension`/`trim`/`box`/`lasso`) | end tool → `select` D3 ⚠F2 | → `select` | `input` (see S3–S6) | `nav` · abort ⚠F4 | — |
| S3 | Line draft · 1 point | — | drop draft, stay in `line` D1 | `input` · add vertex | `nav` · drop draft ⚠F4 | — D11 |
| S4 | Line draft · ≥ 2 points | commit open polyline, stay in `line` | drop draft, stay in `line` D1 | `input` · add vertex / close on first point | `nav` · drop draft ⚠F4 | — D11 |
| S5 | Rect / circle / arc mid-gesture | — ⚠F2 | abort gesture, stay in tool D1 | `input` · continue gesture | `nav` · abort ⚠F4 | — |
| S6 | Box / lasso marquee in progress | — ⚠F2 | abort marquee, stay in tool D1 | `input` · start marquee | `nav` · abort ⚠F4 | — |
| S7 | Dimension tool · choosing a target | — | drop the target, stay in the dimension tool D1 | `input` · place the dimension if a target is chosen | `nav` · drop target | — |
| S8 | Inline dimension editor | commit | cancel | cancel D4 (today: commits) | cancel, then `nav` D5 (today: commits first) | text edit |
| S9 | Point X/Y inline editor | commit | cancel | cancel D4 | cancel, then `nav` D5 | text edit |
| S10 | Profile selection · **new extrude draft** | apply if ≥ 1 region; else visible no-op ⚠F15 | cancel the draft, stay on the source sketch step ⚠F1 | empty click: clear the region selection, keep the draft D7 (today: cancels the draft) | `nav` · cancel draft | — |
| S11 | Profile selection · **existing extrude** | done → model (close editor) | cancel editor (revert) → model ⚠F1 | empty click: clear region selection, stay | `nav` · cancel editor D5 (today: keeps live edits) ⚠F14 | — |
| S12 | Sketch corner fillet `[popover]` | apply if the radius is valid ⚠F2 | cancel, restore the radius ⚠F9 | cancel | `nav` · cancel ⚠F5 | — |

Notes:

- Region/point/curve/label clicks `stopPropagation`; they never reach the SVG
  background branch.
- In profile-selection mode, a region click is the input; in normal sketch mode
  a click on a filled region with nothing else selected starts an extrude draft.
- Double-click a line draft commits it; double-click a dimension label edits it.

### 3.2 Model stage

| ID | State | Enter | Escape | Stage background | Timeline | Delete |
| --- | --- | --- | --- | --- | --- | --- |
| M0 | Idle · `select` · nothing picked | — ⚠F2 | — | — | `nav` | — D10 |
| M1 | Single pick (body / datum / edge readout) | — | `clear` | `clear` | `nav` · `clear` | — |
| M2 | Edge set (`body-selection-popover`) | — | `clear` edges, close | `clear` (empty click) | `nav` · `clear` | — |
| M3 | Face set (`face-selection-popover`) | — | `clear` faces, close | `clear` | `nav` · `clear` ⚠F5 | — |
| M4 | Extrude editor `[popover]` | apply / close | cancel (revert), close ⚠F1 | cancel (revert) ⚠F6 | `nav` · cancel (revert) D5 ⚠F14 | — |
| M5 | New datum draft `[popover]` | apply if the frame resolves ⚠F1 | cancel ⚠F1 | cancel | `nav` · cancel | — |
| M6 | Datum editor `[popover]` | apply / close | cancel (revert) ⚠F1 | cancel (revert) | `nav` · cancel (revert) D5 | — |
| M7 | New fillet / chamfer draft `[popover]` | apply if ≥ 1 edge | cancel (current) | cancel; the canvas is the pick surface | `nav` · cancel | — |
| M8 | Fillet / chamfer editor `[popover]` | apply / close | cancel (revert) | cancel (revert) | `nav` · cancel (revert) D5 | — |
| M9 | New / edited shell `[popover]` | apply if ≥ 1 face | cancel (revert) | cancel (revert) | `nav` · cancel (revert) D5 | — |
| M10 | New-sketch support picker `[popover]` | create the sketch if the support is valid ⚠F1 | cancel ⚠F1 | canvas: `input` (pick a face/datum); empty canvas: clear the face pick, keep the picker; outside the canvas: cancel D8 | `nav` · cancel | — |
| M11 | Export page | — | close | close | close, then `nav` ⚠F8 | — |
| M12 | Insert menu | activate the focused item (native) | close the menu only ⚠F3 | close | close, then `nav` | — |
| M13 | File menu | activate the focused item (native) | close the menu ⚠F1 | close | close | — |
| M14 | Rename input (document / feature) | commit | cancel | commit on blur (text field) | blur commits, then `nav` | text edit |
| M15 | Measure mode `[popover]` (0–2 targets) | — | close, drop the targets | canvas: `input` (add/remove a target); elsewhere close | close, then `nav` | — |

Notes:

- Empty model click clears the pick, unless Shift is held with a non-empty
  edge/face set (additive selection never throws the set away).
- A filtered-out pick (`all` / `edges` / `faces`) is *blocked*: it keeps the
  current selection instead of clearing it.
- In a blend/shell/support operation the canvas is a pick surface. Edge/face
  clicks feed the operation; they do not cancel it.
- Selection filters (`all` / `edges` / `faces` on the model, `all` / `points` /
  `curves` / `dimensions` in the sketch) persist across stage and cursor changes,
  and reset on new/open document (D12).

### 3.3 Global keyboard

| Key | Idle sketch | Idle model | Form open | Text field focused |
| --- | --- | --- | --- | --- |
| `v` / `b` / `g` | `select` / `box` / `lasso`, clear selection | `select` / `box` / `lasso`, keep selection | cancel form, then arm D6 | ignored |
| `l p r c a d t` | force sketch stage, arm the tool, clear selection | same | cancel form, then arm D6 | ignored |
| `Enter` | finish sketch (idle) / commit draft / end tool | — | apply if enabled, else no-op | commit field |
| `Escape` | pop one layer (R1) | pop one layer (R1) | cancel | cancel field |
| `Delete` / `Backspace` | delete sketch selection | — | — | text edit |
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

## 4. Audit: where the app diverges today

These are current behaviour, verified against the code. Fixing them is a
separate task; this section is the work list.

| # | Today | Where | Target |
| --- | --- | --- | --- |
| F1 | Escape handles export, blend and shell, then resets the stage. It **does not** cancel the extrude draft, an existing feature editor (extrude/datum), the datum draft, the support picker, the file menu, or restore the sketch-fillet radius. | `App.tsx:3080-3108` | R1, R9 |
| F2 | `SketchCanvas` has a window Enter listener with **no stage or layer guard**. With no line draft it calls `finishActiveMode`, so Enter inside the selection popover, mid-rect/circle/arc, mid-marquee, or while the sketch-fillet form is open **finishes the sketch**. It is live in model mode too (the layer is only `display:none`), where it can close an editor or call `finishSketch`. | `SketchCanvas.tsx:406-435`, `App.tsx:2057-2069`, `App.tsx:4408` | R2 |
| F3 | A focused timeline step handles Enter (activate step) and does not stop propagation, so the same Enter also reaches the window listener above. The step can activate and the sketch can finish in the same press. The insert-menu Escape listener has the same double-action bug. | `App.tsx:5203-5209`, `App.tsx:2990-2994` | R1, R2 |
| F4 | Only **sketch** step activation resets `tool` and bumps `cancelToken`. A non-sketch step, an insert gap, the empty tail or the start gap switches to model while a hidden line/circle/arc draft survives in the mounted canvas; a later Enter can commit it. | `App.tsx:1987-2038`, `App.tsx:2160-2205`, `SketchCanvas.tsx:337-368` | R5, R6 |
| F5 | Transitions omit some ephemeral state: `clearActiveFeature` and `handleNewSketch` do not clear `faceSelection`; `activateFeature` does not clear `filletOpen`; `beginExtrudeDraft` does not clear `datumDraft`/`filletOpen` and relies on callers. A stale face set or fillet form can reappear. | `App.tsx:1987-2003`, `App.tsx:2340-2410`, `App.tsx:2412-2442` | I4, R6 |
| F6 | A model-click while the extrude/datum editor is open is processed by the viewport **first** (pick) and then cancels the editor. Only blend/shell exempt the canvas, so one click both selects and discards the form. | `App.tsx:4234-4276`, `Viewport.ts:642-759` | R4, R9 |
| F7 | The support picker is not cancelled by Escape or a background click. Escape clears `bodyPick` (the chosen face) but leaves the picker open on the world-plane fallback. | `App.tsx:3080-3108`, `App.tsx:1572-1601` | R1, M10 |
| F8 | The export page is not closed by timeline navigation. `activateFeature`/`clearActiveFeature` do not touch `exportOpen`, so the page stays over the stage while the cursor changes behind it. | `App.tsx:1987-2038`, `App.tsx:5084` | R5, M11 |
| F9 | Escape on the sketch corner-fillet form closes it **without** restoring `filletRadius`; the footer `cancel` restores it. Escape and cancel differ. | `App.tsx:3097-3098` vs `App.tsx:3305-3309` | R9 |
| F10 | Inline editors disagree on outside-click: the dimension editor **commits**; the point X/Y editor **resets**. `INTERACTION.md` says an inline editor is cancelled by tapping outside. | `SketchCanvas.tsx:655-664`, `SketchCanvas.tsx:3229-3232`, `INTERACTION.md:164` | R1, S8–S9 |
| F11 | Clicking the timeline while a dimension editor is open commits the value first: the editor's capture-phase outside-pointer handler runs before the timeline click. | `SketchCanvas.tsx:655-664` | R5 |
| F12 | Global shortcuts only exclude `INPUT`/`TEXTAREA`/`contentEditable`. They fire while a `<select>` or button is focused and while menus/forms are open; `l p r c a d t` force the sketch stage, leaving the open form behind. That path also bypasses `changeTool`, so it does not clear `dimensionRequest`/`trimNotice` the way the toolbar does. | `App.tsx:3051-3174`, `App.tsx:3136-3170` | R7, R8 |
| F13 | Undo/redo do not close or rebase an open editor. The editor baseline can refer to a feature state the undo just removed; the next `cancel` may write stale parameters back. | `App.tsx:3063-3080`, `App.tsx:1839-1879` | R9, D9 |
| F14 | Navigation (timeline step, opening export) calls `dismissEditor`, which **keeps** live edits; footer `cancel` reverts them. The same form therefore has two different "leave" outcomes depending on how you leave. | `App.tsx:1250-1258`, `App.tsx:4044-4057` | R9, D5 |
| F15 | Enter with an extrude draft that has no profile does nothing, because `commitExtrudeDraft` returns early. The footer primary is disabled and explains nothing; Enter looks broken rather than disabled. | `App.tsx:2457-2479` | R11 |
| F16 | An empty click in the sketch while an extrude draft is open cancels the whole draft (via `handleSelect(null)`), not just the current region selection. A user trying to deselect one profile loses the draft. | `App.tsx:2504-2516` | S10, D7 |
| F17 | Header actions do not share the dismissal rule: opening export explicitly dismisses editors; opening the file menu or undoing does not. A form can stay open behind a menu. | `App.tsx:4044-4057`, `App.tsx:3030-3038` | R1, R8 |
| F18 | Escape/blend/shell flags are refreshed in a post-render effect, so Escape in the first tick after opening one of them can miss it and fall through to the stage reset. | `App.tsx:1797-1805`, `App.tsx:3081-3092` | R1 |
| F19 | The Select Other chip is `pointer-events:none`, and `Viewport.cyclePick()` is never called. The chip looks like a control but the only way to cycle is to click the geometry again. | `App.tsx:4324-4345`, `Viewport.ts:787-798` | L5 / UI affordance |
| F20 | Delete in model mode is a no-op even with a feature step selected or an edge/face set. Deletion lives in the timeline detail, so the key is inconsistent with sketch mode. | `App.tsx:3110-3114`, `App.tsx:2528-2543` | D10 (deferred) |

## 5. Decisions

Accepted **2026-11-07** for the first implementation pass. They are not
permanent: a decision can change, but changing one means editing its row,
updating every matrix cell that references it, and adding a line to the change
log below.

| # | Decision | Why / consequence |
| --- | --- | --- |
| D1 | **Escape pops one layer per press** (operation → gesture → tool → selection), instead of resetting everything at once. | "Press Escape until it stops" becomes predictable, and it matches the operation/popover stack. |
| D2 | **Enter in idle sketch finishes the sketch.** | It is the documented gesture and mirrors the `finish sketch` button. |
| D3 | **Enter with an armed creation tool and no gesture ends the tool** (→ `select`). | Two Enter presses finish the sketch; one Enter must not abandon the stage. |
| D4 | **An outside click cancels an inline editor** (dimension and point X/Y alike). | Matches `INTERACTION.md` and Escape. Committing on a stray click is the more dangerous mistake. |
| D5 | **Navigating away cancels and reverts an open editor** (timeline, opening export, anything else that leaves it). | One meaning of "leave"; also removes the stale-baseline risk (F14). |
| D6 | **A tool key or tool button while a form is open cancels the form, then arms the tool.** | The toolbar is visible and looks usable; a greyed-out toolbar is a bigger change. |
| D7 | **An empty sketch click during profile selection clears the regions and keeps the draft.** | The draft still has a visible `cancel`; losing the whole draft to a deselect click is surprising. |
| D8 | **An empty click in a picker follows validity.** Fillet/chamfer/shell have nothing to apply with no input → cancel. Support has a valid world-plane fallback → clear the face pick and keep the picker. | Do not keep an operation that cannot apply; do not throw away one that can. |
| D9 | **Undo/redo cancels an open form first, then acts.** | A form baseline must never survive a document change. |
| D10 | **Delete does not delete a feature in model mode** for now; the timeline detail stays the only path. Deferred to the multi-body/step work. | Keeps Delete scoped to sketch selection until a model selection owns deletion. |
| D11 | **Delete/Backspace during a line draft is a no-op** for now. Removing the last vertex is nice-to-have, not required for consistency; revisit when the draft supports undo. | — |
| D12 | **Selection filters persist across stage and cursor changes**, and reset on new/open document. | They are view-like, not document state. |

### Change log

| Date | Decision | Change |
| --- | --- | --- |
| 2026-11-07 | D1–D12 | Initial acceptance of the recommendations in the audit. |

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
- **IME composition.** Enter during IME composition should not commit the field;
  the current guard only checks the focus target.
- **Undo while a gesture is in progress.** The `mergeKey` contract covers point
  and slider drags, but a line/circle draft is not in the document yet; undo
  during it currently undoes the previous document change.
- **Header actions.** New/open/clear while a form is open: the document reset
  clears state, but it is not expressed as "cancel first" anywhere.
- **The Select Other chip.** Should it become a real button that cycles the
  candidates, or should the readout stop looking clickable?
