# ADR-0002: Pure-JSON document with rebuild-from-scratch

**Status:** accepted · 2026-10-25

## Context

A parametric modeler needs to be editable, undoable, saveable and reproducible. There
are two common designs:

1. Live object graph: features hold kernel shapes, edits mutate them incrementally.
2. Declarative history: the document is data; a replay engine evaluates it.

## Decision

The document is **plain JSON data** containing an ordered feature list and no kernel
objects. The model is produced by a **deterministic full rebuild** (with a prefix cache
keyed by hashes). All selections are stored as `TopoRef` (semantic role + geometric
hint), never as kernel handles or indices.

## Consequences

- Undo/redo is trivial and correct (immutable snapshots).
- Save/load is trivial; documents are portable and diffable.
- "Edit an early feature" is the default, not a special case.
- Rebuild cost grows with the feature count, so we cache unchanged prefixes and show
  stale geometry while rebuilding. Acceptable for parts with tens of features.
- We must solve the topological naming problem explicitly; there is no way to keep live
  object identity across a rebuild. `brepjs/shapeRef` is the mechanism.
- Determinism is a hard requirement, so all iteration that affects geometry must be
  ordered (sorted by ID or position, never object/Map insertion order from the kernel).

## Alternatives considered

- **Incremental/live object graph** (e.g. OCCT `BRepBuilderAPI_Transform` on existing
  shapes): faster for small edits, but state management, undo and serialization become
  much harder, and it does not give us history editing anyway.
- **Command/undo log as the document** (like a script): compact, but fragile across
  version changes and awkward for UI-driven editing.

## Notes

Parameters/expressions (M7) fit this model naturally: they are just another layer of
data evaluated before features. Keep `Expr` in the document from day one.
