# Sketch constraints and dimensions

> Status: **active contract**, 2026-11-08. This is how every constraint and
> measurement is drawn, placed, selected and removed. The visual companion is
> [`constraints.html`](constraints.html). The mark grammar (Phase 1) is
> implemented; §10 records what remains. When the code and this file disagree,
> one of them is wrong — decide which.
>
> Companion docs: [`INTERACTION.md`](INTERACTION.md) (selection popover, inline
> editor, actions), [`MODES.md`](MODES.md) (Enter / Escape / background / timeline)
> and [`TIMELINE.md`](TIMELINE.md).

## The one-line version

**The geometry is the drawing. A constraint is a quiet mark on it, a dimension
is a quiet measurement beside it, and only the current thing gets the
highlighter.**

Two consequences:

- A constraint is **not** a row of letters floating over the midpoint of a line.
  It is a mark that belongs to the geometry it constrains.
- A dimension is **not** a constraint icon plus a value. It is a measurement:
  extension lines, a dimension line, and one value. A driving dimension is also a
  constraint mathematically, but it is drawn once, as the dimension.

## 1. The two layers

| Layer | What it is | Counts toward DOF | Selectable | Removed by |
| --- | --- | --- | --- | --- |
| **Geometry** | points, lines, arcs, circles | — | yes | delete |
| **Constraint** | a relationship with no value (`horizontal`, `parallel`, …) | yes | **yes, through its mark** | its mark: click to select, Backspace/Delete to remove (or the applied chip) |
| **Driving dimension** | a measurement that constrains (`distance`, `angle`, `diameter`) | yes | yes | label editor `delete`, or the chip |
| **Reference dimension** | a measurement that only reads (`driving: false`) | no | yes | label editor `delete`, or the chip |

The document stores dimensions as `SketchConstraint` entries, but the UI treats
them as a separate visual class. **Never draw a constraint glyph for a
dimension.** A driving distance is not also an “equal” or “parallel” mark.

## 2. The mark grammar

| Form | What it is | Examples |
| --- | --- | --- |
| **Glyph** | a small mark attached to the geometry | equal tick, perpendicular square, point ring, midpoint tick, symmetric chevron, tangent diamond |
| **Badge** | a tiny mono label in a box, for a relationship with no readable geometric mark | `H`, `V`, `∥`, `⊥`, `≡` |
| **Connector** | a quiet dashed tie between the participants | parallel, perpendicular (no intersection), collinear, symmetric |
| **Axis** | a dash-dot centreline, only while the constraint is active | symmetric |
| **Leader** | a line from a value to the thing it measures | radius, diameter |
| **Label** | the measurement's value | `70.0`, `45.0°`, `(89.0)` |

### The rules

1. **One relationship, one mark per participant.** A parallel constraint puts a
   mark on each line, not two marks stacked at one midpoint. A symmetric
   constraint draws one connector with the pair, not a badge on each line.
   A **single-participant badge** (H/V) sits *on* its line at the midpoint; a
   multi-participant badge sits outside its entity so each participant can carry
   its own mark without another offset.
2. **The mark attaches to the thing it constrains.** It never floats in empty
   space, except a badge at a connector's midpoint when the pair has no natural
   home.
3. **Orientation follows the geometry when the mark encodes direction.** Equal
   ticks are perpendicular to their line; the perpendicular square rotates with
   the corner; symmetric chevrons are perpendicular to the axis. Letter badges
   stay upright.
4. **Marks are screen-space.** A 6–8 px mark, 1–1.6 px stroke, 9 px text. They do
   not grow or shrink with the sketch zoom. They are not document state.
5. **Stack along, not in a tower.** Give each mark a slot on its entity (line:
   30 / 50 / 70 %; point: a ring; circle/arc: the top or the leader angle).
   Never put three letters at the same midpoint.
6. **Level of detail.** If an entity is too short for its marks, or the zoom is
   below the readable threshold, collapse its marks into one small cluster dot;
   hover or selection expands the cluster. The underlying constraints are still
   there.
7. **Draw order.** Geometry → dimension lines → constraint marks → dimension
   labels → selection overlays. Marks sit above the sketch and above the thin
   dimension lines, but below the value labels; labels carry a paper-coloured
   halo so they stay readable over a dimension line or a constraint.
