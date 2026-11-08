# Boolean operations

> Status: **active contract**, 2026-11-08 (implemented for extrude/revolve). The visual companion is the “One boolean language” section of
> [`booleans.html`](booleans.html). This is the source of truth for the operation
> row on extrude, revolve and future features, and for the cut/intersect preview
> language. It complements [`OFFSET_FACES.md`](OFFSET_FACES.md) (the
> signed-distance modification) and [`TIMELINE.md`](TIMELINE.md) (the step output
> chip).

## The one line

**Every feature that adds or removes material offers the same four operations,
in the same order, with the same words. The added material is highlighter (join,
offset `out`), the material a cut removes is red, an intersect ghosts what it
discards, and the result body stays normal. New body keeps its result-body
preview because the whole body is new.**

## 1. The four operations

| # | Operation | Label in the UI | What it does | Needs a base? | Step output |
| --- | --- | --- | --- | --- | --- |
| 1 | New body | `new body` | makes a new, separate body; never touches an existing body | no | `+ body` |
| 2 | Join | `join` | unions the feature's volume into the target body | yes | `→ body` |
| 3 | Cut | `cut` | subtracts the feature's volume from the target body | yes | `→ body` |
| 4 | Intersect | `intersect` | keeps only the volume shared by the feature and the target body | yes | `→ body` |

That is the whole set. There is no fifth boolean. **Combine** (two bodies)
reuses join/cut/intersect with a target and a tool, but has no `new body`;
**split body** is a tool-based split, not a boolean; **offset faces** is a
signed-distance modification, not a boolean. Components are out of scope
([`TIMELINE.md`](TIMELINE.md)), so there is no `new component` option.

- The word is **`new body`**, never `new`. “New” is an adjective with no noun and
  reads like a mode. The document enum may keep `new` as its key; the **label** is
  always `new body`.
- `join`, `cut` and `intersect` are verbs/operations; `new body` names the result
  because it does not modify anything.
- The order is always **new body · join · cut · intersect**. It is the same row
  in every feature form; do not reorder per feature.

## 2. Where the control lives

- The operation row lives in the **feature form** (the draggable popover), beside
  distance/angle and before the footer. It is not in the selection popover and not
  in the timeline detail.
- It is a **segmented control** (`.seg`), not a `<select>`. All four options are
  visible at once so the user can see the operation they are in and the ones they
  are not. A dropdown hides the alternatives and is the source of the current
  drift.
- The row label is `operation`. The footer summary repeats only the chosen word.
- **Default:** when the draft opens, `new body` if the document has no body yet,
  `join` if it does. This is the draft's starting value, not a fallback: the user
  can see it and change it before applying.
- **No silent changes after that.** Once the user has chosen an operation, an
  impossible one is an error, never a different operation. A `join` with nothing
  to join does not quietly become `new body`; a `cut` does not become `join`.
- Show all four options even when two are unavailable. `cut`/`intersect` are
  disabled on a first feature with the hint `cut and intersect need a body`; the
  primary is disabled with the same reason. Do not hide options to make the row
  look tidy.
- `new body` keeps its semantics and its result-body preview: the whole body is
  new, so tinting it all would read as a selection. `join` keeps its semantics but
  previews the **added** material in the highlighter; the target and the overlap
  that was already material stay normal.

### Which features have the row

| Feature | Operation row | Why |
| --- | --- | --- |
| Extrude | new body · join · cut · intersect | adds/removes a swept volume |
| Revolve | new body · join · cut · intersect | the same, rotated |
| Future sweep/loft | new body · join · cut · intersect | the same grammar |
| Offset faces | **no** | modifies selected faces of the one body; `out`/`in` is the direction, not a boolean |
| Shell | **no** | a modification of the one body |
| Fillet / chamfer | **no** | a modification of edges |
| Datum / sketch | **no** | not solid material |
| Combine | join · cut · intersect | always has a target; no `new body` |
| Split body | **no** | keep-both split, not a boolean |

## 3. The preview language

The preview has three material states and one context state. They are the same
tokens in every feature.

| State | Meaning | Look |
| --- | --- | --- |
| **Result** | the body that will exist after apply | normal material, normal edges |
| **Added** | material a modification adds | highlighter fill, translucent (~0.34), above the body |
| **Removed** | material a cut takes away | cut red, translucent (~0.3), above the body |
| **Ghost** | context, the input body, or material the boolean discards | low-contrast ink: dashed outline and/or a very faint fill (~0.12) |

- **Added** uses the current highlighter (`--marker` / `--marker-soft`) and follows
  the day/night/highlighter theme. It is the same token as a selected face's wash,
  not a second colour.
- **Removed** uses **cut red**: `#b83b3b` in day, `#e26a6a` in night (the values the
  offset preview already uses). It is a material signal, not an error: errors keep
  the ink/danger text treatment. Do not use the highlighter for removed material.
- **Ghost** is the existing sketch/tool ghost: `--ink-3`, dashed, and a faint fill
  where a volume needs to read. It is never red and never highlighter.
