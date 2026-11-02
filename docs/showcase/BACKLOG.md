# Gap backlog

A decision record for Fusion 360 (Design / Solid) features that were **not yet in
`docs/PLAN.md`** when this was captured. The Keep/Low/Defer/Covered/Drop decisions and
open questions below were incorporated into `docs/PLAN.md` on 2026-11-02; the plan is now
the source of truth for milestones and status. Keep this file as the rationale/history
behind those placements.

Source: a feature-by-feature pass over the Solid tab and the sketch editor, plus a
Fusion-vs-FreeCAD-vs-SolveSpace comparison. Only features **we** are missing are listed;
features already done or already scheduled are not repeated.

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

## Keep

| Feature | Why it matters | Proposed home |
| --- | --- | --- |
| **Combine** — join / cut / **intersect**, keep tool bodies, use a body as a tool | The main way to use one body against another | M6 (elevate "general body booleans" to a real Combine feature) |
| **Split Body** — split with a plane / face / body, keep both halves | Break one body into two independent bodies | M6, alongside Combine |
| **Move / Copy** — bodies *and* sketch geometry | Reposition or duplicate without redrawing | M6 (bodies); **M6.0** (sketch, same grammar as pattern/mirror/offset) |
| **Align** | Line up bodies/faces without hand-measuring | M6 |
| **Section Analysis** | The one inspect tool that is used constantly | M5 — the first real *inspect* surface |
| **Redefine / edit sketch plane** | Change a sketch's support after creation | **M4** (partner of the support picker) |
| **Extrude start offset** | Start a solid away from the sketch plane | **M3** |
| **Extrude taper angle** | Drafted side walls without a separate Draft feature | **M3** |
| **Extrude intersect** | The third boolean operation | **M3** |
| **Extrude to-object / to-next** | End a solid against existing geometry | **M4** (needs `TopoRef`) |
| **Collinear** constraint | Common when aligning points/edges | Constraint + one `drag.ts` row (small) |
| **Center / 3-point rectangle** | Frequently used drawing variants | Sketch-create variants (small) |
| **Center-point / tangent arc** | Frequently used drawing variants | Sketch-create variants (small) |
| **2-point / 3-point circle** | Frequently used drawing variants | Sketch-create variants (small) |
| **Selection filters / Select Other** | Cycle overlapping picks; restrict to edges/faces | M5 selection UX (box/lasso is done, M2.9) |

## Low priority

| Feature | Note |
| --- | --- |
| **Polygon** (inscribed/circumscribed, N sides) | Used occasionally; a sketch-create variant |
| **Press/Pull** | Workaround is a sketch on the face; revisit only as *multi-face* offset/selection (pairs with M9 offset-face) |
| **Sketch projections** (project / include 3D / intersect / project-to-surface) | The subset that is wanted lands with M4; the rest waits |

## Defer to its own design pass

| Feature | Note |
| --- | --- |
| **Visibility toggles** — show/hide sketches, bodies, constraints, construction, dimensions; isolate; opacity | Real gap, but a coherent surface of its own. Do not bolt it on. |
| **Sketch operation rows nested in the timeline** | M6.0 says "can come later"; design with the timeline, not before |

## Covered — no new work needed

| Feature | How it is already reachable |
| --- | --- |
| **Concentric** | Two circles/arcs with a **coincident centre point** are concentric. Add Equal only if the radii must match too. The only work is UX convenience (auto-pick the centre); no new solver constraint. |
| **Curvature / Smooth (G2)** | Only meaningful for splines/Béziers, which are M9. Not applicable until then. |
| **Sketch region selection** (intersecting sub-profiles) | Done — planar arrangement + half-edge faces (M2). Both FreeCAD and SolveSpace require clean loops here. |

## Drop

Slot · Sketch scale · Sketch extend · Sketch chamfer · arc-length / tangent-distance /
ordinate dimensions · Rib · Web · Emboss · primitive bodies (box/cylinder/sphere/torus)
· silhouette split · replace / delete / offset face · boundary fill · stitch / unstitch
/ simplify · direct modeling ("Capture Design History", base feature, paste-new, derive).

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

- **Combine / Split Body:** are tool bodies a *selection* in the feature dialog, or a
  separate "bodies" list on the document? How do the result bodies keep stable identity
  (`TopoRef`) across a split?
- **Section Analysis:** is it a view-only overlay (never in history), and how does it
  relate to the visibility toggles above?
- **Move / Copy:** does it materialise (a one-shot transform) or persist as an operation
  like M6.0? For sketch geometry it should almost certainly persist; for bodies it is
  closer to a feature.
- **Sketch-create variants:** do the extra rectangle/circle/arc variants share one tool
  with a mode, or get their own tool-line entries? Fusion uses press-and-hold flyouts.