8. **Never encode a constraint by colour alone.** Shape and position carry the
   meaning. The highlighter means “current / selected”, never “constrained”.
   The highlighter never becomes the mark's ink: on a selected line the marks
   stay ink on paper, with a marker underline, so they read against the same
   wash that selects the line.

### Slots on an entity

| Entity | Slots |
| --- | --- |
| line | 30 % (equal), 50 % (H/V **on** the line, sliding if occupied; midpoint tick), 70 % (parallel/perpendicular, 7 px outside the normal) |
| point | a ring or dot at the point; extra badges offset 8 px along the bisector away from the geometry |
| circle | radial tick at the top; a second equal group at −30°; a badge at 210° |
| arc | radial tick at the arc midpoint; badges at the arc midpoint |

If a slot is taken, move outward along the normal first, then along the entity.
Do not place a mark on top of a dimension line.

## 3. States

| State | Constraint mark | Dimension | Geometry |
| --- | --- | --- | --- |
| **quiet** (default) | `--ink-3`, 1 px, no fill | line `--ink-3`, label `--ink-2` | ink, unchanged |
| **hover** | the hovered mark **and all of its companions** go `--ink-2`, 1.4 px; a name tooltip appears | line 1.2 px, measured entities get a faint wash | the participants get a **0.35 marker wash** |
| **selected** | every mark of the constraint goes ink; its badge gets a **paper fill + ink text + a marker underline**; the selection popover opens | the label is replaced by the inline editor | highlighter wash at 0.55 |
| **conflict preview** | dashed ink + a small `!` badge | dashed preview dimension | **does not move** |
| **reference** | — | italic `--ink-3`, parentheses, no highlighter | unchanged |
| **fully constrained** | no per-constraint colour change | — | no wash; the foot says `0 DOF · fully constrained` |
| **filtered out** | still drawn, not pickable under a narrowing filter | still drawn, not pickable | unchanged |

A filter decides what a click can pick, **not** what is visible. Constraint
marks are pickable under `all`; a narrowing filter (`points`, `curves`,
`dimensions`) makes only that kind pickable. A future `constraints` filter is an
open question, not a v1 surface.

## 4. Constraint atlas

Every mark in this table is also the **hit target for its whole constraint**:
hovering any companion lights the set, clicking selects it, and
Backspace/Delete removes it (§7). The atlas is both the visual and the
interaction map.

The mark column is the **always-on** mark. The state columns describe what
changes on hover/selection.

| Constraint | Selection | Mark | Where | On a vertical / horizontal line | Notes |
| --- | --- | --- | --- | --- | --- |
| **Horizontal** | one line | `H` badge | line midpoint, **on** the line; its paper fill interrupts the line; slides along the line if a point/mark occupies the midpoint | upright; the line may be vertical in the sketch, the badge never rotates | single-participant badge: no outside offset; H cannot coexist with V on the same line |
| **Vertical** | one line | `V` badge | as above | upright | single-participant badge: no outside offset |
| **Parallel** | two lines | `∥` badge on each + a faint dashed tie on hover | 70 % along each line | badges stay upright; the tie follows the pair | do not use two full arrows; the tie is what says *which* lines |
| **Perpendicular** | two lines | right-angle square at the intersection; `⊥` badges + tie when they do not intersect | the intersection, or 70 % on each | the square rotates with the corner | one square, not two; the square sits in the angle that is inside the profile when known |
| **Collinear** | two lines | `≡` at the join + a dashed tie across the gap | the gap midpoint | the tie runs along the common line | a shared endpoint needs no tie; the `≡` alone. The solver's internal point-on-line is not a second mark. |
| **Equal** | two lines, or two circles | one tick per equal group, across each entity | 30 % on lines; top of circles | a tick is perpendicular to the line, radial on a circle | second equal group = two ticks; third = three; group order is document order |
| **Point on line** | point + line | hollow ring + a short normal tick | at the point | the tick turns with the line | an endpoint is already coincident; no duplicate ring |
| **Point on circle** | point + circle/arc | hollow ring + a radial tick | at the point | radial | applies to circles and arcs |
| **Tangent** | line + arc | hollow diamond at the contact + a short tangent tick | the contact point | the tick follows the tangent | line–arc only in v1; `T` badges are the fallback when the contact cannot be resolved |
| **Symmetric** | two points + axis, or two lines + axis | dashed connector + two inward chevrons + a centreline axis | between the pair, across the axis | **chevrons rotate with the axis** (see §5) | never a static `⇄` |
| **Midpoint** | point + line | a short tick across the line at the point + a half-filled dot | at the point | the tick is perpendicular to the line | the point itself is the evidence |
| **Coincident** | two points | a shared point is the mark; two distinct point ids get one filled dot + a thin ring | at the location | — | never mark every shared endpoint |
| **Fix** | one point | a padlock/pin | at the point | upright | the origin and axes use reference styling, not this pin |

