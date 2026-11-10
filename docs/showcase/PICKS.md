# Picking inputs inside a feature form

> Status: **active contract**, 2026-11-08. The visual companion is the
> “Picking inputs inside a form” section of [`selection.html`](selection.html).
> This is the contract for how a feature form asks for its inputs, how those
> inputs are re-picked, and how they are listed. It complements
> [`SELECTION.md`](SELECTION.md) (the selection families and feature chips),
> [`INTERACTION.md`](INTERACTION.md) (the popover surface),
> [`MODES.md`](MODES.md) (Escape and empty clicks),
> [`OFFSET_FACES.md`](OFFSET_FACES.md) and [`REVOLVE.md`](REVOLVE.md).

## The one line

**Every feature form names its inputs and then lets you pick them the same way:
a row says what is needed, a list says what is chosen, and the stage is the pick
surface. There are only three pick patterns: always-live model faces/edges, a
sketch-stage profile pick, and a single candidate pick for an axis or support.**

## 1. The three pick patterns

| Pattern | Inputs | Stage behaviour | Row control | List |
| --- | --- | --- | --- | --- |
| **Model multi** | faces (offset, shell), edges (fillet, chamfer) | the model stage is the pick surface for the whole form; no pick mode | none; the hint says `click faces/edges in the model to add or remove` | yes, one row per item |
| **Sketch regions** | profiles (extrude, revolve) | the sketch stage becomes the pick surface; region fills are pickable, geometry is decoration | `select` in model mode, `pick in sketch` in sketch mode | yes, one row per profile |
| **Single candidate** | axis (revolve), support (datum/sketch) | a temporary candidate mode: only the candidates are pickable | `pick`; the row shows the current value | no; one value row |

There is no fourth pattern. A control that configures a value (distance, angle,
operation, end) is not an input picker and never needs a pick button.

- **Model multi** inputs are already on the stage, so a button would add a mode
  for no reason.
- **Sketch regions** are in another stage, so the row needs an explicit stage
  switch. The form stays open.
- **A single candidate** is one specialized pick (an infinite axis, a support
  face); it gets a `pick` row so the region fills and ordinary geometry are not
  accidental targets.

## 2. The input row and the list

Every multi-value input has a **row** and a **list**. The row is the summary; the
list is the detail.

```
┌──────────────────────────────────────────────┐
│ faces        2 selected                       │
│  Face 1      planar · 640 mm²          remove│
│  Face 2      cylindrical · 188 mm²     remove│
│ distance     [ 2.0 ] mm   ─────●─────        │
│ direction    out  |  in                       │
└──────────────────────────────────────────────┘
```

- The row label is the input family: `sketch`, `profile`, `faces`, `edges`,
  `open faces`, `axis`.
- The row value is a count + `selected` for multi inputs (`2 selected`) and the
  chosen identity for a single input (`line 1 · construction`, `Sketch 1`).
- The list sits **directly under its row**, before the value row. One list per
  multi input; never duplicate the count as a list heading (`edges 2 edges`).
- A list row is **`Kind N` + a mono detail + `remove`**:
  - `Face 1` — `planar · 640 mm²` or `cylindrical · 188 mm²`;
  - `Edge 1` — `18.0 mm` (the length);
  - `Profile 1` — `2,400 mm²` (or the bounds when area is not meaningful).
- The ordinal is the item's position in the **current set**; removal closes the
  gap and renumbers. It is not a persistent id. **Every list uses `Kind N`**
  (`Line 1`, `Face 1`, `Edge 1`, `Profile 1`), including the selection popover;
  the stable `TopoRef` role is not a row label. The body-pick status badge may
  still show `face_04` as a readout.
- `remove` removes that one input. A feature form uses per-item `remove`; the
  selection popover uses one `clear` for the whole set. They are different
  surfaces and do not share a command.
- The list **scrolls** when it is long (about six rows) and never makes the
  popover grow past the viewport.
- Use the shared number formatter for the detail. Do not show raw floats.
- An empty input shows `0 selected`, omits the list, names the pick gesture in
  the hint, and disables the primary. There are no placeholder rows.

## 3. Model multi: faces and edges

- The stage is live for the whole form. Do not put a `pick`/`select` button on
  the row.
- A plain click on an unpicked item **adds** it; a plain click on a picked item
  **removes** it. Shift is an alias for add and is never required. The hint says
  `click faces/edges in the model to add or remove`.
- A box/lasso is a bulk add inside a form; it never clears the current set. An
  empty marquee is a no-op.
