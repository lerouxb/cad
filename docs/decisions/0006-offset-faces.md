# ADR-0006: Offset Faces v1 is a checked planar/prismatic push/pull

- Status: **accepted** (v1 scope), 2026-11-08
- Contract: [`docs/showcase/OFFSET_FACES.md`](../showcase/OFFSET_FACES.md)

## Context

M5's remaining modelling feature is **Offset Faces**: move selected faces by a distance for
tolerance/fit and wall adjustments. The 2026-11-02 design audit counted 11 real uses, all
tolerance/fit ("tolerance for glass", "pcb-tolerance", "gasket tolerance", "enlarge
battery space"). It is the third most-used modelling feature after extrude and chamfer.

The kernel has no local face offset:

- `offset(solid, distance)` offsets **every** face. In the spike it also returned a
  **shell**, not a solid (`getSolids === 0`, `getShells === 1`).
- `offsetFace(face, distance)` returns a **surface** (one face, zero volume).
- `thicken(face, distance)` and `boss`/`pocket` build the same prism as a face extrusion;
  `boss`/`pocket` take a single wire and therefore lose holes.
- `extrude(face, vector)` accepts a planar face with inner wires, so it preserves holes.

The design study prioritises planar and cylindrical faces, then adjacent/disjoint sets,
then the tangent chain and general curves. A general local offset would need an upstream
OCCT operation or a full face-replacement/sewing rebuild. That is not available, so v1
takes the slice where a face sweep is exact.

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
| Top −20 (cut through all) | empty/multi-body | — | rejected |

The single-face cases are exact, including a face with a hole. Two limits make the
unchecked prism unusable:

1. **Adjacent selected faces leave an L-shaped step.** Top + +X +5 gives
   `base + topArea×5 + sideArea×5`, missing the 5 × 5 × 30 corner (750 mm³) that a true
   two-face offset contains.
2. **Non-prismatic adjacency leaves an undercut.** Filleting the four *top* edges
   (radius 4) and then offsetting the top face +5 keeps the old fillet where it was and
   adds a narrower straight cap: the cylindrical faces stay centred near z ≈ 10.44
   instead of moving up with the face. The result is valid and has the same volume as a
   taller rounded box, so a volume assertion alone cannot catch it.

## Decision

Implement **Offset Faces v1** as a checked planar/prismatic push/pull:

- `OffsetFaceFeature` (schema v12) stores `faces: TopoRef[]` and a signed `distance`.
- Resolve each face on the source prefix and require it to be **planar**.
- Require all selected normals to be **parallel**. This makes independent prisms exact
  for top + bottom, opposite walls and coplanar sets. Non-parallel sets are refused.
- Require the sweep to preserve every adjacent surface: a planar neighbour's normal must
  be perpendicular to the move; a cylindrical neighbour's axis must be parallel to it.
  This accepts plain walls and vertical-edge fillets, and rejects top-edge fillets,
  slanted/drafted walls and other free-form neighbours.
- Sweep the face by the signed distance and fuse (out) or cut (in). The face's inner
  wires are part of the swept profile, so holes survive.
- Reject an empty result, a result that is not a single solid, an invalid solid, and a
  no-op. The last good preview stays visible.
- Re-derive roles geometrically, carry the moved face's role to the face at its new
  plane, and name any new faces under the feature so the step highlight and downstream
  refs work.

The UI follows the design study: select faces, `offset face` chip, a UI-only draft with
the face list, `MeasureField` distance, out/in direction, live preview, `apply` as a
history step, live edit and baseline-restoring `cancel`. The preview error is inline and
disables `apply`.

## Same-domain merge spike (2026-11-08)

`unifySameDomain` via the raw kernel does merge the faces the boolean splits at the old
boundary:

| Shape (top face +5) | Boolean result | After unify |
| --- | --- | --- |
| 20 × 20 × 10 cube | 10 faces | **6 faces** |
| 40 × 30 × 12 plate with a hole | 12 faces | **8 faces** |
| 60 × 40 filleted plate with a hole | 20 faces | **13 faces** |

Volume and `isValid` were unchanged in all three. The hole wall still splits into two
cylindrical faces on the plated cases.

**It is not safe in this kernel build yet.** Calling `unifySameDomain` on an offset result
corrupts a later fuse on the same cached prefix: a second fuse from the same base returned
`isValid === false` (volume still plausible), even though the input base still validated.
The worker rebuilds offset previews repeatedly from the same prefix, so the second request
fails. v1 therefore leaves the extra same-domain faces. Do not call `unifySameDomain` in
the offset path until the kernel (or a base-rebuild strategy) makes it side-effect free.

## Alternatives considered

1. **Whole-solid `offset()`.** Moves every face; returns a shell in this kernel. Rejected.
2. **`boss`/`pocket` compound helpers.** Single wire, so a face with holes loses its
   hole. Rejected.
3. **An unchecked face prism.** Rejected: it silently makes a boss/cut instead of an
   offset at adjacent faces and tangent fillets.
4. **A general local offset.** The correct full solution, but it needs an upstream
   `occt-wasm` API or a face-replacement/sewing rebuild. Deferred until the cylindrical
   and multi-face cases justify it.

## Consequences

- v1 supports planar faces with prismatic neighbours. Curved faces, tangent top-edge
  fillets, slanted walls and non-parallel sets are visible errors.
- Cylindrical hole/boss walls (the tolerance/fit case) are **not** done yet; they need a
  separate rebuild (for example a concentric-tube boolean) and remain the next kernel
  slice.
- The tangent-chain toggle and the preview ghost/normal arrow are not implemented.
- Tests assert volume, bounds, validity and the hole, and failure tests cover a curved
  face and an inward collapse. The multi-face L-step and undercut are rejected by the
  adjacency checks.
