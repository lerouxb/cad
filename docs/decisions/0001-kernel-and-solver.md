# ADR-0001: SolveSpace solver + OCCT (brepjs) kernel

**Status:** accepted · 2026-10-25

## Context

We need (a) a reliable 2D geometric constraint solver and (b) a 3D kernel with booleans,
fillets and exact export. Both must run in a browser.

## Decision

- 2D solver: **SolveSpace `slvs`**, via the upstream npm package `slvs@stable`
  (Emscripten build of `src/slvs`, single-file WASM, entity/constraint C API).
- 3D kernel: **OCCT via `brepjs` + `occt-wasm`**, running in a Web Worker.

## Consequences

- The application is **GPLv3** because `slvs` is GPLv3. Accepted deliberately.
- The solver is rebuilt from scratch on every solve (`clearSketch` → add → solve). It has
  no incremental API; that is fine because sketches are small and the call is fast.
- The solver's API is handle-based and stateful, so it lives behind one adapter module.
- We get exact B-rep, STEP export, real fillets, and — importantly —
  `brepjs/shapeRef` for stable face/edge references, which is the hardest part of a
  history-based modeler.
- Two large WASM payloads must be lazy-loaded (~8 MB solver, ~20 MB kernel, less when
  compressed). First meaningful paint must not depend on them.

## Alternatives considered

| Option | Why not |
| --- | --- |
| `replicad` + `opencascade.js` | More mature, MIT, bigger community, but no stable-reference layer; we would have to build topological naming ourselves. Kept as the fallback if `brepjs` proves unstable — the kernel adapter is kept thin to allow this. |
| `brepjs`'s own constraint sketch capability | `supportsConstraintSketch` exists, but it is only implemented by the in-development Rust `brepkit` kernel, not by the OCCT adapter. Not usable today; revisit if it matures. |
| FreeCAD `planegcs` in WASM | Permissive (LGPL) but no maintained browser build; more build work, weaker docs. Would be the choice if GPL were unacceptable. |
| Write our own solver | Weeks of work for something worse; constraint solving is a solved problem. |
| Manifold / mesh CSG | Fast and robust, but no true fillets, no STEP, faceted circles. Not a CAD kernel. |
| SolveSpace's own 3D kernel | Not exposed as a reusable library; it is coupled to the app. |
| `truck` (Rust B-rep) | Promising and permissive, but young; boolean/fillet robustness is not there yet. |

## Verification performed

- `slvs@stable` (3.3.0) bundles with Vite into a lazy chunk: 8.0 MB, 1.6 MB gzip.
- Node smoke tests of the solver API (points, lines, circles/arcs, constraints, solve),
  plus Vitest golden tests in `src/core/sketch/solver.test.ts`:
  circles driven by a diameter constraint work; group-0 entities act as fixed
  references; the base workplane contributes exactly 6 DOF, so `dof - 6` is the sketch's
  in-plane DOF; a fully constrained sketch refuses infeasible drags.
- `brepjs` + `occt-wasm` in Node: box/extrude volumes exact (`20×20×10 → 4000 mm³`).
- Full browser path: the Playwright e2e test loads both WASM modules in Chromium, drags
  a constrained corner, drives a dimension and asserts the exact OCCT volume
  (60×40×12 minus a Ø16 hole = 26 387.26 mm³) after each change.

Open item for M1: replace the axis-only drag fallback with tangent-space projection, and
confirm solver latency under sustained pointer-move dragging on low-end hardware.
