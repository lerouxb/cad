# UI studies

Static design targets for the CAD app, exploring a **typography-first, paper-and-ink**
interface for the sketch → model → STL workflow.

Open [`index.html`](index.html) directly in a browser. No build step, no server, no
dependencies. The shared files are plain HTML/CSS/JS and are **not imported by
`src/`**; they exist to make design decisions visible before implementation.

These are one half of the design system. The other half is
[`../showcase/`](../showcase/): interactive pages for tools and input surfaces,
including ones not built yet (pattern, mirror, offset, move/copy, combine,
split, transforms, extrude, inspect, and the sketch selection inputs). The
[study index](index.html) lists both, and the rules the two folders share are in
[`../showcase/INTERACTION.md`](../showcase/INTERACTION.md). The sketch
constraint and measurement marks are in
[`../showcase/CONSTRAINTS.md`](../showcase/CONSTRAINTS.md); selection families
and feature actions are in
[`../showcase/SELECTION.md`](../showcase/SELECTION.md), the offset-face
study in [`../showcase/OFFSET_FACES.md`](../showcase/OFFSET_FACES.md), the
revolve study in [`../showcase/REVOLVE.md`](../showcase/REVOLVE.md), the
boolean operation contract in
[`../showcase/BOOLEANS.md`](../showcase/BOOLEANS.md), and the form input
pickers in [`../showcase/PICKS.md`](../showcase/PICKS.md).

## The eight studies

| # | Study | What it tests |
| --- | --- | --- |
| 01 | [History is the workspace](01-history.html) | The timeline as the primary surface; named steps, rollback with paused downstream steps. |
| 02 | [Sketch on paper](02-sketch.html) | Constrained geometry, projected references, inline dimension editing, contextual tools, and a scale-aware snap grid. |
| 03 | [The solid, quietly](03-model.html) | A technical drawing as the model view; feature parameters in the timeline detail. |
| 04 | [Start from a face](04-support.html) | A single support picker for world planes, planar faces, and datum planes. |
| 05 | [Export for the printer](05-export.html) | STL as a first-class end of the loop: watertight, units, build volume. |
| 06 | [When a reference dies](06-errors.html) | Visible failure, a last-good body, and recovery in plain language. |
| 07 | [Files stay local](07-files.html) | The filename as the file menu: download .cad, copy, rename, and local file navigation. |
| 08 | [Bodies have looks](08-body.html) | Body appearance attached to the body-creating feature, with material and finish. |

## The visual rules

1. **Typography carries the interface.** Feature names, dimensions, and states are
   set as type. Thin rules instead of cards; boxes only where a decision needs a
   boundary.
2. **One highlighter, used for state.** Pick one of the four classic
   Staedtler highlighter colours — yellow, pink, blue, or green. The chosen
   colour means current, selected, or changed. It is never decoration.
   Everything else is ink on paper, or paper on ink at night.
3. **Day and night are the same system.** Day is a clean, near-white sheet with
   ink; night is ink with paper. Every study works in both.
4. **The timeline is the only permanent structure.** No sidebar, ribbon, or mode
   switcher. Selecting a step changes the stage; editing a step is the same
   gesture. Every step has an editable name, because names are the handle you
   use when repairing a complicated history.
5. **Controls appear where the decision is.** Tools only in sketch mode, a
   dimension editor at the dimension, support choices only when starting a
   sketch. Export is a page because it is the end of the job.
6. **Input is a draggable popover; the stage foot is a readout.** A form lives in
   a popover anchored to the thing it changes: a title, its parameters, and a
   footer holding a summary and the actions. Every popover is draggable, and
   editing reuses the same popover that created the thing. Selecting anything
   opens a popover. The stage foot carries state and view controls only, never a
   form. The shared rules are in
   [`../showcase/INTERACTION.md`](../showcase/INTERACTION.md).