- The **result body is not repainted**. Only the diff layer is tinted. A join
  does not turn the whole union highlighter, a cut does not turn the whole body
  red, and an intersect does not turn the whole body highlighter.
- The preview sits **above the body** and is `pointer-events: none`; it never
  joins picking or selection.

### Per operation

| Operation | Result body | Diff layer |
| --- | --- | --- |
| **New body** | the new body, normal | none — the whole body is new; tinting it all would read as a selection. Existing bodies stay normal and separate. |
| **Join** | the union, normal | the **added** material (tool minus target) in the highlighter; the target and the tool∩target overlap stay normal. Do not tint the whole tool. |
| **Cut** | the target with the subtraction, normal | the removed volume (tool ∩ target) in **red**; the tool outside the target may be a **ghost** so the cutter is legible. |
| **Intersect** | the shared volume, normal | the target and tool **outside** the shared volume in **ghost**; the shared volume stays normal. **Never red.** Red means “removed by a cut”; intersect discards material rather than cutting it. |

The cut/intersect distinction is therefore a colour distinction, not an icon:

- **cut** shows a red plug of material that will disappear;
- **intersect** shows ghosted material that will not survive and a normal overlap
  that will.

A cut that removes nothing and an intersect that keeps nothing are errors (see
§6); they never preview as an empty red/ghost shell.

### Offset faces reuses the grammar

Offset faces has no operation row, but its preview follows the same material
language:

- `out` = **added** material in the highlighter;
- `in` = **removed** material in cut red;
- the pre-offset body is a **ghost** so the movement is visible.

`out`/`in` is a signed distance, not `join`/`cut`: it always modifies the selected
body (`→ body`). Do not add four boolean options to the offset form.

## 4. The form row and the summary

```
┌──────────────────────────────────────────────┐
│ NEW FEATURE / EXTRUDE FEATURE                │
│ Extrude                                      │
├──────────────────────────────────────────────┤
│ sketch       Sketch 1                        │
│ profile      1 region               select   │
│ distance     [ 12.0 ] mm  ─────●────         │
│ operation    new body·join·cut·intersect     │
│ end          blind | through all             │
├──────────────────────────────────────────────┤
│ 12.0 mm · cut · 1 region                     │
│                            cancel   extrude  │
└──────────────────────────────────────────────┘
```

- For the boolean features, the form summary uses the same word and the order
  **size · operation · input**: `12.0 mm · cut · 1 region`,
  `through all · cut · 1 region`, `360° · intersect · 1 profile`. The timeline
  meta drops the input: `12.0 mm · cut`, `through all · intersect`. Offset faces
  keeps its own `<face count> · <signed distance>` summary because it has no
  operation.
- **Through all** is cut-only in v1. Switching to `new body`, `join` or
  `intersect` restores `blind`, because those operations need a finite tool. The
  row is disabled for the other operations with the reason.
- Cut and intersect must **overlap** the target. An end condition that stops on
  the target's surface (`to object` / `to next`) leaves nothing to remove or
  keep; that is a visible error, not an empty step. Use `blind` or, for a cut,
  `through all` when the tool must cross the body.
- A partial/one-side direction is independent of the operation; do not couple
  them.
- The primary button remains the feature verb (`extrude`, `revolve`, `apply`),
  never `cut`/`join`. The operation is a parameter, not a command.

## 5. The step

- The step kind stays `extrude` / `revolve`; the operation is in the meta:
  `12.0 mm · cut`, `through all · intersect`, `12.0 mm · new body`.
- The output chip stays `+ body` for new body and `→ body` for join/cut/intersect.
  The chip says **create vs reference**, not which boolean ran. Do not use `−`
  for cut: `−` already means “consumes this body” in
  [`TIMELINE.md`](TIMELINE.md), and overloading it would make a cut
  indistinguishable from a merge.
- A cut/intersect step highlights its result like any body step. The diff tint is
  a draft preview only and never persists into the timeline or export.
- Re-editing the step reopens the form with the same four options and restores
  `cancel` to the baseline operation.

## 6. Failure and limits

| Case | Result |
| --- | --- |
| First feature with `cut`/`intersect` | options disabled; primary disabled with `cut and intersect need a body` |
| Forced cut/intersect with no base | worker error `Nothing exists to cut.` / `Nothing exists to intersect.` |
| Cut with no overlap | visible error `The cutter does not intersect the body.`; last good body stays |
| Intersect with no overlap | visible error `The intersection is empty.`; last good body stays |
| Intersect where the tool contains the target | valid; the result is the target |
| Intersect where the target contains the tool | valid; the result is the tool volume |
| Cut/intersect after a failed or missing base | the step is skipped with a lost-body error; no retarget |
| `join` with nothing to join | visible worker error; never a silent `new body` |
| `through all` on new body/join/intersect | disabled; end returns to `blind` |
| `to object` / `to next` ends on the target surface for cut/intersect | visible no-overlap error; use `blind` or `through all` (cut) |
| Offset faces distance too large | existing offset error, never a boolean fallback |
| Any invalid kernel result | error, skip the feature, keep the last good body |

