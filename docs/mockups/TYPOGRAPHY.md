# Typography

The mockups are typography-led, so the type system is the design system. This is a
small, enforced contract: three families, eight app roles, and a separate
editorial layer for the design-document page.

See the [specimen page](typography.html) for every role in the browser.

## Families

| Token | Family | Use |
| --- | --- | --- |
| `--font-sans` | System sans | Prose, notes, long explanatory copy |
| `--font-serif` | Iowan / Palatino / Georgia | Names, titles, body names, file names |
| `--font-mono` | System mono | Labels, controls, measurements, data, metadata |

No new family is added without a deliberate decision and a note here.

## App roles

| Token | Family | Size | Weight | Leading | Tracking | Use |
| --- | --- | --- | --- | --- | --- | --- |
| `--type-display` | Serif | 27 | 400 | `--leading-display` | `--tracking-display` | Panel, body, export and error titles |
| `--type-name` | Serif | 17 | 400 | `--leading-name` | `--tracking-name` | File name, timeline step, body name |
| `--type-row` | Serif | 15 | 400 | `--leading-row` | `--tracking-row` | Support rows, file rows, material names |
| `--type-prose` | Sans | 12 | 400 | `--leading-prose` | `--tracking-prose` | Notes, descriptions, error copy |
| `--type-control` | Mono | 9.5 | 400 | `--leading-control` | `--tracking-control` | Actions, tools, view controls |
| `--type-value` | Mono | 10 | 400 | `--leading-value` | `--tracking-value` | Measurements and state values |
| `--type-label` | Mono | 9 | 500 | `--leading-label` | `--tracking-label` | Uppercase labels and section heads |
| `--type-micro` | Mono | 8.5 | 400 | `--leading-micro` | `--tracking-micro` | Step meta, timestamps, tiny notes |

Weights are limited to `--weight-regular` (400), `--weight-medium` (500) and
`--weight-strong` (600). There are no 550/650/700 one-offs.

## Editorial layer

The index is a design document, not an app surface. It gets three deliberate
exceptions:

| Token | Use |
| --- | --- |
| `--type-editorial-display` | Index headline, fluid `clamp(46px, 7.5vw, 86px)` |
| `--type-editorial-title` | Study titles, 28px |
| `--type-editorial-lede` | Index introduction, 15px |

These do not leak into the app. App screens use the eight roles above.

## Rules

1. **Every text element maps to a role.** If no role fits, add a deliberate
   token here instead of inventing a one-off size.
2. **No raw typography values outside the token block.** Component rules use
   `var(--type-*)`, `var(--font-*)`, `var(--weight-*)`, `var(--leading-*)` and
   `var(--tracking-*)`.
3. **Uppercase is a label treatment**, not a heading treatment.
4. **Numbers, measurements and state values are mono.**
5. **Names and titles are serif.** Prose is sans.
6. **Leading and tracking belong to the role**, not to individual components.
7. **The highlighter is colour, not type.** Typography stays ink; the marker is
   a state treatment.

## Audit

```bash
node docs/mockups/check-typography.mjs
```

The check:

- skips the central `/* typography tokens: start|end */` block;
- fails on any raw `font-family`, `font-size`, `font-weight`, `line-height` or
  `letter-spacing` outside it;
- fails if the token block has a family, role or weight that is not in the
  expected list;
- fails if a component references a typography token that is not defined;
- scans HTML inline styles for typography declarations.

Adding a family or role is therefore a deliberate change: update this document and
the expected list in `check-typography.mjs` together.

Current result:

```
Typography audit passed: 3170 CSS lines checked, no raw font/leading/tracking values outside the token block.
```

## Applying it to the app

The React app should import the same values, either as CSS variables or as a
typed token map. If the app later uses CSS-in-JS or utility classes, keep one
source of truth and extend this audit to the app styles. The roles are the
contract; the implementation can change.