- The form **forces the model filter** to its family for the duration:
  `faces` for offset/shell, `edges` for fillet/chamfer. A filtered-out hit is
  blocked; it never clears the input set. The filter control is read-only while
  the form is open and returns to `all` on close.
- The list and the stage overlay are the same set. Removing from the list
  removes the overlay and vice versa.
- A background click follows [`MODES.md`](MODES.md) D8: it cancels the form. A
  click on a pickable item never cancels it.
- Size limits and source rules:
  - faces/edges from the feature's own preview or from the feature being edited
    are not pickable; a filtered-out hit is not a background click.
  - at least one input is required; the primary is disabled with the reason.
- Select Other is hidden while a form is picking; a click toggles the top
  candidate. Do not leave a cycle chip that competes with the form.

## 4. Sketch regions: profiles

- The profile row is `profile  2 selected  select` (model mode) or
  `profile  2 selected  pick in sketch` (sketch mode).
- `select` switches to the sketch stage and makes region fills the primary pick
  targets. The form stays open; the stage is the form's pick surface.
- Click a region to toggle it; Shift adds; box/lasso selects regions in bulk.
  The same `All / Voids / Auto` panel appears when there is more than one region.
  `Auto` is the explicit largest-material helper, never an invisible default.
- The profile list follows the row. Each row is `Profile N · area · remove`.
  Multiple regions are listed and removable.
- Changing the source sketch clears the profile list and any dependent input
  (for example a revolve axis). The form stays open with the new source.
- Leaving the sketch stage returns to the model with the list intact. Enter or
  `done` returns to the form/model, not apply.
- Empty profiles: `0 selected`, primary disabled, hint `pick at least one
  profile`.
- An empty sketch click clears the profile set and keeps the draft (MODES D7),
  unlike a model form's background click. Profile pixels are the form's input
  surface; losing the whole draft on a deselect is surprising.

## 5. Single candidate: axis and support

- A single candidate is a **row + `pick`**, never a wall of chips in the form.
  The current value is the row value:
  `axis  line 1 · construction  pick`, `axis  X axis  pick`, or
  `support  face 1 · planar  pick`.
- `pick` enters a temporary candidate mode:
  - for a revolve axis: every sketch line (construction included) and the X/Y
    references are pickable; region fills are decoration;
  - for a support: planar faces and datum planes are pickable; other geometry is
    decoration.
- The candidates are highlighted; clicking one sets the row and returns to the
  form. A click on a non-candidate is blocked, not a cancel.
- Escape exits the pick **first** and keeps the form; the next Escape cancels the
  draft (MODES M17). Do not cancel on the first Escape.
- A single candidate is not toggled off by clicking it again; an axis/support is
  required. Use the row's `pick` to change it.
- A lost candidate (a deleted line or face) is a **lost support**: the row says
  so and offers `reselect` / `revert`; it never silently retargets to X/Y, the
  next line, or a nearby face.
- Do not list every candidate as a form list; the stage is the candidate list.

## 6. Form order, summary and states

The form reads top to bottom in one order:

1. **source** — `sketch`, target body, splitting tool;
2. **inputs** — the input row, then its list;
3. **value** — distance, radius, angle, thickness;
4. **options** — direction, operation, end, chain, keep tools;
5. **derived readout** — `Ø old → new`, result count, volume;
6. **error** — inline, specific, last good preview kept;
7. **footer** — summary, quiet `cancel`, primary apply.

- Inputs before values: pick what the feature acts on, then tune it.
- The list follows its input row immediately; it is not after the value.
- The footer summary is **value · input** for a modification (`R 2.0 mm · 2
  edges`, `2.0 mm · 2 open faces`, `+2.0 mm · 2 faces`) and **size · operation ·
  input** for a boolean feature (`12.0 mm · cut · 2 profiles`, `360° · intersect
  · 2 profiles`). The list is not repeated in the summary.
- Empty input: `0 selected`, no list, hint, disabled primary. No auto-pick.
- A lost input stays in the list with a lost marker and reselect/revert; it is
  never silently dropped.
- A failed preview keeps the inputs and list; only the primary/error changes.

## 7. Seeding, editing and source changes

- A feature chip starts the form from the **current selection**. The list is
  populated with exactly that set; the form does not open empty.
- Selecting an existing step opens the form with its stored inputs. The list is
  the same readout, in the stored order.
- A new feature with no selection is not offered: the chip is hidden or disabled,
  not a form with an empty input.
- Changing the source (`sketch`, target body) clears the inputs and any dependent
  input (axis). The list visibly empties; it does not carry ids across sources.
- `cancel` restores the baseline inputs for an edit, or drops the draft. `apply`
  uses exactly the listed set.