- The error lives in the form and on the stage step. The last good body stays
  visible; the failed feature is never silently dropped.
- Do not substitute `join` for an empty `cut`, or `cut` for an empty `intersect`.

## 7. Decisions

| # | Decision | Why |
| --- | --- | --- |
| B1 | Four operations: **new body · join · cut · intersect**. | The complete boolean set, one per material action. |
| B2 | The label is **`new body`**, in that order, everywhere. | “new” alone is a mode without a noun. |
| B3 | One **segmented** operation control in the feature form, same order. | All options visible; no dropdown drift. |
| B4 | Preview: **added = highlighter, removed = cut red, discarded/context = ghost, result = normal**. | One material language across extrude, revolve, offset and combine. |
| B5 | **Intersect never uses red.** Cut shows red removed material; intersect ghosts the discarded material. | The operations must be distinguishable at a glance. |
| B6 | **Offset faces is not a boolean row.** Out/in reuses the add/remove/ghost grammar. | The offset modifies one body; it has no target/tool choice. |
| B7 | The output chip stays **`+` / `→`**; the operation is in the meta. | `−` already means consume in the timeline. |
| B8 | `cut`/`intersect` require a base and a non-empty result; both are visible errors. | An empty step is worse than a surfaced failure. |
| B9 | No silent operation change after the draft opens. | Matches `INTERACTION.md`'s no-silent-fallbacks rule. |
| B10 | `through all` is **cut-only** in v1. | It is the only operation that needs an unbounded tool. |
| B11 | The document enum may keep `new`; the visible label is always **`new body`**. | Avoid a schema bump for a copy change. |
| B12 | **Join highlights the added material** (tool minus target) in the highlighter; the target and the overlap that was already material stay normal. | A join is an addition, not a recolour of the whole body. |

## 8. Open questions

| # | Question | Current proposal | Status |
| --- | --- | --- | --- |
| O1 | Does `intersect` ship on extrude/revolve in v1, or wait for Combine? | Spec it now; the UI can ship it after the worker boolean lands. | Proposed |
| O2 | Does a disjoint `join` create a separate body or error? | Current behaviour (visible default/error); do not change in this contract. | Open |
| O3 | Should `new body` get a name field in the form? | Not v1; the body name is editable on the timeline chip like any body. | Proposed |
| O4 | Should cut red become a semantic token (`--cut`/`--remove`) instead of two literals? | Yes; the offset preview already needs it. | Proposed |
| O5 | Should the tool outside the target be ghosted for a cut, or only the removed overlap? | Ghost the outside tool at low contrast; the red overlap is the signal. | Proposed |
| O6 | Does `intersect` need a distinct icon in addition to the preview colour? | No; the preview grammar and the word are enough. | Proposed |
| O7 | Should join highlight only the material outside the target? | **Yes**; added = highlighter, overlap = normal (B12). | Decided |
| O8 | Does `new body` tint the new body in the draft? | No; a whole-body tint reads as selection. Keep it normal. | Proposed |

## 9. Current implementation and gap

Implemented today:

- `ExtrudeOperation`/`KernelOperation` include `new`, `join`, `cut` and
  `intersect`; migrations accept all four. The worker uses
  `fuseWithEvolution`/`cutWithEvolution`/`intersectWithEvolution`.
- Extrude and revolve use the same four-way segmented `OperationRow` in the
  document order `new body · join · cut · intersect`. `cut`/`intersect` are
  disabled on a first feature, through-all is cut-only, and changing away from
  cut restores blind.
- Extrude and revolve drafts/edits request the boolean diff: join shows the added
  tool material in the highlighter, cut shows removed material in cut red plus a
  ghost cutter, intersect ghosts the discarded target/tool and keeps the overlap
  normal. The result body is not repainted. Offset faces uses the same
  added/removed grammar.
- `--cut` is a palette token; the viewer reads it (with a theme fallback).
- Cut with no overlap and intersect with an empty result are visible errors.
- Timeline meta uses `new body`; the output chip stays `+`/`→`.

Remaining:

- A disjoint `join` still relies on the current worker behaviour; the contract
  does not decide whether it becomes a second body or an error (O2).
- Combine/Split Body and `intersect` between bodies remain M6 work.
- Move/share the tool/result ghost treatment with `booleans.html` when the
  visual companion is finalized.

Code map for the implementation session:

- `src/core/doc/types.ts` — `ExtrudeOperation` (`new` | `join` | `cut`) and the
  feature record;
- `src/core/kernel/protocol.ts` — `KernelOperation`, the feature payload and the
  diff mesh types;
- `src/workers/kernel.worker.ts` — the boolean branch and `buildOffsetDiff`
  (the reference added/removed mesher);
- `src/app/FeaturePopover.tsx` — the `<select>` to replace with `.seg`;
- `src/app/App.tsx` — the draft defaults, `featureTimelineOutput` and the step
  meta;
- `src/viewer/Viewport.ts` — `setDiff`/`addDiffMesh` and the hardcoded cut red;
- `src/app/app.css` — the segmented row and the `--cut` token.
