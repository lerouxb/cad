# Upstream limitations

This file records capabilities the app cannot implement cleanly because a
dependency is missing an operation, has a bug, or exposes an unsafe API. It is
deliberately separate from [`PLAN.md`](PLAN.md) (our milestones) and
[`NEXT_STEPS.md`](NEXT_STEPS.md) (our short-term queue): each entry here should
be actionable as an upstream issue or pull request.

Add an entry when:

- the workaround is a visible limitation, not the intended design;
- the missing piece is in a dependency rather than our code;
- we have a concrete reproduction or API observation.

Do **not** list product decisions here. Those stay in `PLAN.md`, `NEXT_STEPS.md`
or an ADR.

| ID | Dependency | Blocked capability | Current workaround | Upstream opportunity |
| --- | --- | --- | --- | --- |
| U1 | `occt-wasm` / `brepjs` | Local face offset / face replacement on a solid | Planar sweep, ruled loft for slanted planar neighbours, cylindrical sector; unsupported cases are visible errors | Expose a per-face/local offset or face-replacement operation; a high-level `offsetFaces(solid, faces, distance)` |
| U2 | `occt-wasm` | `unifySameDomain` on shapes sharing subshapes with a cached prefix corrupts a later fuse | Serialize to BREP, unify an isolated copy, adopt it back; coalesce split faces for refs | Fix handle ownership/side effects; document copy-on-unify; add a safe in-place variant |
| U3 | `slvs` | Tangency between two arcs/circles (only arc↔line and cubic↔line are available) | Offer tangent only where the shared-endpoint arc↔line case is valid | Generic tangent constraint that does not require a shared endpoint |
| U4 | `slvs` | Collinear primitive | One document `collinear` constraint maps to `parallel` + point-on-line | Native collinear constraint (or an exact helper) |
| U5 | `slvs` | Robust handling of invalid constraint arguments | The adapter validates types and re-instantiates the module; bad arguments still abort the WASM instance | Return an error instead of `Platform::FatalError`; keep the instance usable |
| U6 | `slvs` | Conic/ellipse constraints | Ellipses/conics are out of scope for the sketch UI | Conic entity + constraints if the solver adds them |
| U7 | `three.js` | `LineBasicMaterial.linewidth` is ignored by WebGL | Use `Line2`/`LineSegments2` for thick screen-space marks | No upstream need; recorded so nobody tries linewidth again |

## Details

### U1 — no local face offset

`occt-wasm@5.8.1` exposes whole-solid `offset(solid, distance, tolerance)` and
`offsetWithHistory`. In this build a whole-solid offset returns a shell, not a
solid, and there is no face-list argument. `brepjs@20.11.0`'s `offsetFace(face,
distance)` calls the same whole-shape offset on a face and returns a `Shape3D`
surface, not a local solid edit.

This blocks a general **move this face and rebuild its neighbours** operation,
including cone/sphere/torus/B-spline faces, tangent top-edge fillets and
tangent-capped partial cylinders. The shipped workaround is deliberately narrow:

- planar/prismatic sweep when the sweep preserves the neighbours;
- a ruled loft for convex planar faces with slanted planar neighbours;
- full/partial cylindrical sectors with planar radial caps;
- blind cylinders with planar caps.

**Upstream asks:** a local face offset (OCCT `BRepOffset` face selection or an
equivalent), or a face-replacement/sewing API that lets the caller rebuild the
neighbourhood. A brepjs-level `offsetFaces(solid, faces, distance)` would make
the app-side code much smaller.

### U2 — `unifySameDomain` shared-subshape corruption

Calling `unifySameDomain` directly on a shape that shares subshapes with the
cached prefix can corrupt a later fuse from that same prefix: the second fuse
returns `isValid === false` while still producing a plausible volume. The worker
serialises the result through BREP, unifies the independent copy, adopts the
merged shape back into brepjs, and disposes the copy.

**Upstream asks:** confirm and fix the handle-ownership/side-effect bug, or
document that `unifySameDomain` requires an independent copy. A safe in-place
variant would avoid one serialize/deserialize per offset.

### U3/U4/U5 — slvs gaps

- Tangency is only exposed for an arc↔line (or cubic↔line) pair sharing an
  endpoint. Arc↔arc tangency has no primitive, so the UI cannot offer it.
- There is no collinear primitive. The app maps one document constraint to
  `parallel` + point-on-line, which is exact but adds two handles that must map
  back to one id.
- Invalid arguments can abort the WASM instance via `Platform::FatalError`
  (uncatchable). The adapter validates entity types and can re-instantiate, but
  an error return would be safer.

**Upstream asks:** a generic tangent constraint, a native collinear constraint,
and recoverable argument errors.

## Not upstream

These are our decisions or our remaining algorithms, not dependency gaps:

- **Tangent top-edge fillets in place.** Moving a blend changes the feature
  graph and downstream fillet refs. The supported workflow is to insert the
  offset before the fillet in history, or edit the fillet after it. This needs a
  feature-graph ADR, not an upstream kernel change.
- **Adjacent non-parallel selected faces.** A move-face set needs a combined
  vertex solve; independent per-face sweeps are wrong.
- **Draft view: model profile/axis picking, plane-aware framing and the
  remaining model controls.** The default model entry, preview,
  selected-profile fill and background no-op have landed, but the 3D
  profile/axis pick, plane-aware camera, model tool-options draft state and
  on-geometry height/angle handles are app UX work tracked in `NEXT_STEPS`
  item 8. No dependency gap.
- **Adaptive adjacent slider ceiling and tangent-chain selection helper.** UX
  work, not blocked upstream.
- **Multi-body, assemblies, patterns, mirrors, drafts, lofts/sweeps, splines,
  text, drawings, expressions.** Product scope in `PLAN.md` / `NEXT_STEPS.md`.

## Mining this list

When picking an upstream contribution, prefer an entry with a minimal
reproduction and a clear API shape. The highest-leverage current items are U1
(local face offset) and U2 (`unifySameDomain` ownership); U3–U5 are smaller,
well-scoped solver improvements.
