# Next steps

Short-horizon queue. [`PLAN.md`](PLAN.md) remains the long-term milestone source
of truth; this file is the step-by-step list of what to do next.

- Add short-term priorities under **Now** (or a new topic section below it).
- Keep one item in **Doing** at a time.
- One item = one reviewable change. Verify it, then commit it on its own; do not
  mix unrelated code, tests and docs in the same commit.
- Move finished items to **Done** with the date and commit hash.
- If an item grows beyond a few days, split it here before starting.

## Now: offset faces

v1 is a conservative **face sweep + boolean**. It is exact for planar faces
with perpendicular planar neighbours or parallel cylindrical neighbours, plus a
coaxial full-360° through hole/boss. The current errors are guards against a
visible step or undercut, not missing UI. Do not relax them without a real
replacement path.

Items 1–3 are done (`a67c044`, `496b42c`, `b58f5d7`); item 4 is next.

- [ ] **4. Tangent top-edge fillet / tangent-chain offset** — design first;
  1–3 weeks.
  The fillet has to be re-derived, not just the adjacent face. Decide whether
  this means moving the pre-fillet face and rebuilding the tangent chain, or
  offsetting the blend surface itself. This is a history/rebuild decision and
  needs an ADR before code.
  **Judgment (2026-11-10):** do not move blend faces in place. The supported
  workflow is history order — insert the offset before the fillet, or edit the
  fillet after it. A direct blend rebuild changes the feature graph and needs its
  own ADR; the current diagnostic says exactly that.

- [ ] **5. Adjacent non-parallel selected faces / move-face set** — hard;
  split after 2 and 3.
  Shared edges have to be intersected and resewn. Disjoint non-parallel faces
  may be a smaller intermediate slice, but the validation and role transfer
  must keep them one feature.

- [ ] **6. General curved faces (cone/sphere/torus/B-spline)** — weeks or
  upstream kernel work.
  A constant-distance offset of these surfaces is not generally a face of the
  solid. It needs a real local face-offset entry point in `occt-wasm` (the
  current API exposes whole-solid `offset` only) or a custom B-rep edit.

- [ ] **7. Offset polish from the contract** — split as small commits.
  - [x] Normal arrow + dashed source-face ghost (`3108cce`).
  - [ ] Adaptive slider ceiling from the shortest **adjacent** dimension
    (currently the body’s shortest dimension).
  - [ ] Tangent-chain selection helper (expand to tangent faces; distinct from
    the tangent-fillet geometry in item 4).
  - [x] Faces on a shelled body (OFFSET_FACES O8): an inner planar wall offsets
    into the cavity and stays watertight (`5580fe3`).

## Candidates (not ordered)

Add a candidate here when it is worth remembering but not yet ready to start.
Move it under **Now** when it becomes the next priority.

- PICKS single-candidate support picker: keep the world/face/datum picker or
  move to `support · face 1 · planar · pick`.
- PICKS P14: lost face/edge inputs get an explicit lost marker with
  `reselect` / `revert` (the revolve axis already has this).
- Revolve: start-profile ghost and angle-arc preview.
- Section Analysis: view-only overlay vs history/visibility decision.
- Constraint marks: keep the screen-space checks in the e2e suite when adding
  a new mark shape (`vector-effect` on each stroked child, not the group).

## Doing

- Nothing in progress.

## Done

- 2026-11-10 — offset an inner wall of a shelled body, covering O8's planar
  case (`5580fe3`).
- 2026-11-10 — offset draft shows the dashed source face and normal arrows
  (`3108cce`).
- 2026-11-10 — offset faces support blind holes and partial cylinders with
  planar radial caps (`b58f5d7`).
- 2026-11-10 — offset faces follow slanted planar neighbours with a ruled loft,
  including holes and both out/in (`496b42c`).
- 2026-11-10 — offset-face rejection diagnostics name the blocking neighbour
  and the workaround (`a67c044`).
- 2026-11-10 — constraint-mark stroke width stays screen-space at zoom
  (`138641b`).
- 2026-11-10 — study contracts synced with implemented behaviour (`ea00a30`).