### Not in v1

| Constraint | Why not now | Mark if it lands |
| --- | --- | --- |
| **Concentric** | not in `ConstraintType`; two equal-radius circles already give a weak version | concentric rings at the shared centre |
| **Tangent, arc–arc / circle–circle** | `slvs` tangency is only arc↔line sharing an endpoint | a diamond at the contact, same as line–arc |
| **Symmetric about a point** | the solver form is points/lines about a line | a connector through the centre point with a dot |
| **Fix a line/curve** | `fix` is a point constraint | pin at the midpoint, plus a “fixed” tag |
| **Equal arcs** | `equal` is offered for two lines or two circles, not arcs | the same radial tick |

These are deliberate gaps, not silence. If one is offered later, it uses the
same grammar rather than a new icon.

## 5. Symmetric, in any direction

This is the clearest case for orientation-aware marks, and the current static
`⇄` is wrong on a vertical axis.

**The mark is a connector plus two chevrons that point toward the axis.** The
connector is perpendicular to the axis, and the chevrons lie on the connector.
Therefore they rotate with the axis automatically:

```
      vertical axis                 horizontal axis
           |                            ———————
      >    |    <                     v
           |                            ———————
                                        ^
```

- **Vertical axis:** horizontal connector; left chevron points right (`>`), right
  chevron points left (`<`).
- **Horizontal axis:** vertical connector; upper chevron points down (`v`), lower
  chevron points up (`^`).
- **Diagonal axis:** connector along the perpendicular; both chevrons rotate to
  match it.
- **Two points:** the connector runs between the two points.
- **Two lines:** the connector runs between their midpoints. One connector per
  mirrored pair. If the two lines are collinear (two horizontal lines about a
  vertical axis, or two vertical lines about a horizontal axis), the connector is
  the gap between them, so the chevrons still show which way the mirror runs.

The four line cases, explicitly:

| Pair | Axis | Connector | Chevrons |
| --- | --- | --- | --- |
| two vertical lines | vertical | horizontal | left / right |
| two vertical lines | horizontal | vertical (collinear pair) | up / down |
| two horizontal lines | vertical | horizontal (collinear pair) | left / right |
| two horizontal lines | horizontal | vertical | up / down |
- **Three-line selection:** the document stores two point-pair `symmetric`
  constraints with the same `about`. Draw **one** symmetric relationship — one
  axis, one connector per line pair — not two sets of badges. The pair is two
  marks, not four.
- **The axis:** a dash-dot centreline, only while the constraint is hovered or
  selected. Do not permanently restyle an ordinary line as a centreline. If the
  axis is construction geometry it is already dashed; the active overlay is
  stronger.
- **Selection:** both participants and the axis get the highlighter; the chip
  says `symmetric`.
- **Never** use an `S`, `⇄`, or a horizontal double-arrow as the mark. The
  geometry already tells you which way the mirror runs.

## 6. Measurements

A dimension has three parts: **extension lines**, a **dimension line with a
value**, and a **label**. The value is always upright; the line can be at any
angle.

### The forms

