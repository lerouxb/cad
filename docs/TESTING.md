# Testing

The suite is split by what it costs and what it proves. Keep it that way.

| Layer | Command | What belongs here |
| --- | --- | --- |
| Pure core | `npm test` (`src/**/*.test.ts`) | geometry, constraints, regions, migrations, rebuild keys, kernel numbers, screen-space rules. No DOM, no WASM worker unless the test is explicitly a kernel test. |
| Browser | `npm run e2e` (fail-fast, 4 workers locally) | the *wiring*: a gesture reaches the right document mutation, a popover edits the right feature, a failure is visible. |
| Whole picture | `npm run e2e:all` | what CI runs (1 worker). Local iteration uses the fail-fast script. |

## Fail fast, then ask "one cause?"

`npm run e2e` stops at the first failure (`--max-failures=1`). Fix that failure
before running the suite again. If several failures are obviously one cause (the
same volume number, the same missing test id), fix the cause; otherwise do not
collect a list of red tests and start at random.

## Layout

```
e2e/
  support/
    app.ts        fixture, resetExample(), volume/bounds readers, error collector
    sketch.ts     sketch-canvas gestures (millimetres -> screen via the SVG CTM)
    model.ts      viewport picking, hover scans, edge selection, camera settle
    workflow.ts   timeline/insert/support flows shared by feature tests
    fixtures.ts   documents built in the test process and opened through the UI
  example.spec.ts      the example document, region selection, timeline basics
  support.spec.ts      face/plane/datum sketches, projections, support loss
  blends.spec.ts       fillet/chamfer create, edit, fail, recover
  model-picking.spec.ts filters, Select Other, box/lasso
  extrude.spec.ts      extrude create/edit/cancel, symmetric, through-all
  shell.spec.ts        face multi-selection, box/lasso faces, shell create/edit/fail
  sketch.spec.ts       sketch tools, constraints, dimensions, region gestures
  documents.spec.ts    autosave, files, download/open, STL/STEP export, boot from a saved doc
```

Pick the file that owns the area; run only that file while iterating. On a
typical dev machine with four workers (including the Vite + WASM startup):

| Spec | Time | Spec | Time |
| --- | --- | --- | --- |
| `model-picking` | ~6 s | `extrude` | ~13 s |
| `blends` | ~10 s | `documents` | ~13 s |
| `example` | ~15 s | `sketch` | ~21 s |
| `shell` | ~13 s | `support` | ~25 s |

```bash
npx playwright test e2e/blends.spec.ts
npx playwright test e2e/sketch.spec.ts -g "dimension"
```

A new spec imports the fixture and opts into the shared reset:

```ts
import { expect, resetExample, test } from "./support/app";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});
```

The reset is one page evaluation for the view controls (day theme, yellow
highlighter, snap, auto grid, file menu) plus `load-example`, a click on the base
extrude, and a volume poll. `load-example` already selects the first sketch and
sets select/zoom-fit, so do not re-click those. If a new ephemeral UI mode
persists, add it to `resetExample`, not to the individual spec.

## Rules that keep a change cheap

1. **The example's dimensions live in one place.**
   `src/core/doc/exampleMetrics.ts` exports `EXAMPLE_PLATE`,
   `examplePlateVolume()`, `exampleSolidPlateVolume()`, `exampleBounds()` and
   `exampleVerticalEdgeMidpoints()`. The document, the sketch demo and the tests
   import them. Do not paste `60 * 40 * 12 - Math.PI * 8 * 8 * 12` into a test:
   resizing the example should be one edit, not thirty.
2. **Never assert a screen coordinate as a golden.** Derive it: `sketchPoint()`
   maps sketch millimetres through the SVG's screen CTM, `scanVisibleEdges()`
   finds hoverable model edges in one browser round trip. Pixel picks may only
   be used as *inputs* after being derived, never as expected values.
3. **Assert on authoritative state readouts.** The selection popover publishes
   `data-edge-refs` (faces: `data-face-refs`); the stage publishes `data-picked-face`,
   `data-hover-kind`,
   `data-hover-edge-length`,
   `data-hover-edge-ref` and `data-camera`; the mesh publishes bounds/volume/faces.
   A test that clicks a pixel and then guesses what got selected is a future
   flake. Click, read the readout, compare the stable ref.
4. **A still camera is a precondition.** `fitView()` and every orbit in a test
   must be followed by `waitForCameraSettled()`. Orbit damping moves the camera
   for several frames; a screen-space scan taken mid-drift can miss an edge on
   one row and hit it on another. Picking itself always refreshes the camera
   matrix, so a still camera is only needed for scans.
5. **One behaviour per test.** A failure should name the behaviour, not the
   setup. Share the setup helper, not the assertions. The fillet flow shows the
   trade-off: `createPlateFillet()` (fit, select four edges, apply) plus three
   focused tests costs ~12 s of CPU instead of ~8 s, because each test repays
   the shared setup, but a failure now names create / upstream edit / invalid
   radius, and running just that behaviour takes ~6 s instead of ~8 s.
6. **Interaction tests prove wiring, not maths.** If an assertion is about a
   volume, a bound, a face count or a solve outcome, the number belongs in a
   `core` test where it runs in milliseconds. The e2e test then checks that the
   UI shows that result (with `toBeCloseTo(..., -1)` tolerance where meshing
   sampling matters).
7. **The shared page is a fixture, not a dumping ground.** One worker-scoped
   page per worker keeps the WASM warm. Do not add `page.goto()` per test; a
   test that must boot from a saved document uses its own context on purpose
   (and still pays the shared reset, which is the price of the fixture).
8. **Test ids are part of the UI contract.** Popovers, tools, filters and
   readouts expose a `data-testid` (and, where useful, data attributes). Prefer
   them over CSS classes and text, which are visual decisions.

## Coverage map and deliberate overlap

There are no duplicate tests as of the split; the 88 browser tests each own a
behaviour. These pairs look similar but assert different invariants and should
stay separate:

- `the example's suppressed fillet/chamfer` (role remap on the authored
  document) vs `creates a fillet on four vertical edges` / `creates a chamfer`
  (creating a step from the UI).
- `flips a face sketch support and keeps that side stable` (side stability under
  a body edit) vs `keeps a face sketch attached when its source body changes`
  (downstream boss follows the face and its projections survive).
- `creates an offset datum plane and sketches on it` (support selected from the
  popover's datum list) vs `picks a datum plane and starts a sketch on it` (the
  datum is ray-picked in 3D).
- `box-selects profile regions` vs `lasso-selects profile regions` (window vs
  crossing rules).

If you think a test is redundant, check this list first, then delete the weaker
one only if the remaining test still fails when the behaviour breaks (revert the
fix locally and run it).

## When a fixture change ripples

If changing the example geometry touches more than the example's own files, the
suite is leaking a literal. Find it with:

```bash
rg '60 \* 40|Math\.PI \* 8|"-30,-20|data-count", "7"' e2e src
```

Every hit is either a shared constant that should move to `exampleMetrics.ts`
or a coordinate that should be derived by a helper. Fix the leak, not the
individual assertions.
