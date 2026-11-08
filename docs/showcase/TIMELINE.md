# Timeline contract

`INTERACTION.md` covers the popover/actions/foot contract. This file covers the
**timeline**: how steps, bodies, groups and insertion behave, and why. It is the
contract behind [`bodies.html`](bodies.html) and the changes made to the shared
timeline while building it.

The one-line version: **one timeline; every step lists what it creates; bodies
appear inline next to the step that made them; groups and the insert affordance
never move the steps.**

## Why one timeline

Fusion splits the two: a timeline of steps, and a separate object list of bodies.
That split is the problem — it is not obvious that a body is the thing *as it
exists at that step*. So:

- **The step is the step; the output is the thing.** Every step lists what it
  *creates* — a sketch, a datum plane or a body — and the chip is where you edit
  that thing, not the step.
- **Rolling back visibly pauses** the steps, and therefore the bodies, that no
  longer exist.
- **Components are out of scope.** A component is a namespaced set of bodies with
  its own timeline, which is a separate model. The only thing to protect now is
  the seam: a body id must be namespacable later as `componentId/bodyId`.

## The model

- A feature produces a **set** of bodies. Disjoint results stay separate bodies;
  results that share an edge fuse.
- A step's outputs are chips. The op prefix says how the step relates to the
  output:

  | Op | Meaning | Example |
  | --- | --- | --- |
  | `+` | the step **creates** it | `+ ○ body` (extrude new body), `+ ⊡ base profiles` (sketch) |
  | `→` | the step **references** it | `→ ○ body` (join), `→ ○ lid` (cut) |
  | `−` | the step **consumes** it | `− ○ ~~lid~~` (merge lid into body) |

