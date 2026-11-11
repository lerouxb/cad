/*
 * The draft leaves the sketch: a feature that consumes sketch geometry opens
 * on the model, with the source sketch on its plane. Profiles and the revolve
 * axis stay pickable in 3D, and the camera can return to the normal view
 * without leaving the draft.
 *
 * Design target only — not imported by src/. See docs/showcase/DRAFT_VIEW.md.
 */
(function () {
  "use strict";

  var K = Math.sqrt(3) / 2;
  var VIEW = { cx: 560, cy: 400, s: 2.7 };
  var TAU = Math.PI * 2;
  var REDUCED =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var EX_REGION_ORDER = ["a", "b", "c"];
  var EX_REGIONS = {
    a: {
      id: "a",
      kind: "rect",
      x1: -34, x2: -4, y1: -16, y2: 16,
      area: 960
    },
    b: {
      id: "b",
      kind: "circle",
      cx: 24, cy: 0, r: 12,
      area: 452
    },
    c: {
      id: "c",
      kind: "rect",
      x1: -34, x2: -4, y1: -26, y2: -20,
      area: 180
    }
  };

  var EX_BASE = { x1: -60, x2: 60, y1: -40, y2: 40, z1: -12, z2: 0 };
  var EX_PLANE = { x1: -52, x2: 52, y1: -36, y2: 36 };
  var RE_PROFILE = { x1: 12, x2: 36, y1: -10, y2: 10, area: 480 };
  var RE_PLANE = { x1: -62, x2: 62, y1: -40, y2: 40 };

  // A candidate axis is a line in the sketch plane. The X axis crosses the
  // revolve profile, so it is a deliberate visible error in the study.
  var AXES = {
    line1: {
      id: "line1",
      label: "line 1 · construction",
      short: "line 1",
      construction: true,
      a: [-14, -60], b: [-14, 60],
      valid: true
    },
    line2: {
      id: "line2",
      label: "line 2 · construction",
      short: "line 2",
      construction: true,
      a: [4, -60], b: [4, 60],
      valid: true
    },
    x: {
      id: "x",
      label: "X axis",
      short: "X axis",
      construction: false,
      a: [-72, 0], b: [72, 0],
      valid: false
    },
    y: {
      id: "y",
      label: "Y axis",
      short: "Y axis",
      construction: false,
      a: [0, -60], b: [0, 60],
      valid: true
    }
  };
  var AXIS_ORDER = ["line1", "line2", "x", "y"];

  var state = {
    scene: "extrude",
    view: 0, // 0 = 3/4 drafting camera, 1 = normal to the sketch plane
    pick: null, // null | "profiles" | "axis"
    open: true,
    applied: false,
    status: null, // "apply" | "cancel" | null
    profiles: { a: true, b: true, c: false },
    revolveSelected: true,
    height: 18,
    operation: "join",
    axis: "line1",
    angle: 140,
    hoverRegion: null,
    hoverAxis: null,
    hoverHandle: false
  };

  var els = {};
  var tween = null;
  var drag = null;
  var suppressClick = false;

  /* ------------------------------------------------------------------ */
  /* projection and 3D helpers                                          */
  /* ------------------------------------------------------------------ */

  function project(p) {
    var isoX = VIEW.cx + (p[0] - p[1]) * K * VIEW.s;
    var isoY = VIEW.cy + (p[0] + p[1]) * 0.5 * VIEW.s - p[2] * VIEW.s;
    var topX = VIEW.cx + p[0] * VIEW.s;
    var topY = VIEW.cy - p[1] * VIEW.s;
    var t = state.view;
    return [isoX + (topX - isoX) * t, isoY + (topY - isoY) * t];
  }

  function depth(p) {
    return (1 - state.view) * (p[0] + p[1] + p[2]) + state.view * p[2];
  }

  function faceDepth(points) {
    var sum = 0;
    for (var i = 0; i < points.length; i++) sum += depth(points[i]);
    return sum / points.length;
  }

  function fmt(n) {
    return n.toFixed(1);
  }

  function pts2(points) {
    return points
      .map(function (p) {
        var q = project(p);
        return fmt(q[0]) + "," + fmt(q[1]);
      })
      .join(" ");
  }

  function poly3(points, cls) {
    return '<polygon class="' + cls + '" points="' + pts2(points) + '"/>';
  }

  function line3(a, b, cls) {
    var pa = project(a);
    var pb = project(b);
    return (
      '<line class="' + cls + '" x1="' + fmt(pa[0]) + '" y1="' + fmt(pa[1]) +
      '" x2="' + fmt(pb[0]) + '" y2="' + fmt(pb[1]) + '"/>'
    );
  }

  function label3(p, text, cls, anchor, dx, dy) {
    var q = project(p);
    return (
      '<text class="' + (cls || "draft-label") + '" x="' + fmt(q[0] + (dx || 0)) +
      '" y="' + fmt(q[1] + (dy || 0)) + '"' +
      (anchor ? ' text-anchor="' + anchor + '"' : "") + ">" + text + "</text>"
    );
  }

  function rectPoly(x1, x2, y1, y2, z) {
    return [
      [x1, y1, z], [x2, y1, z], [x2, y2, z], [x1, y2, z]
    ];
  }

  function circlePoly(cx, cy, r, z, n) {
    var out = [];
    var count = n || 44;
    for (var i = 0; i < count; i++) {
      var a = (i / count) * TAU;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
    }
    return out;
  }

  function regionPolygon(region, z) {
    if (region.kind === "circle") {
      return circlePoly(region.cx, region.cy, region.r, z);
    }
    return rectPoly(region.x1, region.x2, region.y1, region.y2, z);
  }

  function regionCentroid(region) {
    if (region.kind === "circle") return [region.cx, region.cy];
    return [(region.x1 + region.x2) / 2, (region.y1 + region.y2) / 2];
  }

  /* ------------------------------------------------------------------ */
  /* face builders                                                      */
  /* ------------------------------------------------------------------ */

  function boxFaces(b, cls) {
    var c = function (x, y, z) {
      return [
        x ? b.x2 : b.x1,
        y ? b.y2 : b.y1,
        z ? b.z2 : b.z1
      ];
    };
    // The camera always sits in the +x/+y/+z octant, so only the top and the
    // two front sides can be seen. Omitting the back faces keeps a translucent
    // preview from reading as a glass box.
    return [
      { pts: [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)], cls: cls || "is-top", priority: 1 },
      { pts: [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)], cls: cls || "is-x", priority: 0 },
      { pts: [c(0, 1, 0), c(1, 1, 0), c(1, 1, 1), c(0, 1, 1)], cls: cls || "is-y", priority: 0 }
    ];
  }

  function cylinderFaces(cx, cy, r, z1, z2, cls) {
    var n = 42;
    var faces = [];
    var bottom = [];
    var top = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU;
      bottom.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z1]);
      top.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z2]);
    }
    faces.push({ pts: top, cls: cls || "is-top", priority: 1 });
    for (var j = 0; j < n; j++) {
      var k = (j + 1) % n;
      var mid = ((j + 0.5) / n) * TAU;
      // only the camera-facing half of the wall
      if (Math.cos(mid) + Math.sin(mid) <= 0.02) continue;
      var side = Math.abs(Math.cos(mid)) >= Math.abs(Math.sin(mid))
        ? "is-x"
        : "is-y";
      faces.push({
        pts: [bottom[j], bottom[k], top[k], top[j]],
        cls: (cls || side) + " is-curved"
      });
    }
    return faces;
  }

  function annularSector(ax, rOuter, rInner, a0, a1, y, zOffset) {
    var n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / (TAU / 64)));
    var out = [];
    var i;
    for (i = 0; i <= n; i++) {
      var a = a0 + (a1 - a0) * (i / n);
      out.push([ax + Math.cos(a) * rOuter, y, Math.sin(a) * rOuter + (zOffset || 0)]);
    }
    for (i = n; i >= 0; i--) {
      var b = a0 + (a1 - a0) * (i / n);
      out.push([ax + Math.cos(b) * rInner, y, Math.sin(b) * rInner + (zOffset || 0)]);
    }
    return out;
  }

  function tubeFaces(ax, rInner, rOuter, y1, y2, angle, cls) {
    var faces = [];
    var n = Math.max(8, Math.ceil((Math.abs(angle) / TAU) * 56));
    var full = Math.abs(angle) >= TAU - 1e-4;
    var i;

    function radial(r, a, y) {
      return [ax + Math.cos(a) * r, y, Math.sin(a) * r];
    }

    for (i = 0; i < n; i++) {
      var a0 = (i / n) * angle;
      var a1 = ((i + 1) / n) * angle;
      var mid = (a0 + a1) / 2;
      var side = Math.cos(mid) >= 0 ? "is-x" : "is-y";
      faces.push({
        pts: [
          radial(rOuter, a0, y1), radial(rOuter, a1, y1),
          radial(rOuter, a1, y2), radial(rOuter, a0, y2)
        ],
        cls: (cls || side) + " is-curved",
        priority: 0
      });
      faces.push({
        pts: [
          radial(rInner, a1, y1), radial(rInner, a0, y1),
          radial(rInner, a0, y2), radial(rInner, a1, y2)
        ],
        cls: (cls || "is-bottom") + " is-curved",
        priority: 0
      });
    }

    // The end annuli are drawn after the walls so the bore stays readable.
    faces.push({
      pts: annularSector(ax, rOuter, rInner, 0, angle, y1),
      cls: cls || "is-top",
      priority: 1
    });
    faces.push({
      pts: annularSector(ax, rOuter, rInner, 0, angle, y2),
      cls: cls || "is-top",
      priority: 1
    });

    if (!full) {
      faces.push({
        pts: [
          radial(rInner, 0, y1), radial(rOuter, 0, y1),
          radial(rOuter, 0, y2), radial(rInner, 0, y2)
        ],
        cls: cls || "is-x",
        priority: 2
      });
      faces.push({
        pts: [
          radial(rInner, angle, y1), radial(rOuter, angle, y1),
          radial(rOuter, angle, y2), radial(rInner, angle, y2)
        ],
        cls: cls || "is-y",
        priority: 2
      });
    }
    return faces;
  }

  function renderFaces(faces) {
    faces.sort(function (a, b) {
      var pa = a.priority || 0;
      var pb = b.priority || 0;
      if (pa !== pb) return pa - pb;
      return faceDepth(a.pts) - faceDepth(b.pts);
    });
    var html = "";
    for (var i = 0; i < faces.length; i++) {
      html += poly3(faces[i].pts, "draft-face " + (faces[i].cls || ""));
    }
    return html;
  }

  /* ------------------------------------------------------------------ */
  /* plane and sketch overlay                                           */
  /* ------------------------------------------------------------------ */

  function renderPlane(plane) {
    var html = poly3(
      rectPoly(plane.x1, plane.x2, plane.y1, plane.y2, 0.02),
      "draft-plane"
    );
    var step = 12;
    for (var x = Math.ceil(plane.x1 / step) * step; x <= plane.x2; x += step) {
      html += line3([x, plane.y1, 0.02], [x, plane.y2, 0.02], "draft-plane-grid");
    }
    for (var y = Math.ceil(plane.y1 / step) * step; y <= plane.y2; y += step) {
      html += line3([plane.x1, y, 0.02], [plane.x2, y, 0.02], "draft-plane-grid");
    }
    return html;
  }

  function planeBorder(plane) {
    return poly3(
      rectPoly(plane.x1, plane.x2, plane.y1, plane.y2, 0.035),
      "draft-plane-border"
    );
  }

  function extrudeRegionClass(id) {
    var cls = "draft-region";
    if (state.profiles[id]) cls += " is-selected";
    else cls += " is-material";
    if (state.pick !== "profiles" && !state.profiles[id]) cls += " is-dim";
    return cls;
  }

  function renderExtrudeRegions() {
    // The preview body is the subject while the value is being tuned. The
    // source profile returns as a wash only when the body ghosts for picking;
    // otherwise the solid body owns the plane and the outline would read as a
    // wireframe through it.
    if (state.pick !== "profiles" || !state.open) return "";
    var html = "";
    for (var i = 0; i < EX_REGION_ORDER.length; i++) {
      var id = EX_REGION_ORDER[i];
      var region = EX_REGIONS[id];
      html += poly3(regionPolygon(region, 0.04), extrudeRegionClass(id));
    }
    return html;
  }

  function renderRevolveProfile() {
    var cls = "draft-region is-material";
    if (state.revolveSelected) cls += " is-selected";
    if (state.pick === "axis") cls += " is-dim";
    return poly3(
      rectPoly(RE_PROFILE.x1, RE_PROFILE.x2, RE_PROFILE.y1, RE_PROFILE.y2, 0.04),
      cls
    );
  }

  /* ------------------------------------------------------------------ */
  /* the extrude scene                                                  */
  /* ------------------------------------------------------------------ */

  function selectedExtrudeIds() {
    return EX_REGION_ORDER.filter(function (id) {
      return state.profiles[id];
    });
  }

  function extrudeOperationInvalid() {
    return state.operation === "cut" || state.operation === "intersect";
  }

  function extrudePreviewFaces(cls) {
    var ids = selectedExtrudeIds();
    var faces = [];
    for (var i = 0; i < ids.length; i++) {
      var region = EX_REGIONS[ids[i]];
      if (region.kind === "circle") {
        faces = faces.concat(
          cylinderFaces(region.cx, region.cy, region.r, 0, state.height, cls)
        );
      } else {
        faces = faces.concat(
          boxFaces(
            {
              x1: region.x1, x2: region.x2, y1: region.y1, y2: region.y2,
              z1: 0, z2: state.height
            },
            cls
          )
        );
      }
    }
    return faces;
  }

  function renderExtrudeScene() {
    var baseFaces = boxFaces(EX_BASE);
    var ids = selectedExtrudeIds();
    var showPreview = state.open || state.applied;
    var previewFaces = [];
    var tintFaces = [];

    if (showPreview) {
      if (!state.applied && state.operation === "join") {
        // The body is opaque; the added volume is a highlighter diff over it.
        previewFaces = extrudePreviewFaces(null);
        tintFaces = extrudePreviewFaces("is-added");
      } else if (!state.applied && state.operation === "cut") {
        tintFaces = extrudePreviewFaces("is-removed");
      } else if (!state.applied && state.operation === "intersect") {
        tintFaces = extrudePreviewFaces("is-ghost");
      } else {
        previewFaces = extrudePreviewFaces(null);
      }
    }

    var bodyClass = "draft-body" +
      (state.pick && state.open ? " is-ghost" : "");
    // The base is context and always sits behind the preview; a large base
    // face must not be depth-sorted against a small preview face, or it paints
    // over the preview it is underneath.
    els.body.innerHTML =
      '<g class="' + bodyClass + '">' + renderFaces(baseFaces) +
      renderFaces(previewFaces) +
      (tintFaces.length > 0
        ? '<g class="draft-tint">' + renderFaces(tintFaces) + "</g>"
        : "") +
      "</g>";

    var overlay = planeBorder(EX_PLANE);
    overlay += renderExtrudeRegions();

    // the distance arrow and its drag handle, only in the drafting camera
    if (state.open && ids.length > 0 && state.view < 0.86) {
      var anchor2 = regionCentroid(EX_REGIONS[ids[0]]);
      var base = [anchor2[0], anchor2[1], 0.05];
      var top = [anchor2[0], anchor2[1], state.height];
      var pb = project(base);
      var pt = project(top);
      overlay +=
        '<line class="draft-arrow" x1="' + fmt(pb[0]) + '" y1="' + fmt(pb[1]) +
        '" x2="' + fmt(pt[0]) + '" y2="' + fmt(pt[1]) + '"/>';
      // arrow head at the top, pointing up in screen space
      overlay +=
        '<polygon class="draft-arrow-head" points="' +
        fmt(pt[0]) + "," + fmt(pt[1]) + " " +
        fmt(pt[0] - 5) + "," + fmt(pt[1] + 10) + " " +
        fmt(pt[0] + 5) + "," + fmt(pt[1] + 10) + '"/>';
      overlay +=
        '<circle class="draft-handle" cx="' + fmt(pt[0]) + '" cy="' + fmt(pt[1]) +
        '" r="5" data-handle="height"/>';
      overlay += label3(top, state.height.toFixed(1) + " mm", "draft-label", "start", 12, -8);
    }

    // the plane label is quiet and never competes with the profile
    overlay += label3([EX_PLANE.x1 + 4, EX_PLANE.y1 + 4, 0.05], "sketch plane", "draft-label is-quiet");

    els.grid.innerHTML = renderPlane(EX_PLANE);
    els.overlay.innerHTML = overlay;
    renderHover();
  }

  /* ------------------------------------------------------------------ */
  /* the revolve scene                                                  */
  /* ------------------------------------------------------------------ */

  function revolveOperationClass() {
    if (state.applied) return null;
    if (state.operation === "new") return null;
    // There is no target body in this scene, so every non-new operation is a
    // visible error; ghost the result instead of pretending it joined.
    return "is-ghost";
  }

  function revolveOperationInvalid() {
    return state.operation !== "new";
  }

  function axisRadii() {
    var ax = AXES[state.axis] ? AXES[state.axis].a[0] : 0;
    var r1 = RE_PROFILE.x1 - ax;
    var r2 = RE_PROFILE.x2 - ax;
    if (r1 > r2) {
      var t = r1;
      r1 = r2;
      r2 = t;
    }
    return { ax: ax, r1: Math.max(0, r1), r2: Math.max(0, r2) };
  }

  function axisPoints(axis) {
    var a = axis.a;
    var b = axis.b;
    return [
      [a[0], a[1], 0.045],
      [b[0], b[1], 0.045]
    ];
  }

  function axisLabelPoint(axis, bottom) {
    var a = axis.a;
    var b = axis.b;
    // The chosen axis labels at the top end; references label at the bottom so
    // two parallel lines never stack their labels at the same end.
    var pa = project([a[0], a[1], 0.045]);
    var pb = project([b[0], b[1], 0.045]);
    if (bottom) return pa[1] > pb[1] ? [a[0], a[1], 0.045] : [b[0], b[1], 0.045];
    return pa[1] < pb[1] ? [a[0], a[1], 0.045] : [b[0], b[1], 0.045];
  }

  function renderAxis(axis, mode) {
    var pts = axisPoints(axis);
    var mark = "draft-axis-mark";
    var ink = "draft-axis-ink";
    if (mode === "candidate" || mode === "reference") {
      mark += " is-candidate";
      ink += " is-candidate";
    }
    if (mode === "hover") {
      mark += " is-hover";
      ink += " is-hover";
    }
    if (!axis.valid && mode !== "reference") {
      mark += " is-invalid";
      ink += " is-invalid";
    }
    var html = line3(pts[0], pts[1], mark);
    html += line3(pts[0], pts[1], ink);
    var reference = mode === "reference";
    html += label3(
      axisLabelPoint(axis, reference),
      axis.short,
      "draft-label" + (axis.valid ? "" : " is-invalid"),
      "middle",
      0,
      reference ? 18 : -9
    );
    return html;
  }

  function angleArcPoints(ax, r, y, angle) {
    var n = Math.max(12, Math.ceil((angle / TAU) * 72));
    var out = [];
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * angle;
      out.push([ax + Math.cos(a) * r, y, Math.sin(a) * r]);
    }
    return out;
  }

  function pathOf(points) {
    var html = "";
    for (var i = 0; i < points.length; i++) {
      var q = project(points[i]);
      html += (i === 0 ? "M " : "L ") + fmt(q[0]) + " " + fmt(q[1]) + " ";
    }
    return html;
  }

  function renderAngleArc(ax, rOuter, angleRad) {
    if (state.view > 0.84) return "";
    var y = RE_PROFILE.y2 + 7;
    var points = angleArcPoints(ax, rOuter + 7, y, angleRad);
    var html = '<path class="draft-arc" d="' + pathOf(points) + '"/>';
    html += '<path class="draft-arc-ink" d="' + pathOf(points) + '"/>';
    // the arrowhead at the end of the sweep
    if (points.length > 1) {
      var last = project(points[points.length - 1]);
      var prev = project(points[points.length - 2]);
      var dx = last[0] - prev[0];
      var dy = last[1] - prev[1];
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = dx / len;
      var ny = dy / len;
      var px = -ny;
      var py = nx;
      html +=
        '<polygon class="draft-arrow-head" points="' +
        fmt(last[0] + nx * 8) + "," + fmt(last[1] + ny * 8) + " " +
        fmt(last[0] + px * 4) + "," + fmt(last[1] + py * 4) + " " +
        fmt(last[0] - px * 4) + "," + fmt(last[1] - py * 4) + '"/>';
    }
    var mid = angleRad / 2;
    var labelPoint = [ax + Math.cos(mid) * (rOuter + 13), y, Math.sin(mid) * (rOuter + 13)];
    html += label3(
      labelPoint,
      Math.round((angleRad / TAU) * 360) + "°",
      "draft-label",
      "middle",
      0,
      0
    );
    return html;
  }

  function renderRevolveEnd(ax, r1, r2, angleRad) {
    if (state.view > 0.84) return "";
    if (Math.abs(angleRad) >= TAU - 1e-4) return "";
    var a = angleRad;
    var corners = [
      [ax + Math.cos(a) * r1, RE_PROFILE.y1, Math.sin(a) * r1],
      [ax + Math.cos(a) * r2, RE_PROFILE.y1, Math.sin(a) * r2],
      [ax + Math.cos(a) * r2, RE_PROFILE.y2, Math.sin(a) * r2],
      [ax + Math.cos(a) * r1, RE_PROFILE.y2, Math.sin(a) * r1]
    ];
    var html = poly3(corners, "draft-end-ghost");
    html += label3(corners[1], "end", "draft-label is-quiet", "start", 5, -4);
    return html;
  }

  function renderRevolveScene() {
    var axis = AXES[state.axis];
    var radii = axisRadii();
    var faces = [];
    var valid = axis && axis.valid && state.revolveSelected;
    var showPreview = state.open || state.applied;

    if (valid && showPreview) {
      faces = tubeFaces(
        radii.ax, radii.r1, radii.r2, RE_PROFILE.y1, RE_PROFILE.y2,
        (state.angle / 360) * TAU,
        revolveOperationClass()
      );
    }

    var bodyClass = "draft-body" +
      (state.pick && state.open ? " is-ghost" : "");
    els.body.innerHTML =
      '<g class="' + bodyClass + '">' + renderFaces(faces) + "</g>";

    var overlay = planeBorder(RE_PLANE);
    overlay += renderRevolveProfile();

    if (state.pick === "axis") {
      for (var i = 0; i < AXIS_ORDER.length; i++) {
        var candidate = AXES[AXIS_ORDER[i]];
        overlay += renderAxis(
          candidate,
          candidate.id === state.axis ? "chosen" : "candidate"
        );
      }
    } else {
      // the reference axes stay quiet; the chosen axis is the marked line
      overlay += renderAxis(AXES.x, "reference");
      overlay += renderAxis(AXES.y, "reference");
      overlay += renderAxis(axis, "chosen");
    }

    if (state.revolveSelected && axis && axis.valid) {
      overlay += renderAngleArc(radii.ax, radii.r2, (state.angle / 360) * TAU);
      overlay += renderRevolveEnd(radii.ax, radii.r1, radii.r2, (state.angle / 360) * TAU);
    }

    overlay += label3(
      [RE_PLANE.x1 + 4, RE_PLANE.y1 + 4, 0.05],
      "sketch plane",
      "draft-label is-quiet"
    );

    els.grid.innerHTML = renderPlane(RE_PLANE);
    els.overlay.innerHTML = overlay;
    renderHover();
  }

  /* ------------------------------------------------------------------ */
  /* hit testing                                                        */
  /* ------------------------------------------------------------------ */

  function svgPoint(event) {
    var pt = els.svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    var matrix = els.svg.getScreenCTM();
    if (!matrix) return null;
    var p = pt.matrixTransform(matrix.inverse());
    return [p.x, p.y];
  }

  function pointInPoly(p, points) {
    var inside = false;
    for (var i = 0, j = points.length - 1; i < points.length; j = i++) {
      var a = points[i];
      var b = points[j];
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  function regionAt(p) {
    if (state.scene === "extrude") {
      for (var i = EX_REGION_ORDER.length - 1; i >= 0; i--) {
        var id = EX_REGION_ORDER[i];
        var region = EX_REGIONS[id];
        var polygon = regionPolygon(region, 0.04).map(project);
        if (pointInPoly(p, polygon)) return id;
      }
      return null;
    }
    if (!state.revolveSelected) {
      var rp = rectPoly(RE_PROFILE.x1, RE_PROFILE.x2, RE_PROFILE.y1, RE_PROFILE.y2, 0.04).map(project);
      return pointInPoly(p, rp) ? "profile" : null;
    }
    var rp2 = rectPoly(RE_PROFILE.x1, RE_PROFILE.x2, RE_PROFILE.y1, RE_PROFILE.y2, 0.04).map(project);
    return pointInPoly(p, rp2) ? "profile" : null;
  }

  function distToSegment(p, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var x = a[0] + t * dx;
    var y = a[1] + t * dy;
    return Math.sqrt((p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y));
  }

  function axisAt(p) {
    var best = null;
    var bestDist = 11;
    for (var i = 0; i < AXIS_ORDER.length; i++) {
      var axis = AXES[AXIS_ORDER[i]];
      var pts = axisPoints(axis);
      var d = distToSegment(p, project(pts[0]), project(pts[1]));
      if (d < bestDist) {
        bestDist = d;
        best = axis.id;
      }
    }
    return best;
  }

  function heightHandlePoint() {
    var ids = selectedExtrudeIds();
    if (ids.length === 0) return null;
    var anchor = regionCentroid(EX_REGIONS[ids[0]]);
    return project([anchor[0], anchor[1], state.height]);
  }

  function handleAt(p) {
    if (state.scene !== "extrude" || state.pick || !state.open) return false;
    if (state.view > 0.86) return false;
    var hp = heightHandlePoint();
    if (!hp) return false;
    var dx = p[0] - hp[0];
    var dy = p[1] - hp[1];
    return dx * dx + dy * dy <= 14 * 14;
  }

  function renderHover() {
    var html = "";
    if (state.hoverRegion && state.pick === "profiles") {
      if (state.scene === "extrude") {
        var region = EX_REGIONS[state.hoverRegion];
        if (region) {
          var cls = "draft-region is-material is-hover";
          if (state.profiles[region.id]) cls += " is-selected";
          html += poly3(regionPolygon(region, 0.045), cls);
        }
      } else {
        html += poly3(
          rectPoly(RE_PROFILE.x1, RE_PROFILE.x2, RE_PROFILE.y1, RE_PROFILE.y2, 0.045),
          "draft-region is-material is-selected is-hover"
        );
      }
    }
    if (state.hoverAxis && state.pick === "axis") {
      html += renderAxis(AXES[state.hoverAxis], "hover");
    }
    els.hover.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* panel                                                              */
  /* ------------------------------------------------------------------ */

  function profilesCount() {
    return state.scene === "extrude"
      ? selectedExtrudeIds().length
      : state.revolveSelected
        ? 1
        : 0;
  }

  function selectedProfiles() {
    if (state.scene === "extrude") {
      return selectedExtrudeIds().map(function (id) {
        return EX_REGIONS[id];
      });
    }
    return state.revolveSelected ? [RE_PROFILE] : [];
  }

  function formatArea(area) {
    return Math.round(area).toLocaleString("en-US") + " mm²";
  }

  function opLabel(op) {
    return op === "new" ? "new body" : op;
  }

  function isAxisValid() {
    return state.scene === "extrude" || (AXES[state.axis] && AXES[state.axis].valid);
  }

  function primaryDisabled() {
    if (!state.open) return true;
    if (profilesCount() === 0) return true;
    if (state.scene === "extrude") {
      return state.height < 1 || extrudeOperationInvalid();
    }
    return !isAxisValid() || state.angle < 1 || state.angle > 360 || revolveOperationInvalid();
  }

  function errorText() {
    if (profilesCount() === 0) return "pick at least one profile";
    if (state.scene === "extrude") {
      if (state.height < 1) return "height must be greater than zero";
      if (extrudeOperationInvalid()) {
        return "the preview sits on top of the body — " +
          (state.operation === "cut" ? "cut" : "intersect") +
          " has no overlap to remove or keep";
      }
      return null;
    }
    if (!isAxisValid()) return "the profile crosses the axis — pick another axis";
    if (revolveOperationInvalid()) return "there is no target body at this step";
    if (state.angle < 1 || state.angle > 360) return "the angle must be between 1° and 360°";
    return null;
  }

  function hintText() {
    if (state.pick === "profiles") {
      return "click regions in the model to add or remove; the list is the truth";
    }
    if (state.pick === "axis") {
      return "click a highlighted candidate line; Escape exits the pick";
    }
    if (state.scene === "extrude") {
      return "drag the arrow or edit the height; the sketch stays on its plane";
    }
    return "edit the angle; the arc shows the sweep, and a partial sweep adds end faces";
  }

  function summaryText() {
    if (state.scene === "extrude") {
      return state.height.toFixed(1) + " mm · " + opLabel(state.operation) +
        " · " + profilesCount() + " profile" + (profilesCount() === 1 ? "" : "s");
    }
    return state.angle + "° · " + opLabel(state.operation) +
      " · " + profilesCount() + " profile" + (profilesCount() === 1 ? "" : "s");
  }

  function panelHtml() {
    if (state.scene === "extrude") {
      var ids = selectedExtrudeIds();
      var list = "";
      for (var i = 0; i < ids.length; i++) {
        var region = EX_REGIONS[ids[i]];
        list +=
          '<div class="input-row"><span class="input-kind">Profile ' + (i + 1) +
          '</span><span class="input-detail">' + formatArea(region.area) +
          '</span><button class="input-remove" type="button" data-profile-remove="' +
          region.id + '">remove</button></div>';
      }
      if (ids.length === 0) list = "";
      return (
        '<div class="tool-panel-head"><div>' +
        '<div class="tool-panel-kicker">new feature</div>' +
        '<h2 class="tool-panel-title">Extrude</h2></div></div>' +
        '<div class="tool-panel-body">' +
        '<div class="tool-row"><span class="tool-label">sketch</span><span class="tool-note">Sketch 1 · top face</span></div>' +
        '<div class="tool-row"><span class="tool-label">profile</span><span class="tool-note">' +
        profilesCount() + ' selected</span><button class="text-action" type="button" data-action="pick-profiles">' +
        (state.pick === "profiles" ? "done" : "pick") + '</button></div>' +
        (list ? '<div class="input-list">' + list + "</div>" : "") +
        '<div class="tool-row"><span class="tool-label">height</span>' +
        '<span class="tool-input"><input type="text" inputmode="decimal" value="' +
        state.height.toFixed(1) + '" data-field="height" aria-label="Extrude height"><span class="unit">mm</span></span></div>' +
        '<input class="tool-range" type="range" min="1" max="60" step="1" value="' +
        Math.round(state.height) + '" data-range="height" aria-label="Extrude height">' +
        operationRow() +
        '<div class="draft-note">' + hintText() + "</div>" +
        (errorText() ? '<div class="draft-error">' + errorText() + "</div>" : "") +
        "</div>" +
        footerHtml(summaryText(), "extrude")
      );
    }

    var profileRow =
      '<div class="tool-row"><span class="tool-label">profile</span><span class="tool-note">' +
      profilesCount() + ' selected</span><button class="text-action" type="button" data-action="pick-profiles">' +
      (state.pick === "profiles" ? "done" : "pick") + "</button></div>";
    var list2 = state.revolveSelected
      ? '<div class="input-list"><div class="input-row"><span class="input-kind">Profile 1</span>' +
        '<span class="input-detail">' + formatArea(RE_PROFILE.area) +
        '</span><button class="input-remove" type="button" data-profile-remove="profile">remove</button></div></div>'
      : "";
    var axis = AXES[state.axis];
    return (
      '<div class="tool-panel-head"><div>' +
      '<div class="tool-panel-kicker">new feature</div>' +
      '<h2 class="tool-panel-title">Revolve</h2></div></div>' +
      '<div class="tool-panel-body">' +
      '<div class="tool-row"><span class="tool-label">sketch</span><span class="tool-note">Sketch 1 · top face</span></div>' +
      profileRow + list2 +
      '<div class="tool-row"><span class="tool-label">axis</span><span class="tool-note">' +
      (axis ? axis.label : "none") + '</span><button class="text-action" type="button" data-action="pick-axis">' +
      (state.pick === "axis" ? "done" : "pick") + "</button></div>" +
      '<div class="tool-row"><span class="tool-label">angle</span>' +
      '<span class="tool-input"><input type="text" inputmode="decimal" value="' +
      state.angle + '" data-field="angle" aria-label="Revolve angle"><span class="unit">°</span></span></div>' +
      '<input class="tool-range" type="range" min="1" max="360" step="1" value="' +
      state.angle + '" data-range="angle" aria-label="Revolve angle">' +
      operationRow() +
      '<div class="draft-note">' + hintText() + "</div>" +
      (errorText() ? '<div class="draft-error">' + errorText() + "</div>" : "") +
      "</div>" +
      footerHtml(summaryText(), "revolve")
    );
  }

  function operationRow() {
    var ops = ["new", "join", "cut", "intersect"];
    return (
      '<div class="tool-row"><span class="tool-label">operation</span>' +
      '<span class="seg" role="group" aria-label="Operation">' +
      ops
        .map(function (op) {
          return (
            '<button type="button" data-op="' + op + '"' +
            (state.operation === op ? ' class="is-selected"' : "") + ">" +
            opLabel(op) + "</button>"
          );
        })
        .join("") +
      "</span></div>"
    );
  }

  function footerHtml(summary, primary) {
    var disabled = primaryDisabled();
    return (
      '<div class="tool-panel-foot"><span class="tool-summary">' + summary +
      '</span><span class="tool-panel-actions">' +
      '<button class="text-action is-quiet" type="button" data-action="cancel">cancel</button>' +
      '<button class="text-action" type="button" data-action="apply"' +
      (disabled ? " disabled" : "") + ">" + primary + "</button></span></div>"
    );
  }

  function renderPanel() {
    els.panel.hidden = !state.open;
    if (!state.open) return;
    els.panel.innerHTML = panelHtml();
  }

  function renderClosed() {
    if (state.open) {
      els.closed.hidden = true;
      els.closed.innerHTML = "";
      return;
    }
    els.closed.hidden = false;
    var applied = state.status === "apply";
    var title = state.scene === "extrude" ? "Extrude 1" : "Revolve 1";
    els.closed.innerHTML =
      '<div class="draft-closed-card" role="status">' +
      '<div class="tool-panel-kicker">' + (applied ? "draft applied" : "draft cancelled") + "</div>" +
      "<h3>" + (applied ? title + " added" : "Back on the sketch") + "</h3>" +
      "<p>" +
      (applied
        ? "The model stays in view and the new step is selected. The preview becomes the result body."
        : "The draft is dropped and the seed profile selection is restored on the sketch step.") +
      "</p>" +
      '<button class="text-action" type="button" data-action="reopen">start again</button>' +
      "</div>";
  }

  /* ------------------------------------------------------------------ */
  /* stage chrome                                                       */
  /* ------------------------------------------------------------------ */

  function renderOptions() {
    if (!state.open) {
      els.options.innerHTML =
        '<span class="tool-kicker">input</span><span class="tool-note">' +
        (state.status === "apply" ? "the step is applied; orbit the result" : "the draft is closed") +
        "</span>";
      return;
    }
    var active = state.pick || "preview";
    var buttons =
      '<button class="tool-option' + (active === "preview" ? " is-on" : "") +
      '" type="button" data-input="preview">preview</button>' +
      '<button class="tool-option' + (active === "profiles" ? " is-on" : "") +
      '" type="button" data-input="profiles">profiles</button>' +
      (state.scene === "revolve"
        ? '<button class="tool-option' + (active === "axis" ? " is-on" : "") +
          '" type="button" data-input="axis">axis</button>'
        : "");
    var note =
      active === "preview"
        ? "orbit the preview; pick an input to change it"
        : active === "profiles"
          ? "click regions in the model"
          : "click a candidate line";
    els.options.innerHTML =
      '<span class="tool-kicker">input</span>' + buttons +
      '<span class="tool-note">' + note + "</span>" +
      (active !== "preview"
        ? '<button class="text-action" type="button" data-action="done">done</button>'
        : "");
  }

  function renderFoot() {
    if (!state.open) {
      els.foot.textContent =
        state.status === "apply"
          ? (state.scene === "extrude" ? "Extrude 1 · applied" : "Revolve 1 · applied")
          : "draft cancelled · back on the sketch";
      return;
    }
    if (state.scene === "extrude") {
      els.foot.innerHTML =
        "<b>extrude draft</b> · " + opLabel(state.operation) + " · " +
        profilesCount() + " profile" + (profilesCount() === 1 ? "" : "s") +
        (state.pick ? " · " + state.pick + " pick" : "");
    } else {
      els.foot.innerHTML =
        "<b>revolve draft</b> · " + state.angle + "° · " +
        profilesCount() + " profile" + (profilesCount() === 1 ? "" : "s") +
        (state.pick ? " · " + state.pick + " pick" : "");
    }
  }

  function updateViewButtons() {
    var buttons = document.querySelectorAll("[data-view]");
    for (var i = 0; i < buttons.length; i++) {
      var target = Number(buttons[i].getAttribute("data-view"));
      buttons[i].classList.toggle("is-selected", Math.abs(state.view - target) < 0.02);
    }
  }

  function syncReadouts() {
    if (!state.open) return;
    var range = els.panel.querySelector('[data-range="height"]');
    var field = els.panel.querySelector('[data-field="height"]');
    if (range) range.value = String(Math.round(state.height));
    if (field) field.value = state.height.toFixed(1);
    var angleRange = els.panel.querySelector('[data-range="angle"]');
    var angleField = els.panel.querySelector('[data-field="angle"]');
    if (angleRange) angleRange.value = String(Math.round(state.angle));
    if (angleField) angleField.value = String(Math.round(state.angle));
    var summary = els.panel.querySelector(".tool-summary");
    if (summary) summary.textContent = summaryText();
  }

  /* ------------------------------------------------------------------ */
  /* render                                                             */
  /* ------------------------------------------------------------------ */

  function renderScene() {
    if (state.scene === "extrude") renderExtrudeScene();
    else renderRevolveScene();
  }

  function renderAll() {
    renderScene();
    renderPanel();
    renderOptions();
    renderFoot();
    renderClosed();
    updateViewButtons();
    els.live.classList.toggle("is-picking", !!state.pick && state.open);
  }

  /* ------------------------------------------------------------------ */
  /* actions                                                            */
  /* ------------------------------------------------------------------ */

  function setPick(pick) {
    state.pick = pick;
    state.hoverRegion = null;
    state.hoverAxis = null;
    renderAll();
  }

  function toggleProfile(id) {
    if (state.scene === "extrude") {
      state.profiles[id] = !state.profiles[id];
    } else {
      state.revolveSelected = !state.revolveSelected;
    }
    renderAll();
  }

  function chooseAxis(id) {
    state.axis = id;
    state.pick = null;
    state.hoverAxis = null;
    renderAll();
  }

  function closeDraft(kind) {
    state.open = false;
    state.applied = kind === "apply";
    state.status = kind;
    state.pick = null;
    state.hoverRegion = null;
    state.hoverAxis = null;
    if (kind === "cancel") {
      // cancel restores the seed, not the last edited set
      state.profiles = { a: true, b: true, c: false };
      state.revolveSelected = true;
    }
    renderAll();
  }

  function resetScene(scene) {
    if (tween) {
      cancelAnimationFrame(tween);
      tween = null;
    }
    state.scene = scene;
    state.open = true;
    state.applied = false;
    state.status = null;
    state.pick = null;
    state.hoverRegion = null;
    state.hoverAxis = null;
    state.view = 0;
    if (scene === "extrude") {
      state.profiles = { a: true, b: true, c: false };
      state.height = 18;
      state.operation = "join";
    } else {
      state.revolveSelected = true;
      state.axis = "line1";
      state.angle = 140;
      state.operation = "new";
    }
    renderAll();
  }

  function setView(target) {
    if (tween) {
      cancelAnimationFrame(tween);
      tween = null;
    }
    if (REDUCED || Math.abs(state.view - target) < 0.001) {
      state.view = target;
      renderScene();
      updateViewButtons();
      return;
    }
    var from = state.view;
    var start = performance.now();
    function frame(now) {
      var t = Math.min(1, (now - start) / 280);
      var eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      state.view = from + (target - from) * eased;
      renderScene();
      updateViewButtons();
      if (t < 1) {
        tween = requestAnimationFrame(frame);
      } else {
        state.view = target;
        tween = null;
        renderScene();
        updateViewButtons();
      }
    }
    tween = requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /* events                                                             */
  /* ------------------------------------------------------------------ */

  function onPanelClick(event) {
    var target = event.target.closest
      ? event.target.closest("button, [data-op]")
      : null;
    if (!target) return;
    var action = target.getAttribute("data-action");
    if (action === "pick-profiles") {
      setPick(state.pick === "profiles" ? null : "profiles");
      return;
    }
    if (action === "pick-axis") {
      setPick(state.pick === "axis" ? null : "axis");
      return;
    }
    if (action === "done") {
      setPick(null);
      return;
    }
    if (action === "cancel") {
      closeDraft("cancel");
      return;
    }
    if (action === "apply") {
      if (!primaryDisabled()) closeDraft("apply");
      return;
    }
    var remove = target.getAttribute("data-profile-remove");
    if (remove) {
      state.profiles[remove] = false;
      state.revolveSelected = false;
      renderAll();
      return;
    }
    var op = target.getAttribute("data-op");
    if (op) {
      state.operation = op;
      renderAll();
    }
  }

  function onPanelInput(event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var range = target.getAttribute("data-range");
    if (range === "height") {
      state.height = Number(target.value);
      syncReadouts();
      renderScene();
      renderFoot();
      return;
    }
    if (range === "angle") {
      state.angle = Number(target.value);
      syncReadouts();
      renderScene();
      renderFoot();
    }
  }

  function onPanelChange(event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var field = target.getAttribute("data-field");
    if (field !== "height" && field !== "angle") return;
    var value = parseFloat(target.value);
    if (!isFinite(value)) {
      syncReadouts();
      return;
    }
    if (field === "height") {
      state.height = Math.max(1, Math.min(60, Math.round(value * 10) / 10));
      syncReadouts();
      renderScene();
      renderFoot();
    } else {
      state.angle = Math.max(1, Math.min(360, Math.round(value)));
      syncReadouts();
      renderScene();
      renderFoot();
    }
  }

  function onOptionsClick(event) {
    var button = event.target.closest ? event.target.closest("[data-input]") : null;
    if (button) {
      var next = button.getAttribute("data-input");
      setPick(next === "preview" ? null : next);
      return;
    }
    var done = event.target.closest ? event.target.closest('[data-action="done"]') : null;
    if (done) setPick(null);
  }

  function onClosedClick(event) {
    var button = event.target.closest ? event.target.closest("[data-action]") : null;
    if (button && button.getAttribute("data-action") === "reopen") {
      resetScene(state.scene);
    }
  }

  function onSceneClick(event) {
    var button = event.target.closest ? event.target.closest("[data-scene]") : null;
    if (!button) return;
    var scene = button.getAttribute("data-scene");
    if (scene === state.scene && state.open) return;
    var buttons = document.querySelectorAll("[data-scene]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-on", buttons[i] === button);
    }
    resetScene(scene);
  }

  function onViewClick(event) {
    var button = event.target.closest ? event.target.closest("[data-view]") : null;
    if (!button) return;
    setView(Number(button.getAttribute("data-view")));
  }

  function hoverAt(p) {
    var changed = false;
    var nextRegion = null;
    var nextAxis = null;
    var nextHandle = false;
    if (!state.open) {
      els.hover.innerHTML = "";
      return;
    }
    if (state.pick === "profiles") {
      nextRegion = regionAt(p);
    } else if (state.pick === "axis") {
      nextAxis = axisAt(p);
    } else {
      nextHandle = handleAt(p);
    }
    if (nextRegion !== state.hoverRegion || nextAxis !== state.hoverAxis || nextHandle !== state.hoverHandle) {
      changed = true;
      state.hoverRegion = nextRegion;
      state.hoverAxis = nextAxis;
      state.hoverHandle = nextHandle;
    }
    els.svg.style.cursor = nextHandle ? "ns-resize" : "";
    if (changed) renderHover();
  }

  function onSvgPointerDown(event) {
    if (!state.open || state.pick || state.scene !== "extrude") return;
    var p = svgPoint(event);
    if (!p || !handleAt(p)) return;
    drag = { y: event.clientY, height: state.height };
    suppressClick = true;
    els.live.classList.add("is-dragging");
    try {
      els.svg.setPointerCapture(event.pointerId);
    } catch (err) {
      /* ignore */
    }
    event.preventDefault();
  }

  function onSvgPointerMove(event) {
    var p = svgPoint(event);
    if (drag) {
      var next = drag.height + (drag.y - event.clientY) / (VIEW.s * 0.92);
      state.height = Math.max(1, Math.min(60, Math.round(next * 10) / 10));
      syncReadouts();
      renderScene();
      renderFoot();
      return;
    }
    if (p) hoverAt(p);
  }

  function onSvgPointerUp(event) {
    if (!drag) return;
    drag = null;
    els.live.classList.remove("is-dragging");
    try {
      els.svg.releasePointerCapture(event.pointerId);
    } catch (err) {
      /* ignore */
    }
    // the click after a drag must not toggle a profile
    window.setTimeout(function () {
      suppressClick = false;
    }, 0);
  }

  function onSvgLeave() {
    if (!drag) {
      state.hoverRegion = null;
      state.hoverAxis = null;
      state.hoverHandle = false;
      els.hover.innerHTML = "";
      els.svg.style.cursor = "";
    }
  }

  function onSvgClick(event) {
    if (suppressClick || !state.open) return;
    var p = svgPoint(event);
    if (!p) return;
    if (state.pick === "profiles") {
      var id = regionAt(p);
      if (id) toggleProfile(id);
      return;
    }
    if (state.pick === "axis") {
      var axis = axisAt(p);
      if (axis) chooseAxis(axis);
    }
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */

  function boot() {
    els.live = document.getElementById("draft-live");
    els.svg = document.getElementById("draft-svg");
    els.grid = document.getElementById("draft-grid");
    els.body = document.getElementById("draft-body");
    els.overlay = document.getElementById("draft-overlay");
    els.hover = document.getElementById("draft-hover");
    els.panel = document.getElementById("draft-panel");
    els.closed = document.getElementById("draft-closed");
    els.options = document.getElementById("draft-options");
    els.foot = document.getElementById("draft-foot-left");

    ShowcaseUI.makeDraggable(els.panel, els.live);

    els.panel.addEventListener("click", onPanelClick);
    els.panel.addEventListener("input", onPanelInput);
    els.panel.addEventListener("change", onPanelChange);
    els.closed.addEventListener("click", onClosedClick);
    els.options.addEventListener("click", onOptionsClick);

    var sceneButtons = document.querySelectorAll("[data-scene]");
    for (var i = 0; i < sceneButtons.length; i++) {
      sceneButtons[i].addEventListener("click", onSceneClick);
    }
    var viewButtons = document.querySelectorAll("[data-view]");
    for (var j = 0; j < viewButtons.length; j++) {
      viewButtons[j].addEventListener("click", onViewClick);
    }

    els.svg.addEventListener("pointerdown", onSvgPointerDown);
    els.svg.addEventListener("pointermove", onSvgPointerMove);
    els.svg.addEventListener("pointerup", onSvgPointerUp);
    els.svg.addEventListener("pointercancel", onSvgPointerUp);
    els.svg.addEventListener("pointerleave", onSvgLeave);
    els.svg.addEventListener("click", onSvgClick);

    resetScene("extrude");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
