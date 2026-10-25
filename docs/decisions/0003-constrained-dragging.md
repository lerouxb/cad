# ADR-0003: Constrained dragging by tangent-space projection

**Status:** accepted · 2026-10-25

## Context

Dragging a point in a constrained sketch sounds like "move the point to the cursor and
re-solve". With `slvs` that is wrong: the only way to express a drag through its API is a
hard `C_WHERE_DRAGGED` constraint (or `dragged()`), which pins the point at the cursor.
Any cursor position off the feasible set makes the system **inconsistent** — dragging a
horizontally-constrained point diagonally, or any point on a circle, fails. Worse, the
solver still returns positions with the other constraints violated, so a naive caller
would corrupt the sketch.

Retrying x-only then y-only handles rectangles, but nothing with a diagonal or curved
constraint, and the demo needs to grow beyond rectangles.

## Decision

Project the cursor delta onto the constraint tangent space, then solve.

1. Build an analytic Jacobian of the supported constraints at the current solution
   (`core/sketch/drag.ts`): coincident, horizontal, vertical, distance, diameter,
   midpoint.
2. Project the cursor delta onto the null space of that Jacobian with weighted cyclic
   orthogonal projections (von Neumann / Kaczmarz). The dragged point has a tiny
   mobility (1e-9) and everything else has 1, so the dragged point follows the cursor
   while the rest of the sketch absorbs the correction.
3. Apply the projected delta to **all** points, then call the solver *without* a drag
   constraint. The projection is first-order; the solver removes the second-order error.
   If it rejects the step, retry at 1/2, 1/4, 1/10 scale.
4. If the dragged point does not actually move (< 1e-4 mm), return "no movement". A
   fully constrained sketch therefore refuses the drag, which is correct.

## Consequences

- Points slide along lines, circles and compound constraints in the direction the user
  actually wants. No `dragged()` calls anywhere.
- Every new constraint type must add a residual and gradient to `drag.ts`, plus a drag
  test. That is a small, local cost and a good forcing function: an unsupported
  constraint silently adds a degree of freedom to the projection.
- The projection is linearised per pointer event, which is fine for incremental mouse
  movement and converges through the solver. A huge single jump can produce a poor
  direction; the scale fallbacks cover it.
- Full-rank sketches project to zero but floating point leaves a residue; the
  "did the point actually move" check is the semantic guard.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Pin the point at the cursor (`C_WHERE_DRAGGED`) | Fundamentally inconsistent off the manifold; violates other constraints when it "succeeds" |
| Retry along x, then y | Handles rectangles only; circles and angled lines do not move at all |
| Soft/weighted drag constraints | Not exposed by the libslvs C API |
| Numeric Jacobian by perturbing the solver | The solver exposes no residuals; perturbations get projected back by substitution, so the finite differences lie |
| Re-implement the solver | Out of the question |

## Tests

`src/core/sketch/solver.test.ts` covers a pendulum (a point on a distance constraint
slides tangentially), a rectangle corner drag (stays rectangular, takes its neighbour
with it), and a fully constrained sketch (no movement).