| Dimension | Selection | Geometry | Label | Notes |
| --- | --- | --- | --- | --- |
| **Point to point** | two points | extension lines from both points; dimension line parallel to the pair, at `offset`; slash ticks at both ends | `56.2` above the line, centred at `along` | this is also a line length |
| **Aligned** | a diagonal line (or two diagonal points) | the dimension line is parallel to the measured segment | upright, above the line | the default for a diagonal; never project X/Y unless a future “horizontal/vertical distance” variant says so |
| **Point to line** | point + line | dimension line along the perpendicular from the point to its projection; extension lines; right-angle mark at the foot | `18.0` outside | the line itself is the witness |
| **Angle** | two lines | two extension lines from the vertex; an arc at `offset`; open arrowheads at both ends | `45.0°` outside the arc, upright | the smaller angle (0–180°) is measured |
| **Radius** | circle or arc | leader from the centre to the arc; an open arrow at the arc; a centre cross | `R 12.5` | arcs default to radius |
| **Diameter** | circle | a dimension line through the centre with arrows at both circumference points, or a leader when it does not fit | `Ø 25.0` | circles default to diameter |
| **Reference** | any of the above | same geometry | `(89.0)` in italic, `--ink-3` | only measures; not in DOF; not highlighter-coloured |

### The rules

- **Linear spans use slash ticks.** The paper/ink style is architectural, not
  arrow-heavy. Keep the 3.5 px slashes at both ends. **Angular and radial
  leaders use an open arrowhead** — the arrow says “this points at the thing it
  measures”. This is the one deliberate split.
- **Witness lines** start 1.5 px off the measured geometry and extend 3 px past
  the dimension line. They are 0.8 px, 55 % opacity. The dimension line is 1 px.
- **Labels are always upright.** A vertical dimension's label sits beside the
  line, never rotated. A diagonal's label sits above the line. The label has a
  paper halo so a crossing line does not cut through it.
- **Units live in the editor, not the label.** Lengths are millimetres; the
  stage foot already says mm. Angles carry `°`. Radius and diameter carry `R` /
  `Ø`. Reference values sit in parentheses.
- **The editor's unit must match the dimension.** An angle editor says `°`, not
  `mm`. This is a current gap (see §10).
- **Precision** follows `core/format.ts`: `formatLength` for readouts (whole mm
  or one decimal), `formatEditable` for fields (up to two decimals, trimmed).
  Angles use one decimal and `°`. Never store a formatted string and re-format it
  (the 56.2499 regression).
- **Default placement:** linear `offset` 12 mm, `along` 0.5; point-line 10 mm;
  angle arc radius 30 mm; radial leader 12 mm, angle 45°. These are document
  fields (`offset`, `along`, `angle`, `distance`), not view state.
- **Dragging the label** updates those fields. One gesture = one undo entry
  (`mergeKey` while dragging). Unrelated edits never reset the placement.
- **Editing:** double-click the label; the inline editor replaces the label at
  the same place. It holds the value, the unit and the `driving / reference`
  segmented control. Enter commits; Escape or an outside click cancels
  (`MODES.md` D4). There are no apply/cancel buttons.
- **Selection:** a single click selects the dimension (the selection popover
  shows the dimension chip); double-click edits; drag moves. Dimensions are the
  only constraint-like thing that is a selectable object.
- **Reference dimensions** are not a second class of geometry; they are the same
  drawing with the value as an observation. The editor shows a readout, not a
  field. They do not change the DOF.
- **Collision:** default offsets stagger parallel dimensions; labels are
  draggable. Automatic collision avoidance is out of scope for v1 (open).
- **Angle on parallel lines:** the tool can measure 0°; decide whether to
  suppress the angle chip or show `0.0°`. Open.
- **Angle flip:** the smaller angle is drawn. Dragging the label across the
  vertex does not currently choose the supplementary angle. Open.
- **Diameter fit:** a through-line is the primary form; a leader is the fallback
  when the circle is too small for the value. Open whether to always use the
  leader for consistency with the current app.

## 7. Interaction

### 7.1 Hover, select, delete

- **Hover a mark.** The hovered mark and **every companion mark with the same
  constraint id** go `--ink-2`; the participants get a **0.35 marker wash**; a
  tooltip names the constraint. A multi-entity constraint is one object, not two
  independent icons: hovering either parallel badge lights both marks and both
  lines; hovering the symmetric connector lights both chevrons, the axis and the
  pair.
- **Click any mark to select the whole constraint.** All of its marks and
  participants stay highlighted at selection strength (0.55 wash). The marks
  themselves go **ink on paper** — a badge gets a paper fill, ink text and a
  marker underline — so they never disappear into the same highlighter wash as
  the selected line. The selection popover opens with the constraint name, its
  participants and a quiet `delete` in the footer. A companion mark is an
  equally valid handle.
