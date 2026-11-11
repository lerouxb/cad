# Gap backlog

A decision record for Fusion 360 (Design / Solid) features that were **not yet in
`docs/PLAN.md`** when this was captured. The Keep/Low/Defer/Covered/Drop decisions, the
2026-11-02 design audit, and the open questions below were incorporated into
`docs/PLAN.md`; the plan is now the source of truth for milestones and status. Keep this
file as the rationale/history behind those placements.

Source: a feature-by-feature pass over the Solid tab and the sketch editor, plus a
Fusion-vs-FreeCAD-vs-SolveSpace comparison. Only features **we** are missing are listed;
features already done or already scheduled are not repeated.

**Addendum, 2026-11-02:** the real part (`Disqo / rounded-square`) was read through the
Fusion MCP and the audit changed two decisions — see
[Design audit](#design-audit--what-the-real-part-uses-2026-11-02).

Several Keep items now have interactive design targets in this folder:
**combine + split body** ([`body-ops.html`](body-ops.html)), **move/copy + align**
([`transform.html`](transform.html)), **extrude start/end/taper/operation**
([`extrude.html`](extrude.html)), **section analysis**
([`inspect.html`](inspect.html)), **sketch pattern/mirror/offset/move**
([`index.html`](index.html)), and the **create variants**
([`sketch-create.html`](sketch-create.html)).

Status vocabulary: **Keep** (wanted, with a proposed home) · **Low** (nice, not soon) ·
**Defer** (wanted, but needs its own design pass) · **Drop** (decided no) ·
**Covered** (reachable with existing tools, no new work).

## Design audit — what the real part uses (2026-11-02)

`Disqo / rounded-square` was read through the Fusion MCP (read-only): **113 timeline
steps, 14 sketches, 17 components**, nothing suppressed. It is an **assembly**, not a
single body — the `case` component alone has a body and a lid, and vendor STEP models
are inserted as components.

| Feature | Uses | In the plan? |
| --- | --- | --- |
| Sketch | 14 | done (M1) |
| Extrude | ~38 | done (M2/M3); options M3/M4 |
| **Offset Faces** | **11** | **was Drop → now Keep** |
| Chamfer | 6 | M5 |
| Combine | 6 | M6 (BACKLOG) |
| Fillet | 5 | M5 |
| Construction plane | 4 | M4 (offset + midplane) |
| Mirror | 4 | M6 |
| Rectangular pattern | 2 | M6 |
| Circular pattern | 1 | M6 |
| Shell | 1 | M5 |
| Split Body | 1 | M6 (BACKLOG) |
| Move (free) | 1 | M6 (BACKLOG) |
| Component insert | 6 | M8 |
| Rigid Group | 1 | M8 |
| Snapshot / capture position | 2 | not planned (M8) |
| Timeline group | 10 | now Keep (M3/M6) |

Conclusions:

1. **Offset Faces is not a Drop.** It is the third most-used modelling feature after
   extrude and chamfer, and every use is a tolerance/fit adjustment ("tolerance for
   glass", "pcb-tolerance", "gasket tolerance", "enlarge battery space", …). Moved to
   **Keep**.
2. **The real workflow is an assembly.** Components are inserted (many as STEP),
   positioned, rigid-grouped, and the case is cut around them. The plan's single-body
   scope — assemblies are M8 — is the largest structural gap between the plan and the
   part it is meant to make.
3. **The M6 feature items are not speculative:** patterns, mirror, combine and split
   body are all used.
4. **Timeline groups are used heavily (10).** Grouping is part of the real workflow,
   not a nicety.
5. **Not used at all:** revolve, loft, sweep, draft, hole/thread, primitives, thicken,
   boundary fill, delete/replace face — so those remain Low/M9/Drop.

## Keep

| Feature | Why it matters | Proposed home |
| --- | --- | --- |
| **Combine** — join / cut / **intersect**, keep tool bodies, use a body as a tool | The main way to use one body against another | M6 (elevate "general body booleans" to a real Combine feature); preview language in [`BOOLEANS.md`](BOOLEANS.md) |
| **Split Body** — split with a plane / face / body, keep both halves | Break one body into two independent bodies | M6, alongside Combine |
| **Move / Copy** — bodies *and* sketch geometry | Reposition or duplicate without redrawing | M6 (bodies); **M6.0** (sketch, same grammar as pattern/mirror/offset) |
| **Align** | Line up bodies/faces without hand-measuring | M6 |
| **Section Analysis** | The one inspect tool that is used constantly | M5 — the first real *inspect* surface |
| **Redefine / edit sketch plane** | Change a sketch's support after creation | **M4** (partner of the support picker) |
| **Extrude start offset** | Start a solid away from the sketch plane | **M3** |
| **Extrude taper angle** | Drafted side walls without a separate Draft feature | **M3** |
| **Extrude intersect** | The fourth operation; the shared row is `new body`/`join`/`cut`/`intersect` | **M3** (see [`BOOLEANS.md`](BOOLEANS.md)) |
| **Extrude to-object / to-next** | End a solid against existing geometry | **M4** (needs `TopoRef`) |
| **Collinear** constraint | Common when aligning points/edges | Constraint + one `drag.ts` row (small) |
| **Center / 3-point rectangle** | Frequently used drawing variants | Sketch-create variants (small) |
| **Center-point / tangent arc** | Frequently used drawing variants | Sketch-create variants (small) |
| **2-point / 3-point circle** | Frequently used drawing variants | Sketch-create variants (small) |
| **Selection filters / Select Other** | Cycle overlapping picks; restrict to edges/faces | M5 selection UX (box/lasso is done, M2.9) |
| **Offset Faces** | Offset a face by a distance — tolerance/fit and wall adjustments. **Used 11× in the real part.** Design: [`OFFSET_FACES.md`](OFFSET_FACES.md). | **M5/M6** (reversed from *Drop* by the design audit) |
| **Component insert / occurrences** | Insert parts (including imported STEP) into an assembly | **M8** |
| **Rigid Group** | Fix a set of components together | **M8** |
| **Capture Position / Snapshot** | Record and restore component positions | **M8** |
| **Timeline groups** | Collapse related steps into one named group | **M3/M6** (timeline refinement) |

## Low priority

| Feature | Note |
| --- | --- |
| **Polygon** (inscribed/circumscribed, N sides) | Used occasionally; a sketch-create variant |
| **Press/Pull** | Workaround is a sketch on the face; revisit only as *multi-face* offset/selection (pairs with M9 offset-face) |
| **Revolve / lathe** | Not used in the reference part; M5 v1 is implemented (see [`REVOLVE.md`](REVOLVE.md)); further work is low priority |
| **Sketch projections** (project / include 3D / intersect / project-to-surface) | The subset that is wanted lands with M4; the rest waits |

## Defer to its own design pass

| Feature | Note |
| --- | --- |
| **Visibility toggles** — show/hide sketches, bodies, constraints, construction, dimensions; isolate; opacity | Real gap, but a coherent surface of its own. Do not bolt it on. |
| **Sketch operation rows nested in the timeline** | Resolved: pattern / mirror / offset are **sketch objects**, not timeline steps — the sketch step's detail lists them. Nothing to nest. See [`TIMELINE.md`](TIMELINE.md). |

## Covered — no new work needed

| Feature | How it is already reachable |
| --- | --- |
| **Concentric** | Two circles/arcs with a **coincident centre point** are concentric. Add Equal only if the radii must match too. The only work is UX convenience (auto-pick the centre); no new solver constraint. |
| **Curvature / Smooth (G2)** | Only meaningful for splines/Béziers, which are M9. Not applicable until then. |
| **Sketch region selection** (intersecting sub-profiles) | Done — planar arrangement + half-edge faces (M2). Both FreeCAD and SolveSpace require clean loops here. |

## Drop

Slot · Sketch scale · Sketch extend · Sketch chamfer · arc-length / tangent-distance /
ordinate dimensions · Rib · Web · Emboss · primitive bodies (box/cylinder/sphere/torus)
· silhouette split · replace / delete face · boundary fill · stitch / unstitch
/ simplify · direct modeling ("Capture Design History", base feature, paste-new, derive).

(Offset face was here and is now **Keep** — see the design audit.)

## Where we already match or beat FreeCAD / SolveSpace

The comparison is against Fusion, not against the OSS tools. On the OSS axis we are
already ahead in several places, which is worth not regressing:

- **Sketch region selection** — intersecting sub-profiles, done.
- **Visual history timeline** — both OSS tools lack Fusion's form; M3 is building it.
- **Construction geometry** — native everywhere, done.
- **Adaptive grid, free-form step, scale bar** — beyond both.
- **Topological naming** — `TopoRef` + `updateRoles` from day one, i.e. FreeCAD-v1.0+
  territory rather than the old TNFR problem.
- **Constraint / dimension set** — larger than SolveSpace's and close to FreeCAD's.

## Open design questions

**Resolved since the first pass (2026-11-03):**

- **Body appearance** is **document data**, attached to the body-creating feature.
  It round-trips in `.cad`, and a re-skin is an undoable edit. No mockup needed —
  the decision is enough (the `08-body.html` study already shows the shape).
- **Move / Copy bodies** is a **persistent operation**, not a materialised
  transform. It stays re-editable and downstream steps follow it, like the sketch
  layout operations (ADR-0004). Design work is small: it reuses the
  `transform.html` popover and reads as a normal history step — a *move*
  references its body (`→`), a *copy* produces a new body chip (`+`).
- **Combine / Split Body:** tool bodies are a **selection in the feature popover**,
  not a second document list, so the timeline stays the only structure. A split
  mints **new body ids with a role + geometry `TopoRef`** so downstream references
  can recover.
- **Feature input pickers (2026-11-10):** [`PICKS.md`](PICKS.md) is implemented in
  the forms. Blends force the `edges` filter; revolve has a profile
  `select`/`pick in sketch` row, a `Profile N` list and an
  `axis · line N · construction · pick` candidate mode; extrude lists its profiles
  above the value; every multi input is a scrolling row + list before its value.
  The project form uses the same rows/lists and cancels on an empty model click.
- **Sketch-create variants (2026-11-10):** resolved as one tool plus the shared
  **tool options row** under the tool line (`corner/center/3-point` rectangle,
  `center/2-/3-point` circle, `3-point/centre/tangent` arc). No separate tool-line
  entries or flyouts.

**Still open:**

- **Single-candidate support picker:** [`PICKS.md`](PICKS.md) says a support uses a
  row + `pick`, while the new-sketch support picker still lists world planes, the
  picked face and datum planes. Decide whether that picker is exempt or moves to
  the row + `pick` shape (also tracked in `PLAN.md`).
- **Section Analysis:** is it a view-only overlay (never in history), and how does
  it relate to the visibility toggles? The visibility direction is now "per body,
  folded into the output chip, no second list" — see
  [`TIMELINE.md`](TIMELINE.md).
- **Feature draft view:** an extrude/revolve draft should open on the model, not
  stay in the sketch. [`DRAFT_VIEW.md`](DRAFT_VIEW.md) proposes one scene, two
  cameras, profile/axis picking in 3D and `look at sketch` as a view preset. It
  is designed but not implemented; `beginExtrudeDraft`/`beginRevolveDraft` still
  set the sketch stage.
