# Tool showcase

Interactive design targets for tools that do not exist yet, split into eight pages.

This folder and [`../mockups/`](../mockups/) are the two halves of one design
system:

- the **[studies](../mockups/index.html)** fix the surfaces — timeline, sketch,
  model, support, export, errors, files, body;
- the **showcase** (here) makes the interactions work — pattern, mirror, offset,
  move/copy, combine, split, transforms, extrude, inspect, and the sketch
  selection inputs.

The [study index](../mockups/index.html) lists both, and the shared interaction
rules are in [`INTERACTION.md`](INTERACTION.md). The timeline surface — steps,
bodies, groups and insertion — has its own contract in
[`TIMELINE.md`](TIMELINE.md).

| Study | Page | What it covers | Milestone |
| --- | --- | --- | --- |
| **Sketch layout** | [`index.html`](index.html) | rectangular / circular pattern, mirror, offset, **move/copy** | **M6.0** (ADR-0004) |
| **Sketch selection** | [`sketch-edit.html`](sketch-edit.html) | selection popover (constraints), inline dimension editor | app consistency (see INTERACTION.md) |
| **Sketch create** | [`sketch-create.html`](sketch-create.html) | rectangle / circle / arc variants, polygon | M6.0-era sketch polish |
| **Body ops** | [`body-ops.html`](body-ops.html) | **combine** (join/cut/intersect, keep tools), **split body** | M6 |
| **Bodies** | [`bodies.html`](bodies.html) | several bodies in one timeline, inline with the step that made them | M3/M6 (document model) |
| **Body transforms** | [`transform.html`](transform.html) | **move / copy**, **align** | M6 |
| **Extrude options** | [`extrude.html`](extrude.html) | start offset, to-object / to-next / all, taper, operation | **M3/M4** |
| **Inspect** | [`inspect.html`](inspect.html) | **section analysis** | M5 |

The decisions behind these (what to keep, drop, defer) are in
[`BACKLOG.md`](BACKLOG.md).

Open the pages directly in a browser. No build step, no server, no dependencies.
They share the paper/ink system in [`../mockups/`](../mockups/) (`mockup.css`,
`mockups.js`, `theme-init.js`); the two folders cross-link and evolve together,
and neither is imported by `src/`.

## What the sketch-layout study explores

The tools share one interaction problem: **the tool needs a configuration before
it can create anything, and the sketch is the only place that configuration can
be judged.** So each tool opens a small popup that lives next to the geometry it
will change, and every control edits a live preview on the canvas.

The preview grammar is the point of the study:

- **The selection stays the original.** Selected geometry is ink, with the
  highlighter wash behind it — the most prominent thing on the page.
- **What the tool will add is a preview, not a result.** New geometry is drawn
  dashed and lighter (`--ink-3` at ~70%), so it reads as a proposal you can still
  change. It is never highlighter-coloured: the highlighter means "current or
  selected", and a preview is neither yet.
- **The parameters live on the geometry.** Direction arrows, instance ticks, a
  sweep arc, a mirror line, a move arrow and an offset arrow are drawn on the
  canvas and are draggable, so the common edit does not need the popup at all.
- **The popup is context-sensitive.** It only exists while a tool is active,
  only shows the rows that apply (direction 2 appears when it is switched on),
  and disappears in `select` mode.

The same grammar carries into the body operations: a target body, a tool body,
an operation, and a live result — solids instead of curves.

## Objects, not one-shot edits

A pattern, mirror or offset is **not** a one-shot transform. `apply` keeps it as
a persistent **object** in the sketch — a named operation with its own
parameters, the way a constraint persists. That object is what makes the
operation re-editable later.

- **A badge marks the object.** A small glyph and name sit on the geometry it
  governs. Click it (or any of the geometry) to select the whole object; the
  highlighter washes the source and every piece it generated.
- **The selection line is the edit handle.** Selecting an object shows its name,
  parameters and **edit** / **delete** in the same selection line the app already
  uses for dimensions and constraints.
- **Edit reopens the tool.** Editing loads the object's own parameters back into
  the popup, previews the change with the same grammar, and updates the object on
  apply. Delete removes everything it made.
- **The timeline is the permanent home.** While the sketch step is active, its
  detail line lists the sketch's objects by name, so they are discoverable even
  with nothing selected.

