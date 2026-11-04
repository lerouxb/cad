# Testing

The suite is split by what it costs and what it proves. Keep it that way.

| Layer | Command | What belongs here |
| --- | --- | --- |
| Pure core | `npm test` (`src/**/*.test.ts`) | geometry, constraints, regions, migrations, rebuild keys, kernel numbers, screen-space rules. No DOM, no WASM worker unless the test is explicitly a kernel test. |
| Browser | `npm run e2e` (fail-fast) | the *wiring*: a gesture reaches the right document mutation, a popover edits the right feature, a failure is visible. |
| Whole picture | `npm run e2e:all` | what CI runs. Local iteration uses the fail-fast script. |

## Fail fast, then ask "one cause?"

`npm run e2e` stops at the first failure (`--max-failures=1`). Fix that failure
before running the suite again. If several failures are obviously one cause (the
same volume number, the same missing test id), fix the cause; otherwise do not
collect a list of red tests and start at random.

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
   `data-edge-refs`; the stage publishes `data-hover-kind`, `data-hover-edge-length`
   and `data-hover-edge-ref`; the mesh publishes bounds/volume/faces. A test that
   clicks a pixel and then guesses what got selected is a future flake. Click,
   read the readout, compare the stable ref.
4. **One behaviour per test.** The blend suite used to be a 100-line create →
   volume → edit height → impossible radius → recover flow. Split it when you
   touch it: a failure should name the behaviour, not the setup. Share the setup
   helper, not the assertions.
5. **Interaction tests prove wiring, not maths.** If an assertion is about a
   volume, a bound, a face count or a solve outcome, the number belongs in a
   `core` test where it runs in milliseconds. The e2e test then checks that the
   UI shows that result (with `toBeCloseTo(..., -1)` tolerance where meshing
   sampling matters).
6. **The shared page is a fixture, not a dumping ground.** One worker-scoped
   page per worker keeps the WASM warm. Every new ephemeral UI mode must be
   reset in the shared `beforeEach` (theme, highlighter, grid, snap, zoom,
   selection filters and tool, open editor). If a test needs a different
   starting document, load it through the UI or the file dialog inside the test
   and restore the example at the end; do not mutate the previous test's state.
7. **Test ids are part of the UI contract.** Popovers, tools, filters and
   readouts expose a `data-testid` (and, where useful, data attributes). Prefer
   them over CSS classes and text, which are visual decisions.

## Splitting the browser suite

`e2e/smoke.spec.ts` is one file because it started as one smoke test. Split it
by area as each area is touched, keeping the shared page fixture:

- `example` — goldens, dimensions, the document's shape
- `sketch` — tools, constraints, dimensions, trim, marquee profiles
- `model-picking` — filters, Select Other, box/lasso, hover readouts
- `blends` — fillet/chamfer create, edit, fail, recover
- `history` — timeline cursor, rebuild, suppress, datum chains
- `documents` — files, autosave, theme, appearance

Helpers move to `e2e/support/` (`app.ts` fixture + reset, `sketch.ts`,
`model.ts`, `metrics.ts`) so a new spec is a few imports, not a copy of the
1,000-line preamble. Each file gets its own worker-scoped page, so parallel
files still share no state *within* a file's tests.

## When a fixture change ripples

If changing the example geometry touches more than the example's own files, the
suite is leaking a literal. Find it with:

```bash
rg '60 \* 40|Math\.PI \* 8|"-30,-20|data-count", "7"' e2e src
```

Every hit is either a shared constant that should move to `exampleMetrics.ts`
or a coordinate that should be derived by a helper. Fix the leak, not the
individual assertions.
