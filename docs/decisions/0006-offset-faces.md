# ADR-0006: Offset Faces does not use a face-extrusion boolean

- Status: **rejected / superseded** by [`docs/showcase/OFFSET_FACES.md`](../showcase/OFFSET_FACES.md)
- Date: 2026-11-08

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

The obvious candidate was therefore: sweep the selected planar face along its normal and
fuse (outward) or cut (inward). This ADR records the spike, why that candidate was
rejected, and what a real implementation needs.

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

A single planar face on a prismatic body is exact, including faces with holes. Two limits
make it unusable as "Offset Faces":

1. **Adjacent selected faces leave an L-shaped step.** Top + +X +5 gives
   `base + topArea×5 + sideArea×5`, missing the 5 × 5 × 30 corner (750 mm³) that a true
   two-face offset contains. The solid is valid, but it is two bosses meeting at a
   corner, not a uniformly offset body.
2. **Non-prismatic adjacency leaves an undercut.** Filleting the four *top* edges
   (radius 4) and then offsetting the top face +5 keeps the old fillet where it was and
   adds a narrower straight cap: the cylindrical faces stay centred near z ≈ 10.44
   instead of moving up with the face. The result is valid and has the same volume as a
   taller rounded box, so a volume assertion alone cannot catch it.

It cannot offset a cylindrical hole/boss wall at all: only planar faces can be extruded,
while the design study's tolerance/fit cases explicitly include those.

## Decision

**Rejected.** Do not implement Offset Faces as a face-extrusion boolean, even with an
adjacency check that restricts it to the cases where the prism happens to be exact. The
result is a boss/pocket, not a face offset; it fails cylindrical faces and silently changes
the meaning of the feature. This matches the design contract: the kernel path is an open
feasibility question, and the feature must not be faked with a whole-body offset, a shell,
a scale or a degenerate extrude.

The spike numbers remain useful as regression data for the real operation: a valid offset
of the plate's top face must keep `valid === true` and the hole, and must not produce the
L-step or the undercut above.

## What a real implementation needs

One of:

1. an upstream `occt-wasm` operation for selected-face offset (a new `BRepOffsetAPI`-level
   entry point); or
2. a rebuild strategy: offset the selected face's surface, rebuild/extend the adjacent
   faces, close and validate the solid (the design study's suggested path).

The selected-face-on-solid kernel path is **blocking** (OFFSET_FACES.md O1). Until it is
decided, the UI/selection contract can land first: the face popover's `offset face…` chip
and the FEATURE action table, without a fake preview. Use the design study's failure and
readout rules for whatever the kernel can do.

## Alternatives considered

1. **Whole-solid `offset()`.** Moves every face; returns a shell in this kernel. Rejected.
2. **`boss`/`pocket` compound helpers.** Single wire, so a face with holes loses its
   hole. Rejected.
3. **Ship the prism anyway with a restricted scope.** Rejected by the design contract:
   the feature name promises a face offset, and the prism is a different operation.