- The list order is deterministic for a stored feature (the stored order); it is
  not recomputed from a map or a selection order.

## 8. Decisions

| # | Decision | Why |
| --- | --- | --- |
| P1 | **Three pick patterns only:** model multi, sketch regions, single candidate. | One gesture per kind of input; no per-feature invention. |
| P2 | **Input row + list before the value.** | You choose what the feature acts on before tuning it. |
| P3 | One list per multi input; `Kind N` + mono detail + `remove`. | Consistent, scannable, removable without the stage. |
| P4 | Model inputs are **always live**; plain click toggles; Shift adds; no pick button. | The stage is already the model; a button would be a mode for nothing. |
| P5 | A model form **forces its filter** (`faces`/`edges`) and restores `all`; one family at a time. | A face click must never clear an edge set, and vice versa. |
| P6 | Profiles use a **stage switch** (`select` / `pick in sketch`); the form stays open. | Regions are in the sketch stage; the form is not. |
| P7 | A single candidate uses **row + `pick`**, never a chip wall; Escape exits the pick first. | An axis/support is one decision, not a list of guesses. |
| P8 | Empty input = `0 selected` + reason + disabled primary; **no auto-pick**. | An input is a decision, not a default. |
| P9 | **Seed from selection; edit from stored inputs; source change clears.** | The list is the truth at every entry point. |
| P10 | Summary: **value · input** for modifications, **size · operation · input** for booleans. | One reading order; the input is always last. |
| P11 | **All lists use ordinals** (`Line 1`, `Face 1`, `Edge 1`, `Profile 1`); stable refs stay in the document. | One row grammar; a picked set is not document identity. |
| P12 | Feature forms use per-item `remove`; the selection popover uses one `clear`. | Different surfaces: a form edits inputs, a palette clears a selection. |
| P13 | The list scrolls; a long set never grows the popover past the viewport. | The stage stays visible. |
| P14 | A lost input is visible with reselect/revert; never a silent retarget. | The general no-silent-fallback rule. |

## 9. Open questions

| # | Question | Current proposal | Status |
| --- | --- | --- | --- |
| O1 | Should an empty model click clear the face/edge set and keep the form, like profiles, or cancel the form? | Follow MODES D8: cancel the form. The profile exception is D7. | Implemented (2026-11-10): project/blend/shell/offset cancel on an empty model click |
| O2 | Is a profile list row identified by area or by boundary count? | Area (`Profile 1 · 2,400 mm²`); fall back to bounds when area is meaningless. | Implemented: area, via `formatArea` |
| O3 | Should a one-candidate axis use `pick` or a single chip? | Always the row + `pick`; the candidate mode is the list. | Implemented for the revolve axis; the support picker is still open |

## 10. Current implementation and gap

Implemented (2026-11-10):

- **Model multi** (faces for offset/shell, edges for fillet/chamfer): the stage is
  always live, a plain click toggles, Shift adds, and the form forces its family
  filter (read-only) and restores `all` on close. The form lists every input as
  `Face N` / `Edge N` with a mono detail and `remove`.
- **Sketch regions** (extrude, revolve): the profile row shows `N selected` with
  `select` / `pick in sketch`, followed by a `Profile N` list above the value.
  The revolve axis is `axis · line N · construction · pick` with candidate
  highlighting; there is no chip wall.
- **Offset/shell/blend** put their input row and list above the value and use
  `value · input` summaries; offset shows the derived `Ø old → new` readout.
- **Selection popovers** use ordinals (`Line 1`, `Face 1`, `Edge 1`) and one
  `clear`; feature forms use per-item `remove`.
- **Lists scroll** (about six rows) and row details use the shared
  `formatArea` / `formatLength` helpers.
- The project form uses the same `InputRow` / `PickList` grammar for faces and
  edges, and an empty model click cancels it.
- A deleted revolve axis is shown as `lost · line removed`; `pick` reselects it.
- The selection study has the fillet/chamfer/shell form card.

Still open:

- **P14 for model inputs.** A face/edge input that disappears after an upstream
  edit surfaces the kernel error and can be removed or re-picked, but there is no
  explicit per-row lost marker with `reselect` / `revert` for offset, shell or
  blend. The revolve axis has the lost label and a reselect.
- **Single-candidate support.** The new-sketch support picker is still the
  world-plane / face / datum picker, not `support · face 1 · planar · pick`.
  `PLAN.md` keeps this as an open decision (exempt the picker or move it to the
  row + `pick` shape).
- **Profile row detail** is area for every region; a bounds fallback for a
  degenerate/meaningless area is still open (O2).