7. **The background is a tool.** The sketch grid is the snap grid. Its spacing
   is set from the footer control, and the scale bar shows one cell at the
   current zoom. Snap can be switched off while the grid stays as a reference.
   No wallpaper texture.
8. **One home for every fact.** Document identity lives in the header. History,
   names, and feature parameters live in the timeline. Solver or body health
   lives in one stage status line. Tools, selection, and view live in the stage
   corners. Nothing repeats.
9. **Separate the study from the app.** The thin top bar is mockup navigation
   and design notes. Appearance is a quick-access app setting in the app header;
   a future full settings surface can hold the rest.
10. **Typography is a contract.** Three families, eight app roles, one separate
    editorial layer for this index. No raw type values outside the token block;
    run the audit before calling a change done.

## Using the studies

- The **top bar is mockup chrome**: study navigation and design notes only. It is
  not part of the app.
- **Appearance is app chrome.** In a study, use the **day / night** swatches and
  the four highlighter dots at the right edge of the app header. On the index,
  the same controls sit above the live preview under a **preview** label.
- The theme and highlighter choices are stored in `localStorage` and passed to
  the index preview.
- The highlighter is one of yellow, pink, blue, or green. Names are tooltips and
  accessible labels; the dots are the compact switcher.
- Use **notes** on any page for the reasoning, what the screen tests, and open
  questions.
- The **index** has a live preview of the sketch study and a typographic table of
  contents for the rest.
- The model in each study is generated by the shared `mockups.js` isometric
  renderer. The timeline steps are generated by the same file so the labels and
  status treatments stay consistent.
- The sketch footer has a real **zoom control**: `100%` opens `50% / 100% / 200% /
  fit`, and the grid and scale bar follow the zoom. All controls are focusable;
  focus is visible, menus close on Escape, and coarse-pointer targets are
  enlarged.

## Open questions

- Is a flat timeline enough, or do sketches need to nest under the features they
  drive?
- Should day be the default, or is night mode better for long sessions?
- How much of the feature inspector belongs in the timeline detail, versus
  inline on the model?
- Do projected reference edges need a show/hide control, or is the dashed fixed
  style enough?
- Should export freeze a mesh into history, or always derive from the current
  rebuild state?
- Is a print-orientation preview in scope, or is “fits the build volume” enough
  for v1?
- How do multiple bodies, moving parts, and assemblies enter this timeline later
  without turning it into a tree?
- How should pan, zoom, and constraint dragging work on touch and tablet, and
  what is the keyboard equivalent for each view control?
- Should file actions live only behind the filename, or does `.cad` download
  deserve its own quiet action?
- Should body appearance be editable only from the body-creating step, or from
  any step once the body exists?
- Do material and finish belong in the document, or are they presentation-only?

## Scope note

These studies deliberately solve the sketch → single-body model → STL loop. They
do not design assemblies, moving parts, or multi-body editing. The timeline and
naming should leave room for those later, but they are not part of this pass.
The document is also **offline and local-only**: no accounts, sharing, or cloud
sync. Files are downloaded as `.cad` and browsed on this device.

## Typography

See [TYPOGRAPHY.md](TYPOGRAPHY.md) for the families, the eight app roles, the
editorial layer, and the rules. Run the audit from the repo root:

```bash
node docs/mockups/check-typography.mjs
```

## Files

```
index.html          the design document / gallery
01-history.html     timeline + rollback
02-sketch.html      sketch mode
03-model.html       model mode
04-support.html     sketch support picker
05-export.html      STL export
06-errors.html      lost reference / paused rebuild
07-files.html       local file menu + file browser
08-body.html        body material + finish
typography.html     visual specimen for every app role
TYPOGRAPHY.md       the type contract and role table
check-typography.mjs  audit raw type values outside the token block
mockup.css          the whole visual system, both themes and all four highlighters
mockups.js          bracket, datum planes, timeline strip, theme + highlight switches
theme-init.js       restore theme and highlighter before first paint
```

These are design targets. The implementation lives in `src/`; the mockups do not
import it and should not be wired into it.
