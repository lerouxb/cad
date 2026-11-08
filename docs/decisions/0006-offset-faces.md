# ADR-0006: Offset Faces is a planar push/pull feature

- Status: proposed (kernel spike complete)
- Date: 2026-11-08

## Context

M5's remaining modelling feature is **Offset Faces**: move selected faces by a distance for
tolerance/fit and wall adjustments. The 2026-11-02 design audit counted 11 real uses, all
tolerance/fit ("tolerance for glass", "pcb-tolerance", "gasket tolerance", "enlarge
battery space"). It is the third most-used modelling feature after extrude and
chamfer.

The kernel does not expose a local face offset:

- `offset(solid, distance)` offsets **every** face. In the spike it also returned a
  **shell**, not a solid (`getSolids === 0`, `getShells === 1`), so it cannot be used as a
  history step.
- `offsetFace(face, distance)` returns a **surface** (one face, zero volume).
- `thicken(face, distance)` and `boss`/`pocket` build the same prism as a face extrusion;
  `boss`/`pocket` take a single wire and therefore lose holes.
- `extrude(face, vector)` accepts a planar face with inner wires, so it preserves holes.

OCCT's local offset is not exposed by `occt-wasm`; a true selected-face offset would need
an upstream kernel API or topology surgery (new face + extended adjacent faces + sewing).

## Spike results

A 40 × 30 × 12 plate with a Ø12 through hole (the example plate's topology), volume
13042.831974 mm³, top face area 1086.902664 mm²:

| Operation | Result | Bounds | Validity |
| --- | --- | --- | --- |
| Top face +5 (extrude face, fuse) | 18477.345296 (+5434.513322) | z 0…17 | valid, 12 faces |
| Top face −5 (extrude face, cut) | 7608.318651 | z 0…7 | valid, 7 faces |
| +X face +5 (fuse) | 14842.831974 (+1800) | x −20…25 | valid, 11 faces |
| Bottom face −5 (outward fuse) | 18477.345296 | z −5…0 | valid |
| Top + +X, both +5 | 20277.345296 | x −20…25, z 0…17 | valid, 16 faces |
| Top −20 (cut through all) | empty shape | throws on bounds | — |

The single-face cases are exact: the face's wires (including the hole) are swept along the
normal and the result is a valid solid. A negative distance cuts instead of fuses.

Two limitations showed up:

1. **Adjacent selected faces leave an L-shaped step.** Top + +X +5 gives
   `base + topArea×5 + sideArea×5`, missing the 5 × 5 × 30 corner (750 mm³) that a true
   two-face offset contains. The solid is valid, but it is two bosses meeting at a
   corner, not a uniformly offset body.
2. **Non-prismatic adjacency leaves an undercut.** Filleting the four *top* edges
   (radius 4) and then offsetting the top face +5 keeps the old fillet where it was and
   adds a narrower straight cap: the cylindrical faces stay centred near z ≈ 10.44
   instead of moving up with the face. The result is valid and has the same volume as a
   taller rounded box, so a volume assertion alone cannot catch it. Filleting the four
   *vertical* edges is safe: the cap's vertical surfaces continue the same planes and
   cylinders.

The adjacency test is implementable with the current API: `adjacentFaces(solid, face)`
plus `faceAxis(face)` distinguishes the two fillet cases exactly. The vertical fillets
report axes ±Z (parallel to the top normal); the top-edge fillets report ±X/±Y
(perpendicular). Planar neighbours report their normal, which must be perpendicular to
the sweep direction.

## Decision (proposed)

Implement Offset Faces v1 as a **history feature that moves planar faces along their
normal by sweeping the face and applying a boolean**:

- `OffsetFaceFeature` (schema v12) stores `faces: TopoRef[]` and a signed `distance`.
- Positive distance extrudes the face outward and fuses; negative extrudes inward and
  cuts. The selected face's full boundary (outer wire + holes) is used.
- The worker rejects an empty/zero-volume result visibly ("The offset removes the whole
  body.") and rejects a face that no longer resolves.
- Multiple faces are accepted only when their normals are parallel (same or opposite).
  That makes independent prisms exact: plate thickness (top + bottom), opposite walls,
  and coplanar splits. Non-parallel selections are rejected in v1; one step per face is
  the escape hatch.
- A face is rejected when the sweep would leave a step: every adjacent surface must be
  preserved by sweeping along the normal. Planar adjacent faces must contain the sweep
  direction (their normal is perpendicular to it); cylindrical adjacent faces must have
  their axis parallel to it. Other surfaces, slanted faces and tangent top-edge fillets
  are rejected with a visible message. This is the difference between a correct offset
  and an undercut.
- After the boolean, re-derive face roles geometrically and name new faces under the
  feature, like the shell step, so highlights and downstream `TopoRef`s keep working.
- UI: the face selection popover gets an `offset…` chip; the form uses `MeasureField`,
  previews through the kernel as a UI-only draft, applies as a history step, edits live
  and restores the baseline on cancel.

## Alternatives considered

1. **True local offset in the kernel.** The correct general solution, but it requires a
   new `occt-wasm` API or custom B-rep surgery (offset the face surface, extend/trim
   adjacent faces, sew, validate). Much larger risk, and the 11 audit uses are
   tolerance/fit on prismatic parts.
2. **Whole-solid `offset()`.** Moves every face, and the spike returned a shell rather
   than a solid. Rejected.
3. **`boss`/`pocket` compound helpers.** They take a single wire; a face with holes (the
   example plate) would lose its hole. Rejected; use the face extrusion directly.
4. **Ship without the adjacency check.** The preview would show the step, but the
   geometry would silently be a boss/cut rather than an offset. The kernel check keeps
   "Offset Faces" honest.

## Consequences

- v1 is planar-only. Curved faces report "Offset Faces supports planar faces only."
- Non-parallel multi-face selections are refused; the UI may still show the selected
  set so the user can remove all but one.
- Prismatic adjacency is required. A face next to a tangent fillet or a drafted wall is
  refused rather than producing an undercut; true local offset remains an M9/upstream
  item.
- Tests must assert volume, bounds, `isValid`, and the *absence* of a step/undercut
  (face count or cylindrical-face position), not volume alone.
- The example can ship a suppressed offset step for discoverability, but the base body
  and existing volume goldens stay unchanged.
