# Interaction contract

The studies in this folder share one interaction problem, and they have started
to drift: input appears in popovers in some places and in the stage foot in
others, actions are inconsistent, and the app has begun to squeeze configuration
into a bottom "status bar". This is the rule set that stops that.

The one-line version: **input is a draggable popover, actions are in its footer,
editing reuses the controls that created the thing, and the stage foot is a
readout, never a form.**

## The rules

### 1. Input lives in a floating popover

Anything that *configures* something — a tool, a feature, a sketch operation — is
a small popover anchored near the thing it changes.

- It is **draggable by its header** so it never blocks the geometry. Once moved,
  it stays where you put it (a re-render must not snap it back).
- It is clamped inside the stage, and its footer is always visible.
- It is **never** in the stage foot, and never a permanent sidebar.

### 2. Actions live in the popover footer

Every popover ends with the same two-part footer: a one-line **summary** of what
will happen on the left, and the **actions** on the right.

- **Primary:** `apply` (or the verb of the operation). One per popover.
- **Secondary:** `cancel`, quiet. Always present, always in the same place.
- **Destructive:** `delete`, quiet and separated from the primary.
- No icon buttons for actions. Actions are words in mono, uppercase.

The single-value **inline editor** is the one exception: it has no buttons at all
(Enter commits, Escape cancels). Everything with more than one field uses the
footer.

### 3. Editing reuses the controls that created it

Reopening a thing for edit shows the **identical** popover, pre-filled with its
current parameters — same rows, same order, same actions. There is no separate
"edit" surface, and editing is never a different shape from creating.

This already holds for the sketch layout operations (`index.html`): `edit`
reopens the pattern/mirror/offset popup with the object's parameters. It must
hold for features too (extrude, body ops, transforms).

### 4. The stage foot is a readout, not a form

The foot carries **state and view**: DOF, solver/kernel health, body stats, grid
step, snap on/off, zoom, the scale bar. It is where you *read*, not where you
*decide*.

- A control that changes the document (a distance, a count, an operation) does
  **not** belong in the foot.
- A control that changes only the view (zoom, grid visibility, snap) may live in
  the foot, because the decision *is* the view.

### 5. Selection opens a popover

Selecting anything — geometry, a dimension, a feature, a body — opens a popover
anchored to it: what is selected, the actions or parameters that apply, and a
footer. This **supersedes the "selection line" from study 02**: a bottom strip is
still a bottom bar, and it drifts. The popover is the same shape as the operation
popovers, so there is one thing to learn.

The selection popover is a **palette** when the actions are immediate (constraints,
`construction`, `fix`) — no commit pair, each chip acts at once — and a small
**form** when there is a value (a point's X/Y). It is draggable like the rest.

The one thing that stays anchored to its annotation rather than becoming a popover
box is the **inline editor**: a single dimension value, edited where the dimension
is. Everything else that a selection can do lives in the popover.

## Action vocabulary

Keep the set small. Every action is one of these:

| Role | Style | Examples |
| --- | --- | --- |
| Primary | `.text-action` | `apply`, `finish sketch`, `export` |
| Secondary | `.text-action.is-quiet` | `cancel`, `delete`, `make reference` |
| Inline in a row | `.seg button` | `X` / `Y`, `join` / `cut` / `intersect` |
| Immediate action | `.sc-chip` | a constraint, `construction`, `fix` |
| Stepper | `.stepper button` | `−` / `+` on a count |
| Value | `.tool-input` | a number in `mm` or `deg` |

There is no "OK vs Apply vs Done" ambiguity: the primary is always the verb of
the operation, and `cancel` is always the same word.

## Sketch inputs are the same family, not the same shape

The sketch has inputs that are not "configure a feature", so they should not all
become popovers. There are three shapes, and they share the type roles, the
action vocabulary and the placement rule (**controls appear where the decision
is**) — but not the same box:

1. **Operation popover** — a multi-parameter form for an operation or feature
   (extrude, pattern, combine). Full anatomy: kicker, title, rows, hint, footer.
   Has a commit pair.
2. **Inline editor** — a *single value* edited at the thing it belongs to: a
   dimension's value, a point's X/Y. It **replaces the annotation's label** (the
   value is never shown twice), and it carries the value's own options — a
   dimension's driving/reference lives in the same control, not a second surface.
   Commit with **Enter**; cancel with **Escape** or by tapping outside. There are
   **no apply/cancel buttons**: the value is already the thing you are looking at,
   and on touch the keyboard's return is the commit.
