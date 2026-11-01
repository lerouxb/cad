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

### 5. Selection actions live in the selection line

The selection line (study 02) is the one exception: it reports the selected thing
and offers the two or three actions that apply to it (edit, delete, make
reference). It is a readout plus actions, not a form. Do not move input into it.

## Action vocabulary

Keep the set small. Every action is one of these:

| Role | Style | Examples |
| --- | --- | --- |
| Primary | `.text-action` | `apply`, `finish sketch`, `export` |
| Secondary | `.text-action.is-quiet` | `cancel`, `delete`, `make reference` |
| Inline in a row | `.seg button` | `X` / `Y`, `join` / `cut` / `intersect` |
| Stepper | `.stepper button` | `−` / `+` on a count |
| Value | `.tool-input` | a number in `mm` or `deg` |

There is no "OK vs Apply vs Done" ambiguity: the primary is always the verb of
the operation, and `cancel` is always the same word.

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
| Sketch layout (`index.html`) | popover ✓ | popover footer + selection line ✓ | keep |
| Sketch create (`sketch-create.html`) | **stage foot ✗** | — | **move polygon rows into a popover** |
| Body ops (`body-ops.html`) | popover ✓ | **no footer ✗** | **add apply / cancel** |
| Transforms (`transform.html`) | popover ✓ | **no footer ✗** | **add apply / cancel** |
| Extrude (`extrude.html`) | popover ✓ | **no footer ✗** | **add apply / cancel** |
| Section (`inspect.html`) | popover ✓ | **no footer ✗** | view-only; `done` instead of `apply` |
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
- Is the selection line still the right home for selection actions now that
  popovers exist, or should a selected object open a popover instead?
- Do `cancel` and `Esc` do the same thing everywhere?