The recommendation this study makes: keep these as **sketch objects** (siblings
of constraints), not as separate history steps. The sketch step owns them and
the timeline detail lists them. If M6.0 decides they are history steps instead,
the same badge + selection-line + edit flow still applies — only the home
changes.

## How to use it

- The **tool line** at the top of the sketch switches tools. Each tool brings
  its own scene and a sensible starting selection.
- **Click geometry** to add or remove it from the selection; the preview and the
  summary update immediately.
- **Drag the on-canvas handles** (the dot on a direction arrow, the sweep handle,
  the offset arrow) to change spacing, angle or distance.
- **The popup** holds counts, axes, modes and corner style. **apply** commits the
  preview into a persistent object; **cancel** discards it.
- **Click an object's badge or its geometry** to select it, then use **edit** or
  **delete** in the selection line.
- Day/night and the four highlighters work as in the other studies, and persist
  in `localStorage` under the same keys.

## Design decisions

1. **Preview, not placement.** Pattern/mirror/offset are parametric and
   re-editable, so the mockup never draws a half-finished shape. It draws the
   whole proposal and lets you change the numbers.
2. **Selection first, then tool.** Selecting geometry and then invoking the tool
   is the Fusion order, and it makes "what will this operate on?" explicit. The
   tool can still be invoked with nothing selected, and then it prompts.
3. **Two preview weights.** The original selection and the proposed copies must
   never be confused. Ink + wash vs dashed + faint is the smallest encoding that
   survives both themes and all four highlighters.
4. **The parameters are on the geometry.** A popup alone would hide the effect of
   a change; a manipulator alone would hide the option. The study uses both.
5. **No new type or colour.** The popup uses the existing eight roles and the
   existing highlighter. A preview introduces no fifth state colour.
6. **The object owns the operation, not the copies.** Applying stores the
   parameters and the source selection; the instances are re-derived from them on
   every render. Re-editing changes the parameters, not the geometry, so the
   operation stays the single source of truth.
7. **Two homes, one fact each.** The badge is the canvas handle, the selection
   line is the edit handle, and the timeline detail is the permanent list. Each
   fact (name, parameters, actions) has exactly one home.

## Open questions

- Are these **sketch objects** (shown here) or **history steps**? This study
  recommends sketch objects owned by the sketch step; M6.0 should decide.
- Should editing the source geometry re-run the object automatically, and how is
  a stale or lost reference surfaced?
- Circular pattern axis: is it always a sketch point (axis normal to the plane),
  or can it be a projected edge / axis? The study only offers a point today.
- Offset corner style (miter/round) and "flip side" are shown; a full offset also
  needs open-chain vs closed-loop and self-intersection handling.
- Should the popup be draggable and remember its position, like Fusion's?
- What is the keyboard story? Fusion uses `R`/`P`/`M`/`O`; the app already gives
  `P` to the point tool, so the shortcuts in the tool line are placeholders.
- When a pattern/mirror lands as a **feature** (M6) rather than a sketch edit,
  the same popup grammar should still apply to solids and faces.

## Files

```
index.html           sketch layout: pattern / mirror / offset / move-copy
sketch-edit.html     sketch selection: constraint popover + inline dimension editor
sketch-create.html   sketch create variants: rectangle / circle / arc / polygon
body-ops.html        combine + split body
bodies.html          multiple bodies inline in one timeline
transform.html       move / copy + align
extrude.html         extrude options (start, end, taper, operation)
inspect.html         section analysis
showcase.css         popup, preview, manipulator and 3D styles (mockup tokens)
showcase-ui.js       shared draggable popovers + the footer action grammar
showcase.js          sketch model, preview geometry and interaction
showcase-create.js   the create-tool atlas
showcase-edit.js     the selection popover + inline editor
showcase-3d.js       isometric helpers + body ops + transforms + extrude + section
INTERACTION.md       the interaction contract (popover, actions, foot)
TIMELINE.md          the timeline contract (steps, bodies, groups, insert)
BACKLOG.md           the gap decisions (keep / drop / defer) and their homes
README.md            this file
```

The typography contract in [`../mockups/TYPOGRAPHY.md`](../mockups/TYPOGRAPHY.md)
still applies; this folder follows it but is not yet part of
`check-typography.mjs`.