3. **Selection popover** — the actions for the *current selection*: the
   constraints that apply, `construction`, `fix`, `delete`. It is a palette of
   immediate actions, not a form, so it has **no commit pair** — each chip acts
   at once. It replaces the old floating "selection card" + "constraint bar",
   and it is draggable like every other popover.

The rule of thumb:

- Several parameters and a commit → **operation popover**.
- One value, and it lives on an annotation → **inline editor**.
- Actions that apply immediately to the selection → **selection popover**.

The dimension editor is the clearest case for the inline shape: study 02 already
puts it *at* the dimension, with `apply` / `cancel`. That is correct, and it stays
there. The constraint editing is the case for the selection popover.

## Popover anatomy

```
┌──────────────────────────────────────────┐
│ KICKER (kind)                    cancel  │   ← drag handle: the header
│ Title (the object or feature name)       │
├──────────────────────────────────────────┤
│ label                control             │   ← rows: seg / stepper / input
│ label                control             │      / toggle / list
│ …only the rows that apply…               │
├──────────────────────────────────────────┤
│ hint (quiet, one line)                   │
├──────────────────────────────────────────┤
│ summary                     apply        │   ← footer
└──────────────────────────────────────────┘
```

The kicker says what *kind* of thing this is (`sketch tool`, `body op`,
`sketch feature`, `inspect`); the title is the object's name when editing
(`pattern 1`) or the tool's name when creating (`rectangular pattern`).

## Where each surface stands

| Surface | Input | Actions | Target |
| --- | --- | --- | --- |
| Sketch layout (`index.html`) | popover ✓ | popover footer | keep (its selection line should become a selection popover) |
| Sketch constraints (app) | **selection card + constraint bar ✗** | immediate chips | **one selection popover** |
| Dimension edit (app, study 02) | inline editor ✓ | Enter / Escape, no buttons | keep |
| Point X/Y (app) | **selection card ✗** | — | **inline editor, or rows in the selection popover** |
| Sketch create (`sketch-create.html`) | popover ✓ | popover footer ✓ | keep |
| Body ops (`body-ops.html`) | popover ✓ | popover footer ✓ | keep |
| Transforms (`transform.html`) | popover ✓ | popover footer ✓ | keep |
| Extrude (`extrude.html`) | popover ✓ | popover footer ✓ | keep |
| Section (`inspect.html`) | popover ✓ | footer `done` | keep |
| Grid / zoom (mockup 02) | foot menus | — | keep: the decision *is* the view |

Every popover in this folder is draggable by its header.

## Guarding against the drift

The failure mode is a bottom bar that slowly absorbs everything: first the view
controls, then the selection, then the feature parameters, until the whole app is
a status bar with a viewport behind it.

- If a new control changes the document, it goes in a popover.
- If it changes the view, it may go in the foot.
- If it acts on the selection, it goes in the selection line.
- If it does not fit any of those, that is a signal to add a rule here, not to
  add a row to the bottom bar.

## Open questions

- Should the popover remember its position per tool, or is one shared position
  enough?
- Should the popover collapse to just its header when dragged out of the way?
- Study 02's selection line is now superseded by the selection popover; the
  mockup should be revisited (it currently shows the bottom strip).
- Does selecting a **dimension** open a selection popover (with `make reference` /
  `delete`) *and* the inline editor, or only the inline editor?
- Do `cancel` and `Esc` do the same thing everywhere?