- **Backspace/Delete removes the selected constraint** in one undo entry.
  Escape clears the selection; a background click clears it; selecting geometry
  or another constraint replaces it. A text field owns Backspace while it has
  focus (`MODES.md` R7).
- **One constraint at a time** in v1. Shift-click does not add constraints to a
  multi-selection; the applied chip row is for geometry selection.
- **The applied chip remains a fast path.** Clicking a chip in the geometry
  selection popover removes that constraint immediately. The mark is the
  visible handle; the chip is the shortcut.
- **Dimensions behave the same through their label.** Hovering a dimension
  highlights the measured entities; clicking selects it; its inline editor is
  the edit path and `delete` removes it.
- **Tooltip.** A small paper-coloured label with a hairline border near the
  hovered mark: the constraint name, plus the participant count when more than
  one (`parallel · 2 lines`, `symmetric · 2 points about line 07`). It has
  `pointer-events: none`, flips to stay inside the stage, and uses the same font
  token as the dimension labels. Delay ~120 ms so dragging across the sketch does
  not flash it. On touch there is no hover: a tap selects and the popover supplies
  the name.
- **Hit target.** A 14 px target around the mark (its label box for a badge, a
  7 px radius for a glyph), above the geometry (24 px on coarse pointers is
  still to do). A click on a mark selects the constraint, not the line under it. A
  midpoint badge sits off the line, so the line itself stays selectable under
  it; a tick that sits on a line is the one place where the mark wins. Marks are
  handles only while the select tool is active; a drawing, dimension or trim
  tool owns the pointer so a mark cannot swallow its click.
- **Keyboard/a11y.** Marks are not in the tab order in v1 (too many, too close
  together); the applied chips and the selection popover are the accessible
  path. Open question Q19.

### 7.2 Overlap, clusters, drag

The priority order is **geometry < dimension lines < constraint marks <
dimension labels < selection popover**. A mark is never hidden by a sketch line,
a region or a dimension line; it carries a paper halo so it stays legible when it
crosses one. A dimension label is above the marks, so the auto-positioner avoids
labels and the drag is the fallback if it cannot.

1. **Auto-position first.** Give every mark a slot on its entity (§2). If a
   slot is taken, push outward along the normal. If the entity is too short or
   every slot is full, **cluster**.
2. **Cluster.** The conflicting marks collapse into one small dot with a count
   at the entity. It is not a constraint itself; it is a handle for the group.
   Hover expands a transient **fan** of the marks around the entity with thin
   leaders; leaving collapses it. Click opens the **constraint list** (names).
   Hovering a row previews that constraint's companions and participants;
   clicking a row selects it. The fan/list are ephemeral, never document state.
3. **Overlapping hit targets.** If two marks still overlap, clicking opens a
   small **constraint chooser** at the cursor, the same pattern as Select Other
   on the model: the names of the constraints under the cursor. Hovering a row
   previews the companions and geometry; clicking selects. Escape closes the
   chooser before it clears the selection.
4. **Drag is the escape hatch.** After auto-position and clustering, a mark can
   be dragged: a 3 px movement starts the drag, a click still selects. All marks
   of one constraint move together and keep their relative layout. A pinned mark
   shows a thin dotted leader to its participant(s) so the association does not
   disappear. The auto-positioner leaves pinned marks alone and flows the other
   marks around them. The selection popover offers a quiet `reset position`.
5. **Persistence.** In this study the drag offset is UI-only. If we keep it, it
   is document state like a dimension label's `offset`/`along`: store a
   sketch-plane millimetre offset on the constraint (schema bump), not screen
   pixels, so zooming keeps it attached. Open question Q24.
6. **Determinism.** Auto-placement is stable for the same sketch and the same
   pinned set; it does not reshuffle on every render. No wall clock, no random
   slot selection.

### 7.3 Other rules

- **Select entities:** the selection popover lists the applied constraints as
  active chips. Clicking a chip removes that constraint in one action. This is
  the ordinary way to release an H/V or parallel when you already have the
  geometry selected.
- **Conflict preview:** a checked chip is shown but not written; the mark is a
  dashed ghost + `!`; the geometry does **not** move. Clicking the chip releases
  the conflict; changing selection or tool discards the preview. Never silently
  drop a constraint.