- The **type icon** is a small dot before the name: dashed square = sketch /
  profile, circle = body, diamond = midplane / datum plane. It is centred on the
  text's x-height with `vertical-align: middle` — font-relative, never a tuned
  pixel offset (see [Chip anatomy](#chip-anatomy)).
- **Double-click a chip to rename it**, exactly like a step name. Sketches and
  planes rename the same way.
- **Selecting a body highlights it in 3D** (a quiet highlighter wash on the solid,
  not just the chip) and opens its popover (visibility, appearance, isolate).
- **A consumed body strikes through**, but only its **name** — the `−` and the
  type dot stay legible. It is visual only, not selectable.
- **Identity breaks visibly.** If an edit merges two bodies, a downstream step
  that targeted one of them loses its body: ink, a dotted rule and a `!`, with
  `reselect` / `open sketch`, exactly like a lost face. This is derived input
  (`lostFaceRefs`-style), never document state.

## Steps

- **The head is `NN · KIND` on one line** — index, a middle dot, then the type.
  The same middle dot separates the meta line's properties (`XY · 2 profiles`), so
  the two lines rhyme. This saves a line of vertical space.
- **A step's identity is stable; the number it shows is its position in the
  timeline.** Inserting a step in the middle renumbers the *display*, not the
  step. Paused styling and the 3D stage key off position, not identity.
- **Opening a document selects no step.** The cursor starts empty
  (`activeFeatureId = null`), the full document renders, the track is scrolled to
  its end, and no step or feature popover is active. Selecting a step is explicit.
- **Escape at rest clears the cursor.** Once there is no menu, editor, gesture,
  tool or selection left to cancel, Escape does exactly what the end tail does:
  no step, full document, track at the end. This is the quick way back to the
  finished model.
- **The active step is marked by a bottom line only** —
  `box-shadow: inset 0 -2px 0 var(--marker)`. There is no name wash; the line is
  the marker.
- **The active marker reaches the cell edges**: it extends half a gap past the
  step on each side, so it runs *under* the dividers rather than stopping at the
  step's box.
- **The hover grip is the only drag origin.** The step itself is `cursor:
  pointer`; a dot-grid grip appears on hover at the step's top-right and only it
  has `cursor: grab`.
- **The grip only exists on draggable steps** (see [Groups](#groups)).

## Groups

- **A group draws a bracket** across its steps with its name and a `−` to
  collapse. Collapsed, it becomes a **stack chip** (mark, name, count) that you
  click to expand — *per group*, not a global toggle.
- **Collapsed is narrow: the name over the count**, stacked, not side by side.
  A collapsed group's whole point is to take less width.
- **The collapsed chip sits below the top rule** (a margin, not a border) so it
  does not touch the line.
- **Collapse is refused while the active step is inside** the group — roll back
  first. The `−` is disabled and says so in its tooltip.
- **Groups are flat.** No nesting.
- **Groups are not selectable.** Only steps are. A group can be **named**
  (double-click), **collapsed**, **expanded** or **ungrouped** — nothing else.
- **Drag to group** (not shift-click):
  - drag a step onto an **adjacent** step → they become a group;
  - drop a step onto the **edge** of a group → it joins;
  - drag the **first or last** member out → it leaves, landing beside the group.
- **Groups stay contiguous and steps are not reordered yet.** A **middle member
  is not draggable** (no grip), and a drag that would move a step somewhere else
  does nothing. This is deliberate: contiguity is what makes the bracket honest.
- **A one-step group dissolves.** When the second-to-last member leaves, the group
  disappears and the remaining step is alone and ungrouped.
- **Grouping is the same object as a timeline group in Fusion** (used 10× in the
  real part), so this is not a nicety — see `BACKLOG.md`.

## Insert

The goal: **insert anywhere, without the steps moving.** The old affordance (a `+`
that appeared after the selected step) made the steps jiggle as the active step
changed.

- **A narrow, full-height column sits in every gap** — between each pair of steps,
  after the last step, and between the members of a group. It always occupies the
  same space, so the steps never shift.
- **The column is a divider that doubles as the insert button**, and the two are
  separate marks:
  - the **divider** is a permanent 1px, full-height line that meets the rules
    above and below;
  - the **`+`** is a separate, inset mark (6px top and bottom) that **grows out
    from the middle** on hover. It paints **above** the divider and is **opaque**,
    so the line never shows through it.
- **Clicking a gap selects the step before it**, then opens the insert menu — so a
  click on a far-away gap re-anchors first.
- **The menu lists everything you can insert** — `sketch` and `plane`. **Extrude
  is not in the menu**: it is created from the sketch step's own chip, because it
  needs a sketch to consume.
- **The new step lands at the gap**, not at the end — and if the step before it is
  in a group, it lands **inside that group** (drag it out later if you don't want
  it there).
- **Escape or a click outside closes the menu.**
- **There is a gap before the first step too**, so a step can be inserted at the
  very start.
- **The track has no extra horizontal padding.** The leading tail is a fixed
  44px start target. The trailing tail fills the remaining track width after the
  final insert gap (minimum 44px), so clicking anywhere to the right of the last
  step's insert gap clears the cursor. The final insert gap remains the 26px
  insert affordance. With no active step the stage renders the full document and
  the detail row shows only the autosave/status note.
- **Tooltips:** the gap says `Insert a step here`; the group controls say
  `Collapse group` / `Expand group`.

## The baseline (heights and alignment)

These are what stop the timeline looking broken as groups and insert points come
and go:

- **Every step is the same height, grouped or not.** The group-head band sits
  *above* the step band; an ungrouped step starts below the band via a **margin**,
  not padding, so its box does not grow to include the band. Same for the gap
  columns.
- **Indices align** across grouped and ungrouped steps, and the step **bottoms
  align**.
- **Steps stretch to the timeline baseline**, so the active marker sits exactly on
  the bottom rule instead of floating a sub-pixel above it.
- **A full-width rule runs above the steps** at the top of the step band — below
  the group head band, so it passes beneath the group info and continues past
  every step.

## The bottom status line

- The timeline keeps the app's bottom status line and its rule runs **edge to
  edge** (the app's timeline is a track over a detail row).
- The step block already says everything, so the line carries **only what the
  block cannot**: a status note (`autosaved locally`) on the right, or the
  lost-body message plus `reselect body` / `open sketch`. It never repeats the
  step / type / outputs. With no active step it shows only the status note; the
  step actions are absent.

## Chip anatomy

- The chip's contents are **inline**, not flex, so the type dot can use
  `vertical-align: middle` — which by definition aligns the dot's midpoint to the
  baseline plus half the parent's x-height. That is correct for whatever monospace
  the viewer has; **do not replace it with a tuned `top` offset** (that was tried
  and it broke on a different font).
- Spacing between the op, the dot and the name is a margin on the dot, not a flex
  `gap`.

## Reference values (mockup)

The mockup's numbers, for translation into app tokens — not law:

| Thing | Value |
| --- | --- |
| Group-head band | `--bd-band: 31px` (head min-height 22 + padding-bottom 4 + border 1 + margin-bottom 7, ≈) |
| Gap / divider column | `--bd-gap: 26px` |
| Divider | 1px wide, `top: 0; bottom: 0` |
| `+` mark | 14px wide, inset 6px top/bottom |
| Active marker | 2px, extends half a gap (13px) past the step |
| Top rule | 1px, at the top of the step band, full width |

## Where each piece stands

| Piece | State |
| --- | --- |
| Multiple bodies inline in the timeline | designed (`bodies.html`) |
| Groups (bracket, collapse, drag to group) | designed |
| Insert affordance (gap columns, menu) | designed |
| Body chips (`+` / `→` / `−`, rename, highlight, lost) | designed |
| Step head `NN · KIND`, position numbering | designed |
| Bottom status line (status note / lost error) | designed |

## Decided

- **No silent fallbacks.** When an operation cannot do what it was set to do — a
  `join` with nothing to join, a reference that lost its body — say so. Do not
  quietly change the operation or retarget the reference. There may be rare
  exceptions, but none have been found; assume "surface it" until one is.
- **A join that cannot join does not silently change the operation.** When a join
  is impossible (nothing to join, or a disjoint result) the operation control
  selects `new body` and the draft/preview says so — Fusion does the same. Because
  the draft states the operation explicitly, this is not a hidden fallback. An
  applied feature still reports a *lost reference* rather than retargeting.
- **Lost-body recovery offers follow-the-merge.** When a merge steals a downstream
  step's body, `reselect` alone is a dead end — the body it wanted is gone. Offer
  to retarget the reference to the surviving body, with `reselect` as the escape
  hatch.
- **Insert at the very start** is supported (a gap before the first step).
- **The end tail fills the track and clears the cursor; the start tail is a 44px target** (see [Insert](#insert)). No extra track padding.
- **Visibility is a split button on the chip.** The left part of a chip selects
  the thing; the right part is a small **eye** glyph (outline = shown, struck
  through = hidden) with a tooltip. It works for a body, a sketch or a plane
  alike, and it is the **only** visibility control — there is no hide-the-step.
  No hover (undiscoverable, no touch) and no popover (too many clicks to hide
  several). See [`bodies.html`](bodies.html).
- **Insert is hover-only.** Every gap column is invisible until hovered. The
  "always show the one after the active step" affordance was dropped; a touch
  device will get a different treatment (probably an always-visible variant that
  is designed to look right when *all* the gaps show at once), not this one.
- **Selection filters are one row that follows the tool.** The selection popover
  only exists once something is selected, so filters and Select Other need a home
  *before* that: a **tool options row** under the tool line holding the current
  tool's options. **One filter at a time** (no multi-select checkboxes), the
  **create variants share the row** (centre-point vs two-point circle, and so on),
  and the **select tools come to the model view too** with their own filters
  (`edges` / `faces` / `bodies`). The row follows the *tool*, not the mode. See
  [`select.html`](select.html) for the sketch row and
  [`select-model.html`](select-model.html) for the model one.
- **A collapsed group needs only mark + name + count.** No peek (a body count, a
  mini stack). It is your own project, so the name is enough context.
- **The active-step-inside-a-group double rule stays.** The bottom-line marker
  under the step and the group bracket above it are two close horizontal rules,
  and that is fine.
- **Divider vs `+` inset is settled by the current design.** The divider is a
  permanent full-height line; the `+` is a separate mark inset 6px top and bottom
  so it never collides with the active marker. Nothing to change.
- **Pattern / mirror / offset are sketch objects, not steps.** They are owned by
  the sketch step and listed in its detail, the way a constraint persists. A
  body-level pattern / mirror / offset would be a history step — a separate, later
  thing. See [`index.html`](index.html) and [`README.md`](README.md).
- **A body move / copy is a re-editable feature**, like every other step. (Sketch
  move / copy stays a sketch object.) See [`transform.html`](transform.html).
- **Body identity across a split or combine** follows the backlog decision: a
  split mints **new body ids** carrying a role + geometry `TopoRef`, so downstream
  references can recover. See [`BACKLOG.md`](BACKLOG.md).
- **Only the body-creating step owns appearance.** It lives in that chip's
  popover; a later join or cut does not edit it.
- **A lost splitting plane or face follows the face-support precedent** —
  surfaced with reselect / revert, never a silent fallback.
- **A stale reference in a sketch object is surfaced**, not silently re-run.
  Provisional; revisit with a real case.

## Still open

Nothing right now — every question raised by the bodies/timeline study is decided
above. New ones go here.
