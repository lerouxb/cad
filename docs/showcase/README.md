# Sketch tool showcase

Interactive design targets for four sketch-editor tools that do not exist yet:

| Tool | Study | Milestone |
| --- | --- | --- |
| Rectangular pattern | [`index.html?tool=rect`](index.html?tool=rect) | M6 (feature patterns) / sketch-level here |
| Circular pattern | [`index.html?tool=circular`](index.html?tool=circular) | M6 |
| Mirror | [`index.html?tool=mirror`](index.html?tool=mirror) | M6 — **high priority** |
| Offset | [`index.html?tool=offset`](index.html?tool=offset) | M9 today; promote with an ADR |

Open [`index.html`](index.html) directly in a browser. No build step, no server, no
dependencies. It reuses the shared paper/ink system from
[`../mockups/`](../mockups/) (`mockup.css`, `mockups.js`, `theme-init.js`) but does
not modify it, and it is never imported by `src/`.

## What this explores

The four tools share one interaction problem: **the tool needs a configuration
before it can create anything, and the sketch is the only place that
configuration can be judged.** So each tool opens a small popup that lives next
to the geometry it will change, and every control edits a live preview on the
canvas.

The preview grammar is the point of the study:

- **The selection stays the original.** Selected geometry is ink, with the
  highlighter wash behind it — the most prominent thing on the page.
- **What the tool will add is a preview, not a result.** New geometry is drawn
  dashed and lighter (`--ink-3` at ~70%), so it reads as a proposal you can still
  change. It is never highlighter-coloured: the highlighter means "current or
  selected", and a preview is neither yet.
- **The parameters live on the geometry.** Direction arrows, instance ticks, a
  sweep arc, a mirror line and an offset arrow are drawn on the canvas and are
  draggable, so the common edit (spacing, distance, angle) does not need the
  popup at all.
- **The popup is context-sensitive.** It only exists while a tool is active,
  only shows the rows that apply (direction 2 appears when it is switched on),
  and disappears in `select` mode.

## How to use it

- The **tool line** at the top of the sketch switches tools. Each tool brings
  its own scene and a sensible starting selection.
- **Click geometry** to add or remove it from the selection; the preview and the
  summary update immediately.
- **Drag the on-canvas handles** (the dot on a direction arrow, the sweep handle,
  the offset arrow) to change spacing, angle or distance.
- **The popup** holds counts, axes, modes and corner style, plus an apply/cancel
  pair that mirrors Fusion's OK/Cancel.
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

## Open questions

- Should a pattern preview be **parametric** (rebuilt from the selection on every
  edit, as shown) or **materialised** into real geometry when applied? The
  document model decides this.
- Does a pattern produce one history step with N instances, or N steps? The
  timeline mockup assumes one step per tool invocation.
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
index.html      the interactive showcase (all four tools)
showcase.css    the popup, preview and manipulator styles (tokens from mockups)
showcase.js     the sketch model, preview geometry and interaction
README.md       this file
```

The typography contract in [`../mockups/TYPOGRAPHY.md`](../mockups/TYPOGRAPHY.md)
still applies; this folder follows it but is not yet part of
`check-typography.mjs`.