- **DOF** is a foot readout, not a colour scheme. Constraints and driving
  dimensions count; reference dimensions do not. Fully constrained is `0 DOF ·
  fully constrained`; under-constrained is the count.
- **Visibility:** marks are always on, names on hover/selection; a future
  footer toggle (M9) may hide constraints/dimensions for a clean view. There is
  no per-constraint hide.
- **Undo:** one applied constraint = one entry; one dimension placement = one;
  one label drag = one merged entry; one chip removal or Backspace delete = one
  entry; one mark drag = one merged entry.
- **New constraint creation** is the selection popover: select the entities, pick
  a chip. There is no separate constraint bar. The chip is immediate; a
  constraint that would make the sketch inconsistent becomes the checked preview.
- **Automatic constraints use the same marks.** A line drawn with the H/V
  auto-constraint, a snapped point that gets a point-on-line, and a coincident
  endpoint are not a second visual class. The only difference is how they were
  created.
- **Reference geometry is still normal geometry to a constraint.** A coincident
  to the origin, a point-on-line to the X axis, or a dimension to a projected
  edge uses the same mark; the dashed/tagged style belongs to the reference
  geometry, not to the mark.
- **Deleting geometry removes its marks.** Cascade-pruning a curve or point also
  drops its constraints and dimensions; no orphan mark may point at nothing.
- **Dimensions are contextual:** selecting a line/circle/arc or a point pair
  exposes `dimension` (and `radius` for a circle/arc). The dimension tool then
  places the ghost and captures the current value.

## 8. Decisions

The visual grammar (C1–C5, C7–C14) is proposed. The interaction in C6 and
C15–C20 reflects the request of 2026-11-08: hover links companions and
participants, click selects, Backspace/Delete removes, and overlap is handled by
auto-position, clusters, a chooser, then drag. The exact intensities and delays
are still proposed.

| # | Decision | Why |
| --- | --- | --- |
| C1 | Geometry first; constraint marks `--ink-3`, dimensions `--ink-2`, highlighter only for current/selected. | The sketch stays readable as a drawing. |
| C2 | Hybrid grammar: geometric glyphs where they are self-evident, letter badges where they are not. | `H` is clearer than a horizontal stroke; a tick is clearer than `=`. |
| C3 | Symmetric is a connector + inward chevrons that rotate with the axis. | A static `⇄` lies on a vertical axis. |
| C4 | Equal uses one tick per group; groups are the connected components of equal constraints, ordered by first appearance. | Drafting convention; chains of equal links share a tick count. |
| C5 | A shared point is the coincident mark; only two distinct point ids get a dot/ring. | Avoids marking every endpoint. |
| C6 | Constraint marks are **selectable** objects: hover links the companions and participants, click selects, Backspace/Delete removes. The applied chip remains a fast remove shortcut. | The mark is the visible handle; one object, two paths. |
| C7 | Linear dimensions use slash ticks; angular/radial leaders use open arrowheads. | Paper/ink look plus a clear “measures this” arrow. |
| C8 | Labels are always upright; units live in the editor. | Readability over drafting rotation. |
| C9 | Reference dimensions are parentheses + italic, not a colour. | One highlighter meaning; reference is still readable in a screenshot. |
| C10 | Conflict is a dashed ghost + `!` + a checked chip; the geometry never moves. | No silent fallback. |
| C11 | DOF is a foot readout only. | No false “green = good” colour coding. |
| C12 | Visibility toggles are deferred to M9. | They are a separate surface, not a per-constraint control. |
| C13 | Automatic constraints use the same marks as manually applied ones. | There is one visual language, not an auto/manual split. |
| C14 | Deleting geometry removes its marks. | Cascade-pruning is the source of truth; no orphan annotations. |
| C15 | Hover lights the whole constraint at a 0.35 participant wash; selection at 0.55. The marks themselves stay ink; one highlighter, two intensities on the geometry. | The relation is visible before you commit to it; selection persists without swallowing the annotation. |
| C16 | A hovered mark names itself in a small paper tooltip (name + participant count). | The icon is learnable without a legend; touch uses the popover. |
| C17 | Collision order: auto slots → cluster/fan → constraint chooser → drag. | Auto-position is the default; drag is the escape hatch, not the first answer. |
| C18 | Dragging a mark pins it; all marks of one constraint move together. A pinned mark keeps a dotted leader and can be reset. | Association survives the move; the user is never stuck with a bad auto-position. |
| C19 | Mark hit targets are 14 px (24 px coarse) and sit above geometry; overlapping targets open a chooser, not a lottery. | Small icons should still be predictable to click. |
| C20 | Constraint selection is ephemeral and single: one constraint at a time, mutually exclusive with geometry/dimension selection. | Matches the existing “selection is not document state” rule. |
| C21 | A single-participant badge (H/V) sits **on** its line at the midpoint, sliding along the line if a point or another mark is there; multi-participant badges sit outside. | One mark does not need another offset; the paper fill interrupts the line cleanly and keeps the sketch quiet. |
| C22 | Selection is a **wash under** the geometry plus a marker underline on badges; it never becomes the mark's stroke or badge fill. Selected marks stay ink on paper. | A green/blue/pink mark on a same-colour transparent wash is unreadable. The annotation must survive the selection of the line it annotates. |

