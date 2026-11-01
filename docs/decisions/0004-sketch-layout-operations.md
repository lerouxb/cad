# ADR-0004: Sketch layout operations are stored, parametric records

- Status: accepted
- Date: 2026-11-01

## Context

`docs/showcase/` explores rectangular pattern, circular pattern, mirror and offset as
**sketch-mode** tools. The design target is Fusion-like: the user selects source geometry,
opens the tool, sees a live preview, applies it, and can later reopen the same operation
and change its count, spacing, axis, mirror line or offset distance. The preview is a
proposal (dashed, faint); the original selection keeps the highlighter.

The document is plain JSON and rebuilds deterministically. Today a sketch owns points,
curves and constraints, and the solver rebuilds from those on every solve. If a pattern
merely copied geometry into the sketch, the copy would lose its relationship to the
source and could never be tweaked as one operation.

## Decision

Sketch layout operations are **first-class parametric records on the sketch feature**,
stored as plain JSON alongside points/curves/constraints:

```ts
interface SketchLayoutOperation {
  id: Id;
  kind: "rectangularPattern" | "circularPattern" | "mirror" | "offset";
  source: Id[];              // points/curves the operation consumes
  // kind-specific parameters, e.g. count, spacing, direction, centre, angle,
  // mirror line, distance, side, corner style
  params: Record<string, number | string | boolean>;
  /** Last-known derived ids/values for recovery and diagnostics. */
  derived?: unknown;
}
```

Instances are **derived geometry**, regenerated from the solved source geometry on every
rebuild. They are not stored as independent user curves. They participate in:

- region extraction and therefore extrude profiles;
- selection previews and the 3D rebuild;
- JSON round-trips only through the operation record (the derived layer is not persisted).

In v1, instances are not individually selectable, draggable or constrainable. The user
constrains the **source**; the operation copies that solved result. Editing the operation
is an ordinary undoable sketch edit and regenerates the instances. The sketch stays one
history step; operations are nested inside it (a nested timeline row can come later).

Feature-level patterns/mirror on solids and faces (M6) are separate: they consume B-rep
outputs and use `TopoRef` evolution. They should reuse the same popup/preview grammar, not
this sketch operation engine.

## Alternatives considered

1. **Materialise copies into real curves/points when applied.** Simpler to draw and
   extrude, but re-editing means deleting and recreating geometry, remapping constraints,
   and losing any constraints on the copies. Rejected for the primary path.
2. **One history feature per operation.** Clean separation, but it exits sketch mode for
   what is a sketch layout decision and makes the timeline noisy. Rejected for v1; the
   operation stays inside the sketch. Feature patterns still use history steps.
3. **Derived instances as solver variables.** Allows constraining instances, but the
   solver input would have to regenerate entity handles and duplicate constraints on every
   parameter change. Deferred until there is a concrete need.

## Consequences

- `SketchFeature` needs a schema version bump when operations are added.
- `regionsFromSketch` (or a small derived-sketch step before it) must expand operations
  before the planar arrangement. Deterministic instance ids are required.
- The solver sees only the source geometry; operation instances are fixed derived
  geometry, like projected references.
- Offset is the hardest operation: v1 supports closed loops with miter/round corners and
  explicitly reports open chains/self-intersections instead of producing a bad profile.
- The UI edits the operation record, not the copies. Selecting a source and reopening the
  tool pre-fills the existing parameters.