## 9. Open questions

| # | Question | Current proposal | Status |
| --- | --- | --- | --- |
| Q1 | Are marks always visible, or only on hover/selection? | Glyphs always; names on hover/selection; LOD clusters when dense. | Proposed |
| Q2 | Can a glyph be clicked to remove its constraint? | **Yes, click selects the whole constraint; Backspace/Delete removes it.** The applied chip stays as a fast remove shortcut. | **Accepted** 2026-11-08 |
| Q3 | How are equal groups numbered when one is deleted? | Renumber the connected components by first appearance; accept that the ticks may change. | Open |
| Q4 | How is the three-line symmetric action drawn? | One axis + one connector per line pair, merging the two stored point-pair constraints. | Proposed |
| Q5 | Which angle is measured, and can the label flip to the supplement? | Smaller angle (0–180°); no flip in v1. | Open |
| Q6 | Is an angle dimension on parallel lines offered? | Suppress the angle chip at 0°/180°; show a status if attempted. | Open |
| Q7 | Should a vertical dimension's label rotate? | No; upright beside the line. | Proposed |
| Q8 | Circle vs arc default: diameter or radius? | Circle → diameter, arc → radius; both chips available. | Proposed |
| Q9 | Diameter through-line or leader? | Through-line when it fits; leader when it does not. | Open |
| Q10 | Are constraints shown on construction geometry? | Same marks, quietly; construction is already dashed. | Proposed |
| Q11 | Are constraints shown on projected/reference geometry? | Yes, but a constraint that cannot move the reference is still a normal mark. | Open |
| Q12 | Do filters hide or merely gate picks? | Gate picks only. | Proposed |
| Q13 | Do we add concentric / arc–arc tangent / symmetric about a point / fix a line? | Not in v1; add with the same grammar when the solver supports them. | Deferred |
| Q14 | Do dimension labels avoid collisions automatically? | No; draggable with staggered defaults. | Deferred |
| Q15 | Should the reference dimension readout use parentheses or a `REF` tag? | Parentheses + italic. | Proposed |
| Q16 | What is the angle editor unit? | `°` via `editor.unit`; implemented — verify the angle path. | **Done** |
| Q17 | Can the constraint name badge show the full name on hover? | Yes: `parallel`, `symmetric`, etc.; the symbol stays on the mark. | **Done** (2026-11-08) |
| Q18 | Do constraints and dimensions appear in the timeline detail? | No; the sketch step lists sketch objects, not every constraint. | Proposed |
| Q19 | Should a constraint mark be focusable / announced by a screen reader? | No individual focus; the applied chips in the selection popover are the accessible path. | Proposed |
| Q20 | What is the touch path when there is no hover? | Tap the mark to select; the selection popover supplies the name. No tooltip. | Proposed |
| Q21 | Does the applied-chip row need grouping or ordering? | Document order, no grouping, until a real sketch proves it is too long. | Open |
| Q22 | What happens after three equal groups? | Use a numeric badge next to the tick (or a small `=`); do not keep adding ticks forever. | Open |
| Q23 | Does a dragged mark's offset persist? | UI-only in this study. If kept, store a sketch-plane mm offset on the constraint (document state, schema bump), not screen pixels. | Open |
| Q24 | Cluster list or cursor chooser? | Both: a cluster opens its list; two overlapping free marks open a chooser at the cursor. | Proposed |
| Q25 | Does clicking an applied chip select or remove? | Remove immediately; the mark is the selectable handle. | Proposed |
| Q26 | Can several constraints be selected at once? | No in v1; one constraint at a time, like a dimension. | Proposed |
| Q27 | How long is the tooltip delay, and does it show for a selected constraint? | ~120 ms on hover; selection shows the popover, not a tooltip. | **Done** (2026-11-08) |
| Q28 | How is a pinned mark reset? | A quiet `reset position` in the constraint's selection popover (not double-click, which already means edit/rename elsewhere). | Proposed |

### Change log

| Date | Decision | Change |
| --- | --- | --- |
| 2026-11-08 | C6, Q2 | Mark changed from read-only annotation to the constraint's handle: hover/click/delete. The applied chip remains an alternate removal path. |

## 10. Current implementation and gap

Implemented (2026-11-08):

- `src/sketch/constraintMarks.ts` is the pure, derived mark layer. It takes the
  sketch, the solved points, the selection/hover ids and the screen scale, and
  returns marks; nothing is document state.
- Equal groups use connected components of equal constraints, numbered by first
  appearance; lines get perpendicular ticks, circles/arcs get radial ones.
- Point-on-line and point-on-circle get a hollow ring plus a normal/radial tick;
  an endpoint is left to the coincident mark.
- Symmetric is a connector with inward chevrons that rotate with the axis, plus
  a dash-dot active axis. Three-line symmetry merges its axis.
- Coincident is a filled dot + thin ring; midpoint is a normal tick + half dot;
  fix is a pin.
- Perpendicular draws the right-angle square when the segments meet and the
  badge pair + tie when they do not. Collinear draws the `≡` at the join/gap and
  a tie across a gap. Tangent draws the contact diamond + tangent tick, with `T`
  badges as the fallback.
- H/V/∥/⊥/≡ stay badges; equal/point/tangent/symmetric glyphs replace the old
  letters. H/V are single-participant badges and sit on the line at its
  midpoint, their paper fill interrupting it; multi-participant badges stay
  outside. Marks are screen-space and derived, never document state; they use
  quiet / hover / selected colours from the participant ids.
- The angle inline editor now shows `°`; linear slash ticks, the radial leader
  and reference parentheses were already in place.
- Marks are handles: hover links the constraint's marks and participant
  geometry and shows the name tooltip; click selects the constraint (ephemeral
  state) and opens its selection popover; Backspace/Delete removes it. The
  applied chip remains an alternate removal path.
- Selected marks stay ink on paper (C22): the active mark stroke and badge text
  are ink, the badge keeps its paper fill, and a marker underline sits under it.
  The highlighter is the participant geometry wash, never the mark's ink.

Remaining:
- **Phase 2a — finder chrome**: the conflict ghost + `!` for the checked
  preview. `pendingConstraint` is not yet passed into the canvas, so the conflict
  preview is still a chip only. The tooltip (name + participant count, ~120 ms
  delay) and the constraint selection popover (name, participants, `delete`) are
  implemented; `reset position` waits for pinned marks.
- **Phase 2b — collisions**: stacking slots/LOD clusters, the hover fan, the
  cursor chooser for overlapping hit targets, the pinned drag with a dotted
  leader, and the label-priority rule. None of these exist yet; current marks
  are automatically placed with no cluster or user offset. Dimension lines and
  labels render in separate layers, and the mark layer sits between them, so a
  mark is above the thin lines and below the value labels (rule 7).
  H/V sit on the line midpoint (C21); sliding them when a point or another mark
  occupies that midpoint is the remaining collision rule.
- **Phase 3 — measurements**: open arrowheads on angle/radius/diameter leaders,
  the through-line/leader choice for diameter, witness-line gaps, label collision
  defaults, and the 0° angle behaviour.
- Q3, Q5, Q6, Q9, Q14, Q21, Q22 and Q23–Q28 remain open; Q16 is fixed.
- Kernel/OCCT is not involved. Unit tests cover the pure mark geometry; e2e
  covers the applied chips and the angle editor unit.
