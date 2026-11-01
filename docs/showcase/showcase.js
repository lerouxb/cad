/*
 * Interactive sketch-tool showcase: rectangular / circular pattern, mirror,
 * offset. Design target only — not imported by src/.
 *
 * The scene is a tiny sketch model (lines + circles). A tool reads the current
 * selection, turns its parameters into preview geometry (dashed), and draws
 * draggable manipulators. Nothing here is a real document.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* view transform (mm -> viewBox px, Z-up)                             */
  /* ------------------------------------------------------------------ */

  var VB = { w: 1200, h: 700, ox: 520, oy: 430, s: 3.6 };

  function px(p) {
    return [VB.ox + p[0] * VB.s, VB.oy - p[1] * VB.s];
  }

  function sp(p) {
    var q = px(p);
    return q[0].toFixed(1) + " " + q[1].toFixed(1);
  }

  /* ------------------------------------------------------------------ */
  /* small vector helpers                                                */
  /* ------------------------------------------------------------------ */

  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1]];
  }
  function add(a, b) {
    return [a[0] + b[0], a[1] + b[1]];
  }
  function mul(a, k) {
    return [a[0] * k, a[1] * k];
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1];
  }
  function vlen(a) {
    return Math.sqrt(a[0] * a[0] + a[1] * a[1]);
  }
  function unit(a) {
    var l = vlen(a) || 1;
    return [a[0] / l, a[1] / l];
  }
  function rot(p, a) {
    var c = Math.cos(a),
      s = Math.sin(a);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  }
  function rotAbout(p, o, a) {
    return add(o, rot(sub(p, o), a));
  }
  function reflect(p, o, d) {
    var u = unit(d);
    var v = sub(p, o);
    var foot = add(o, mul(u, dot(v, u)));
    return sub(mul(foot, 2), p);
  }
  function lineInt(p1, d1, p2, d2) {
    var den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) return null;
    var t =
      ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
    return add(p1, mul(d1, t));
  }
  function mid(a, b) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  function near(a, b) {
    return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  }
  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }
  function fmt(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }
  function deg2rad(d) {
    return (d * Math.PI) / 180;
  }
  function signedArea(pts) {
    var s = 0;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i],
        b = pts[(i + 1) % pts.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  /* ------------------------------------------------------------------ */
  /* scenes                                                              */
  /* ------------------------------------------------------------------ */

  function ln(id, a, b, kind) {
    return { id: id, type: "line", a: a, b: b, kind: kind || "profile" };
  }
  function ci(id, c, r, kind) {
    return { id: id, type: "circle", c: c, r: r, kind: kind || "profile" };
  }

  var SCENES = {
    rect: {
      name: "bolt plate",
      geometry: [
        ln("p1", [-10, -10], [130, -10]),
        ln("p2", [130, -10], [130, 80]),
        ln("p3", [130, 80], [-10, 80]),
        ln("p4", [-10, 80], [-10, -10]),
        ci("hole", [20, 20], 6)
      ],
      defaultSelection: ["hole"],
      anchor: [20, 20]
    },
    circular: {
      name: "flange",
      geometry: [
        ci("flange", [0, 0], 62),
        ci("hub", [0, 0], 16, "construction"),
        ci("bolt", [0, 44], 6)
      ],
      defaultSelection: ["bolt"],
      axis: [0, 0]
    },
    mirror: {
      name: "half bracket",
      geometry: [
        ln("m1", [0, 0], [46, 0]),
        ln("m2", [46, 0], [46, 18]),
        ln("m3", [46, 18], [72, 18]),
        ln("m4", [72, 18], [72, 54]),
        ln("m5", [72, 54], [0, 54])
      ],
      defaultSelection: ["m1", "m2", "m3", "m4", "m5"]
    },
    offset: {
      name: "L profile",
      geometry: [
        ln("o1", [0, 0], [84, 0]),
        ln("o2", [84, 0], [84, 32]),
        ln("o3", [84, 32], [32, 32]),
        ln("o4", [32, 32], [32, 72]),
        ln("o5", [32, 72], [0, 72]),
        ln("o6", [0, 72], [0, 0])
      ],
      defaultSelection: ["o1", "o2", "o3", "o4", "o5", "o6"]
    }
  };

  /* ------------------------------------------------------------------ */
  /* state                                                               */
  /* ------------------------------------------------------------------ */

  var state = {
    tool: "rect",
    scene: "rect",
    selection: SCENES.rect.defaultSelection.slice(),
    params: {
      rect: {
        axis1: "x",
        count1: 4,
        dist1: 25,
        dir2: false,
        axis2: "y",
        count2: 2,
        dist2: 22,
        symmetric: false
      },
      circular: {
        count: 6,
        angle: 360,
        mode: "extent",
        rotate: true
      },
      mirror: { line: "y", keep: true },
      offset: { dist: 8, side: 1, corner: "miter" }
    },
    drag: null,
    justDragged: false,
    message: ""
  };

  /* ------------------------------------------------------------------ */
  /* panel specs                                                         */
  /* ------------------------------------------------------------------ */

  function when(pred) {
    return function (p) {
      return !!pred(p);
    };
  }

  var SPECS = {
    rect: {
      title: "rectangular pattern",
      rows: [
        { type: "seg", key: "axis1", label: "direction 1", options: [["x", "X"], ["y", "Y"]] },
        { type: "stepper", key: "count1", label: "count" },
        { type: "input", key: "dist1", label: "spacing", unit: "mm" },
        { type: "toggle", key: "dir2", label: "direction 2" },
        { type: "seg", key: "axis2", label: "axis", options: [["x", "X"], ["y", "Y"]], when: when(function (p) { return p.dir2; }) },
        { type: "stepper", key: "count2", label: "count 2", when: when(function (p) { return p.dir2; }) },
        { type: "input", key: "dist2", label: "spacing 2", unit: "mm", when: when(function (p) { return p.dir2; }) },
        { type: "toggle", key: "symmetric", label: "symmetric" }
      ]
    },
    circular: {
      title: "circular pattern",
      rows: [
        { type: "static", label: "axis", value: "sketch origin" },
        { type: "stepper", key: "count", label: "count" },
        { type: "input", key: "angle", label: "sweep", unit: "deg" },
        { type: "seg", key: "angle", label: "presets", options: [["360", "360"], ["270", "270"], ["180", "180"], ["90", "90"]] },
        { type: "seg", key: "mode", label: "measure", options: [["extent", "extent"], ["spacing", "spacing"]] },
        { type: "toggle", key: "rotate", label: "rotate items" }
      ]
    },
    mirror: {
      title: "mirror",
      rows: [
        { type: "seg", key: "line", label: "mirror line", options: [["y", "Y axis"], ["x", "X axis"]] },
        { type: "toggle", key: "keep", label: "keep original" }
      ]
    },
    offset: {
      title: "offset",
      rows: [
        { type: "input", key: "dist", label: "distance", unit: "mm" },
        { type: "seg", key: "side", label: "side", options: [["1", "outside"], ["-1", "inside"]] },
        { type: "seg", key: "corner", label: "corner", options: [["miter", "miter"], ["round", "round"]] },
        { type: "static", label: "chain", value: "closed loop" }
      ]
    }
  };

  /* ------------------------------------------------------------------ */
  /* DOM                                                                 */
  /* ------------------------------------------------------------------ */

  var svg, viewport, stage, panel, prompt, statusLine, legendEl, stepsEl, detailEl;
  var layers = {};

  function $(id) {
    return document.getElementById(id);
  }

  function initDom() {
    svg = $("svg");
    viewport = $("viewport");
    stage = $("stage");
    panel = $("tool-panel");
    prompt = $("tool-prompt");
    statusLine = $("status-line");
    legendEl = $("legend");
    stepsEl = $("steps");
    detailEl = $("timeline-detail");
    layers.ref = $("ref-layer");
    layers.ghost = $("ghost-layer");
    layers.selection = $("selection-layer");
    layers.geometry = $("geometry-layer");
    layers.manip = $("manip-layer");
  }

  /* ------------------------------------------------------------------ */
  /* geometry helpers over scenes                                        */
  /* ------------------------------------------------------------------ */

  function sceneById(scene) {
    var map = {};
    scene.geometry.forEach(function (c) {
      map[c.id] = c;
    });
    return map;
  }

  function selectedCurves(scene) {
    var map = sceneById(scene);
    return state.selection
      .map(function (id) {
        return map[id];
      })
      .filter(Boolean);
  }

  function centroid(curves) {
    if (!curves.length) return null;
    var acc = [0, 0],
      n = 0;
    curves.forEach(function (c) {
      if (c.type === "circle") {
        acc = add(acc, c.c);
        n++;
      } else {
        acc = add(acc, mid(c.a, c.b));
        n++;
      }
    });
    return n ? mul(acc, 1 / n) : null;
  }

  function sceneBounds(scene) {
    var b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    function pt(p) {
      b.x1 = Math.min(b.x1, p[0]);
      b.y1 = Math.min(b.y1, p[1]);
      b.x2 = Math.max(b.x2, p[0]);
      b.y2 = Math.max(b.y2, p[1]);
    }
    scene.geometry.forEach(function (c) {
      if (c.type === "circle") {
        pt([c.c[0] - c.r, c.c[1] - c.r]);
        pt([c.c[0] + c.r, c.c[1] + c.r]);
      } else {
        pt(c.a);
        pt(c.b);
      }
    });
    return b;
  }

  function transformCurve(c, fn) {
    if (c.type === "circle") {
      return { id: c.id, type: "circle", c: fn(c.c), r: c.r };
    }
    return { id: c.id, type: "line", a: fn(c.a), b: fn(c.b) };
  }

  /* ------------------------------------------------------------------ */
  /* preview geometry                                                    */
  /* ------------------------------------------------------------------ */

  function rectOffsets(p) {
    var out = [];
    var a1 = p.axis1 === "y" ? [0, 1] : [1, 0];
    var a2 = p.axis2 === "y" ? [0, 1] : [1, 0];
    var n1 = Math.max(1, Math.round(p.count1));
    var n2 = p.dir2 ? Math.max(1, Math.round(p.count2)) : 1;
    var c1 = p.symmetric ? (n1 - 1) / 2 : 0;
    var c2 = p.symmetric ? (n2 - 1) / 2 : 0;
    for (var i = 0; i < n1; i++) {
      for (var j = 0; j < n2; j++) {
        var off = add(
          mul(a1, (i - c1) * p.dist1),
          mul(a2, (j - c2) * p.dist2)
        );
        if (Math.abs(off[0]) < 1e-9 && Math.abs(off[1]) < 1e-9) continue;
        out.push(off);
      }
    }
    return out;
  }

  function circStep(p) {
    var n = Math.max(1, Math.round(p.count));
    if (p.mode === "spacing") return p.angle;
    return p.angle >= 359.9 ? 360 / n : p.angle / Math.max(1, n - 1);
  }

  function circAngles(p) {
    var n = Math.max(1, Math.round(p.count));
    var step = circStep(p);
    var out = [];
    for (var k = 0; k < n; k++) out.push(k * step);
    return out;
  }

  function mirrorLine(scene, p) {
    if (p.line === "x") return { o: [0, 0], d: [1, 0] };
    return { o: [0, 0], d: [0, 1] };
  }

  function orderedChain(lines) {
    if (!lines.length) return [];
    var remaining = lines.slice();
    var first = remaining.shift();
    var pts = [first.a, first.b];
    var guard = 0;
    while (remaining.length && guard++ < 400) {
      var tail = pts[pts.length - 1];
      var found = -1,
        reversed = false;
      for (var i = 0; i < remaining.length; i++) {
        if (near(remaining[i].a, tail)) {
          found = i;
          break;
        }
        if (near(remaining[i].b, tail)) {
          found = i;
          reversed = true;
          break;
        }
      }
      if (found < 0) break;
      var seg = remaining.splice(found, 1)[0];
      pts.push(reversed ? seg.a : seg.b);
    }
    return pts;
  }

  function offsetPolyline(pts, dist, round, closed) {
    var n = pts.length,
      out = [],
      segs = [];
    var count = closed ? n : n - 1;
    for (var i = 0; i < count; i++) {
      var a = pts[i],
        b = pts[(i + 1) % n];
      var t = unit(sub(b, a));
      segs.push({ a: a, b: b, t: t, nrm: [-t[1], t[0]] });
    }
    function joint(j) {
      var prev, next;
      if (closed) {
        prev = segs[(j - 1 + count) % count];
        next = segs[j % count];
      } else {
        prev = segs[j - 1];
        next = segs[j];
      }
      var pPrev = add(pts[j], mul(prev.nrm, dist));
      var pNext = add(pts[j], mul(next.nrm, dist));
      if (round) {
        var a0 = Math.atan2(pPrev[1] - pts[j][1], pPrev[0] - pts[j][0]);
        var a1 = Math.atan2(pNext[1] - pts[j][1], pNext[0] - pts[j][0]);
        var da = a1 - a0;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        var steps = 8;
        for (var k = 0; k <= steps; k++) {
          var ang = a0 + (da * k) / steps;
          out.push([
            pts[j][0] + Math.abs(dist) * Math.cos(ang),
            pts[j][1] + Math.abs(dist) * Math.sin(ang)
          ]);
        }
      } else {
        var ip = lineInt(pPrev, prev.t, pNext, next.t);
        out.push(ip || pNext);
      }
    }
    if (!closed) out.push(add(segs[0].a, mul(segs[0].nrm, dist)));
    if (closed) {
      for (var jj = 0; jj < n; jj++) joint(jj);
    } else {
      for (var j2 = 1; j2 < n - 1; j2++) joint(j2);
      var last = segs[segs.length - 1];
      out.push(add(last.b, mul(last.nrm, dist)));
    }
    return out;
  }

  function offsetResult(scene, p) {
    var sel = selectedCurves(scene);
    var out = [];
    var lines = sel.filter(function (c) {
      return c.type === "line";
    });
    sel
      .filter(function (c) {
        return c.type === "circle";
      })
      .forEach(function (c) {
        out.push({ id: c.id, type: "circle", c: c.c, r: c.r + p.dist * p.side });
      });
    if (lines.length) {
      var pts = orderedChain(lines);
      if (pts.length >= 3) {
        var closed = near(pts[0], pts[pts.length - 1]);
        if (closed) pts = pts.slice(0, -1);
        var area = signedArea(pts);
        var outward = area > 0 ? -1 : 1;
        var signed = outward * p.dist * p.side;
        out.push({
          type: "poly",
          pts: offsetPolyline(pts, signed, p.corner === "round", closed)
        });
      }
    }
    return out;
  }

  function ghostCurves(scene) {
    var sel = selectedCurves(scene);
    var out = [];
    if (state.tool === "rect") {
      var offs = rectOffsets(state.params.rect);
      sel.forEach(function (c) {
        offs.forEach(function (o) {
          out.push(
            transformCurve(c, function (q) {
              return add(q, o);
            })
          );
        });
      });
    } else if (state.tool === "circular") {
      var center = scene.axis || [0, 0];
      var cen = centroid(sel) || center;
      var p = state.params.circular;
      circAngles(p)
        .slice(1)
        .forEach(function (deg) {
          var a = deg2rad(deg);
          sel.forEach(function (c) {
            if (p.rotate) {
              out.push(
                transformCurve(c, function (q) {
                  return rotAbout(q, center, a);
                })
              );
            } else {
              var delta = sub(rotAbout(cen, center, a), cen);
              out.push(
                transformCurve(c, function (q) {
                  return add(q, delta);
                })
              );
            }
          });
        });
    } else if (state.tool === "mirror") {
      var ml = mirrorLine(scene, state.params.mirror);
      sel.forEach(function (c) {
        out.push(
          transformCurve(c, function (q) {
            return reflect(q, ml.o, ml.d);
          })
        );
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* SVG emit helpers                                                    */
  /* ------------------------------------------------------------------ */

  function curveEl(c, cls, extra) {
    if (c.type === "circle") {
      var p = px(c.c);
      return (
        '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) +
        '" r="' + (c.r * VB.s).toFixed(1) + '" class="' + cls + '"' +
        (extra || "") + "/>"
      );
    }
    if (c.type === "poly") {
      var pts = c.pts
        .map(function (q) {
          return sp(q);
        })
        .join(" ");
      return '<polyline points="' + pts + '" class="' + cls + '"' + (extra || "") + "/>";
    }
    return (
      '<line x1="' + px(c.a)[0].toFixed(1) + '" y1="' + px(c.a)[1].toFixed(1) +
      '" x2="' + px(c.b)[0].toFixed(1) + '" y2="' + px(c.b)[1].toFixed(1) +
      '" class="' + cls + '"' + (extra || "") + "/>"
    );
  }

  function lineEl(a, b, cls) {
    return (
      '<line x1="' + px(a)[0].toFixed(1) + '" y1="' + px(a)[1].toFixed(1) +
      '" x2="' + px(b)[0].toFixed(1) + '" y2="' + px(b)[1].toFixed(1) +
      '" class="' + cls + '"/>'
    );
  }

  function circleScreenEl(c, r, cls, extra) {
    var p = px(c);
    return (
      '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) +
      '" r="' + r.toFixed(1) + '" class="' + cls + '"' + (extra || "") + "/>"
    );
  }

  function arrowPath(a, b, cls, double) {
    var A = px(a),
      B = px(b);
    var dx = B[0] - A[0],
      dy = B[1] - A[1];
    var L = Math.hypot(dx, dy) || 1;
    var ux = dx / L,
      uy = dy / L;
    var head = 8,
      w = 3.2;
    function headAt(P, hx, hy) {
      var bx = P[0] - hx * head,
        by = P[1] - hy * head;
      return (
        "M " + P[0].toFixed(1) + " " + P[1].toFixed(1) +
        " L " + (bx - hy * w).toFixed(1) + " " + (by + hx * w).toFixed(1) +
        " M " + P[0].toFixed(1) + " " + P[1].toFixed(1) +
        " L " + (bx + hy * w).toFixed(1) + " " + (by - hx * w).toFixed(1)
      );
    }
    var d =
      "M " + A[0].toFixed(1) + " " + A[1].toFixed(1) +
      " L " + B[0].toFixed(1) + " " + B[1].toFixed(1) +
      " " + headAt(B, ux, uy);
    if (double) d += " " + headAt(A, -ux, -uy);
    return '<path d="' + d + '" class="' + cls + '" fill="none"/>';
  }

  function handleEl(p, id) {
    var P = px(p);
    return (
      '<circle class="sc-handle" data-handle="' + id + '" cx="' +
      P[0].toFixed(1) + '" cy="' + P[1].toFixed(1) + '" r="5.5"/>'
    );
  }

  function labelEl(p, text, dx, dy, cls) {
    var P = px(p);
    return (
      '<text x="' + (P[0] + (dx || 0)).toFixed(1) + '" y="' +
      (P[1] + (dy || 0)).toFixed(1) + '" class="sc-manip-label ' +
      (cls || "") + '">' + text + "</text>"
    );
  }

  function crosshairEl(p, size) {
    var P = px(p),
      h = size || 7;
    return (
      '<path class="sc-manip-ink" d="M ' + (P[0] - h).toFixed(1) + " " + P[1].toFixed(1) +
      " H " + (P[0] + h).toFixed(1) + " M " + P[0].toFixed(1) + " " + (P[1] - h).toFixed(1) +
      " V " + (P[1] + h).toFixed(1) + '" fill="none"/>'
    );
  }

  function perpScreen(a1) {
    var P0 = px([0, 0]),
      P1 = px(a1);
    var dx = P1[0] - P0[0],
      dy = P1[1] - P0[1];
    var l = Math.hypot(dx, dy) || 1;
    return [-dy / l, dx / l];
  }

  function tickEl(p, dir, cls, h) {
    var P = px(p),
      k = h || 5;
    return (
      '<line x1="' + (P[0] - dir[0] * k).toFixed(1) + '" y1="' +
      (P[1] - dir[1] * k).toFixed(1) + '" x2="' + (P[0] + dir[0] * k).toFixed(1) +
      '" y2="' + (P[1] + dir[1] * k).toFixed(1) + '" class="' + cls + '"/>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* render: layers                                                      */
  /* ------------------------------------------------------------------ */

  function renderRefs(scene) {
    var b = sceneBounds(scene);
    var pad = 26;
    var html = "";
    html += lineEl([b.x1 - pad, 0], [b.x2 + pad, 0], "sc-axis");
    html += lineEl([0, b.y1 - pad], [0, b.y2 + pad], "sc-axis");
    var O = px([0, 0]);
    html +=
      '<path class="sc-origin" d="M ' + (O[0] - 12) + " " + O[1] + " H " +
      (O[0] + 12) + " M " + O[0] + " " + (O[1] - 12) + " V " + (O[1] + 12) +
      '" fill="none"/>';
    return html;
  }

  function renderGeometry(scene) {
    var html = "";
    var p = state.params[state.tool];
    var dimOriginals = state.tool === "mirror" && !p.keep;
    scene.geometry.forEach(function (c) {
      var cls;
      if (dimOriginals && state.selection.indexOf(c.id) !== -1) {
        cls = "sc-ghost";
      } else {
        cls = "sc-curve" + (c.kind === "construction" ? " is-construction" : "");
      }
      html += curveEl(c, cls);
    });
    // points on top
    scene.geometry.forEach(function (c) {
      if (c.type === "circle") {
        html += circleScreenEl(c.c, 3.2, "sc-point");
        return;
      }
      html += circleScreenEl(c.a, 3.2, "sc-point");
      html += circleScreenEl(c.b, 3.2, "sc-point");
    });
    // wide transparent hit targets
    scene.geometry.forEach(function (c) {
      html += curveEl(c, "sc-hit", ' data-curve="' + c.id + '"');
    });
    return html;
  }

  function renderSelection(scene) {
    var p = state.params[state.tool];
    if (state.tool === "mirror" && !p.keep) return "";
    var sel = selectedCurves(scene);
    var html = "";
    sel.forEach(function (c) {
      html += curveEl(c, "sc-wash");
    });
    // re-draw the selected ink so it stays the most prominent element
    sel.forEach(function (c) {
      html += curveEl(c, "sc-curve");
    });
    return html;
  }

  function ghostList(scene) {
    if (state.tool === "select") return [];
    if (!selectedCurves(scene).length) return [];
    if (state.tool === "offset") return offsetResult(scene, state.params.offset);
    return ghostCurves(scene);
  }

  function boundsOf(curves) {
    var b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
    function pt(q) {
      b.x1 = Math.min(b.x1, q[0]);
      b.y1 = Math.min(b.y1, q[1]);
      b.x2 = Math.max(b.x2, q[0]);
      b.y2 = Math.max(b.y2, q[1]);
    }
    curves.forEach(function (c) {
      if (!c) return;
      if (c.type === "circle") {
        pt([c.c[0] - c.r, c.c[1] - c.r]);
        pt([c.c[0] + c.r, c.c[1] + c.r]);
      } else if (c.type === "poly") {
        c.pts.forEach(pt);
      } else {
        pt(c.a);
        pt(c.b);
      }
    });
    return isFinite(b.x1) ? b : null;
  }

  function renderGhosts(scene) {
    if (state.tool === "select") return "";
    if (!selectedCurves(scene).length) return "";
    var list = ghostList(scene);
    var html = "";
    if (state.tool === "mirror" && !state.params.mirror.keep) {
      // the mirrored copies become the result; the originals are replaced
      list.forEach(function (c) {
        html += curveEl(c, "sc-wash");
        html += curveEl(c, "sc-curve");
      });
      return html;
    }
    list.forEach(function (c) {
      html += curveEl(c, "sc-ghost");
    });
    return html;
  }

  function manipRect(scene) {
    var p = state.params.rect;
    var html = "";
    var sel = selectedCurves(scene);
    var anchor = scene.anchor || centroid(sel) || [0, 0];
    var a1 = p.axis1 === "y" ? [0, 1] : [1, 0];
    var n1 = Math.max(1, Math.round(p.count1));
    var c1 = p.symmetric ? (n1 - 1) / 2 : 0;
    var p1 = perpScreen(a1);
    var start = add(anchor, mul(a1, -c1 * p.dist1));
    var end = add(anchor, mul(a1, (n1 - 1 - c1) * p.dist1));
    html += lineEl(start, end, "sc-construct");
    for (var i = 0; i < n1; i++) {
      html += tickEl(add(anchor, mul(a1, (i - c1) * p.dist1)), p1, "sc-tick");
    }
    html += arrowPath(anchor, add(anchor, mul(a1, p.dist1)), "sc-manip");
    html += handleEl(add(anchor, mul(a1, p.dist1)), "rect1");
    html += labelEl(
      add(anchor, mul(a1, p.dist1)),
      fmt(p.dist1) + " mm",
      p.axis1 === "y" ? 10 : 0,
      p.axis1 === "y" ? 4 : -9
    );
    if (p.dir2) {
      var a2 = p.axis2 === "y" ? [0, 1] : [1, 0];
      var n2 = Math.max(1, Math.round(p.count2));
      var c2 = p.symmetric ? (n2 - 1) / 2 : 0;
      var p2 = perpScreen(a2);
      html += lineEl(
        add(anchor, mul(a2, -c2 * p.dist2)),
        add(anchor, mul(a2, (n2 - 1 - c2) * p.dist2)),
        "sc-construct"
      );
      for (var j = 0; j < n2; j++) {
        html += tickEl(add(anchor, mul(a2, (j - c2) * p.dist2)), p2, "sc-tick");
      }
      html += arrowPath(anchor, add(anchor, mul(a2, p.dist2)), "sc-manip");
      html += handleEl(add(anchor, mul(a2, p.dist2)), "rect2");
      html += labelEl(
        add(anchor, mul(a2, p.dist2)),
        fmt(p.dist2) + " mm",
        p.axis2 === "y" ? 10 : 0,
        p.axis2 === "y" ? 4 : 12
      );
    }
    return html;
  }

  function manipCircular(scene) {
    var p = state.params.circular;
    var center = scene.axis || [0, 0];
    var sel = selectedCurves(scene);
    var cen = centroid(sel) || center;
    var R = vlen(sub(cen, center));
    var html = "";
    html += circleScreenEl(center, R * VB.s, "sc-construct");
    html += crosshairEl(center);
    var angles = circAngles(p);
    angles.forEach(function (deg) {
      var a = deg2rad(deg);
      html += circleScreenEl(
        add(center, mul([Math.cos(a), Math.sin(a)], R)),
        3,
        "sc-ghost-point"
      );
    });
    var partial = p.mode === "extent" && p.angle < 359.9;
    if (partial) {
      var samples = 28;
      var d = "";
      for (var k = 0; k <= samples; k++) {
        var a2 = deg2rad((p.angle * k) / samples);
        var q = add(center, mul([Math.cos(a2), Math.sin(a2)], R));
        d += (k === 0 ? "M " : " L ") + sp(q);
      }
      html += '<path d="' + d + '" class="sc-manip" fill="none"/>';
      var lastA = deg2rad(p.angle);
      var tip = add(center, mul([Math.cos(lastA), Math.sin(lastA)], R));
      html += handleEl(tip, "circAngle");
    }
    var step = circStep(p);
    html += labelEl(
      add(center, mul([0, 1], R)),
      angles.length + " \u00d7 " + fmt(step) + "\u00b0",
      10,
      -8
    );
    return html;
  }

  function manipMirror(scene) {
    var p = state.params.mirror;
    var ml = mirrorLine(scene, p);
    var b = sceneBounds(scene);
    var u = unit(ml.d);
    var corners = [
      [b.x1, b.y1],
      [b.x2, b.y1],
      [b.x2, b.y2],
      [b.x1, b.y2]
    ];
    var proj = corners.map(function (c) {
      return dot(sub(c, ml.o), u);
    });
    var t1 = Math.min.apply(null, proj) - 14;
    var t2 = Math.max.apply(null, proj) + 14;
    var P1 = add(ml.o, mul(u, t1));
    var P2 = add(ml.o, mul(u, t2));
    var html = lineEl(P1, P2, "sc-mirror");
    html += labelEl(mid(P1, P2), "mirror line", 10, -8, "is-quiet");
    // reflection connectors for the selected endpoints
    var seen = {};
    selectedCurves(scene).forEach(function (c) {
      var ends = c.type === "circle" ? [c.c] : [c.a, c.b];
      ends.forEach(function (e) {
        var key = e[0] + "," + e[1];
        if (seen[key]) return;
        seen[key] = true;
        var r = reflect(e, ml.o, ml.d);
        if (vlen(sub(r, e)) > 1) {
          html +=
            '<line x1="' + px(e)[0].toFixed(1) + '" y1="' + px(e)[1].toFixed(1) +
            '" x2="' + px(r)[0].toFixed(1) + '" y2="' + px(r)[1].toFixed(1) +
            '" class="sc-construct"/>';
        }
      });
    });
    return html;
  }

  function manipOffset(scene) {
    var p = state.params.offset;
    var sel = selectedCurves(scene).filter(function (c) {
      return c.type === "line";
    });
    if (!sel.length) return "";
    var pts = orderedChain(sel);
    if (pts.length < 3) return "";
    var closed = near(pts[0], pts[pts.length - 1]);
    if (closed) pts = pts.slice(0, -1);
    var best = null;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i],
        b = pts[(i + 1) % pts.length];
      var L = vlen(sub(b, a));
      if (!best || L > best.L) best = { a: a, b: b, L: L };
    }
    var m = mid(best.a, best.b);
    var t = unit(sub(best.b, best.a));
    var nrm = [-t[1], t[0]];
    var area = signedArea(pts);
    var outward = area > 0 ? -1 : 1;
    var signed = outward * p.dist * p.side;
    var to = add(m, mul(nrm, signed));
    var html = arrowPath(m, to, "sc-manip", true);
    html += handleEl(to, "offset");
    html += labelEl(to, fmt(p.dist) + " mm", 10, -8);
    return html;
  }

  function renderManip(scene) {
    if (state.tool === "select") return "";
    if (!selectedCurves(scene).length) return "";
    if (state.tool === "rect") return manipRect(scene);
    if (state.tool === "circular") return manipCircular(scene);
    if (state.tool === "mirror") return manipMirror(scene);
    if (state.tool === "offset") return manipOffset(scene);
    return "";
  }

  /* ------------------------------------------------------------------ */
  /* status + summary                                                    */
  /* ------------------------------------------------------------------ */

  function summary() {
    var p = state.params[state.tool];
    if (state.tool === "rect") {
      var n1 = Math.max(1, Math.round(p.count1));
      var n2 = p.dir2 ? Math.max(1, Math.round(p.count2)) : 1;
      return n1 + " \u00d7 " + n2 + " copies \u00b7 " + fmt(p.dist1) + " mm";
    }
    if (state.tool === "circular") {
      var n = Math.max(1, Math.round(p.count));
      return n + " copies \u00b7 " + fmt(circStep(p)) + "\u00b0 apart";
    }
    if (state.tool === "mirror") {
      return (
        (p.line === "y" ? "Y axis" : "X axis") +
        " \u00b7 " + (p.keep ? "keep original" : "replace original")
      );
    }
    if (state.tool === "offset") {
      return (
        fmt(p.dist) + " mm \u00b7 " + (p.side === 1 ? "outside" : "inside") +
        " \u00b7 " + p.corner
      );
    }
    return "";
  }

  function renderStatus() {
    var scene = SCENES[state.scene];
    var sel = selectedCurves(scene);
    var parts = [];
    if (state.tool === "select") {
      parts.push("<b>select</b>");
      parts.push("click geometry to build a selection");
    } else {
      parts.push("<b>" + SPECS[state.tool].title + "</b>");
      parts.push(summary());
    }
    parts.push(sel.length + (sel.length === 1 ? " curve selected" : " curves selected"));
    if (state.message) parts.push(state.message);
    statusLine.innerHTML = parts.join(" \u00b7 ");
  }

  function renderLegend() {
    if (state.tool === "select") {
      legendEl.innerHTML =
        '<span class="key"><span class="swatch is-selected"></span>selected</span>';
      return;
    }
    legendEl.innerHTML =
      '<span class="key"><span class="swatch is-selected"></span>original</span>' +
      '<span class="key"><span class="swatch is-ghost"></span>preview</span>';
  }

  /* ------------------------------------------------------------------ */
  /* tool panel                                                          */
  /* ------------------------------------------------------------------ */

  function rowHtml(row, p) {
    var v = p[row.key];
    var label = '<span class="tool-label">' + row.label + "</span>";
    var ctrl = "";
    if (row.type === "seg") {
      ctrl =
        '<div class="seg" data-key="' + row.key + '">' +
        row.options
          .map(function (o) {
            return (
              '<button type="button" data-value="' + o[0] + '" class="' +
              (String(v) === String(o[0]) ? "is-selected" : "") + '">' +
              o[1] + "</button>"
            );
          })
          .join("") +
        "</div>";
    } else if (row.type === "stepper") {
      ctrl =
        '<div class="stepper" data-key="' + row.key + '">' +
        '<button type="button" data-step="-1">\u2212</button>' +
        '<span class="stepper-value">' + v + "</span>" +
        '<button type="button" data-step="1">+</button></div>';
    } else if (row.type === "input") {
      ctrl =
        '<label class="tool-input"><input type="text" inputmode="decimal" data-input="' +
        row.key + '" value="' + fmt(v) + '">' +
        '<span class="unit">' + (row.unit || "") + "</span></label>";
    } else if (row.type === "toggle") {
      ctrl =
        '<button type="button" class="toggle" data-key="' + row.key +
        '" aria-pressed="' + (v ? "true" : "false") + '">' +
        (v ? "on" : "off") + "</button>";
    } else if (row.type === "static") {
      ctrl = '<span class="tool-note">' + row.value + "</span>";
    }
    return (
      '<div class="tool-row">' + label + ctrl + "</div>"
    );
  }

  function renderPanel() {
    if (state.tool === "select") {
      panel.hidden = true;
      return;
    }
    var spec = SPECS[state.tool];
    var p = state.params[state.tool];
    var html =
      '<div class="tool-panel-head"><div>' +
      '<div class="tool-panel-kicker">sketch tool</div>' +
      '<h2 class="tool-panel-title">' + spec.title + "</h2></div>" +
      '<button type="button" class="text-action is-quiet" data-cancel>cancel</button></div>';
    html += '<div class="tool-panel-body">';
    spec.rows.forEach(function (row) {
      if (row.when && !row.when(p)) return;
      html += rowHtml(row, p);
    });
    html += "</div>";
    html +=
      '<div class="tool-panel-foot"><span class="tool-summary">' + summary() +
      '</span><span class="tool-panel-actions">' +
      '<button type="button" class="text-action" data-apply>apply</button>' +
      "</span></div>";
    panel.innerHTML = html;
    panel.hidden = false;
  }

  function updateSummary() {
    var el = panel.querySelector(".tool-summary");
    if (el) el.textContent = summary();
  }

  /* ------------------------------------------------------------------ */
  /* panel events                                                        */
  /* ------------------------------------------------------------------ */

  function setParam(key, val) {
    var p = state.params[state.tool];
    if (typeof p[key] === "number") {
      var n = Number(val);
      if (isNaN(n)) return;
      p[key] = n;
    } else {
      p[key] = val;
    }
    if (key === "count1" || key === "count2" || key === "count") {
      p[key] = clamp(Math.round(p[key]), 1, 12);
    }
    if (key === "dist1" || key === "dist2") p[key] = clamp(p[key], 0.5, 500);
    if (key === "dist") p[key] = clamp(p[key], 0.5, 200);
    if (key === "angle") p[key] = clamp(p[key], 1, 360);
  }

  function bump(key, delta) {
    var p = state.params[state.tool];
    p[key] = clamp(Math.round(p[key] + delta), 1, 12);
  }

  function toggleParam(key) {
    var p = state.params[state.tool];
    p[key] = !p[key];
  }

  function wirePanel() {
    panel.addEventListener("click", function (e) {
      var t = e.target;
      var seg = t.closest(".seg button");
      if (seg) {
        setParam(seg.closest(".seg").getAttribute("data-key"), seg.getAttribute("data-value"));
        render();
        return;
      }
      var step = t.closest(".stepper button");
      if (step) {
        bump(step.closest(".stepper").getAttribute("data-key"), Number(step.getAttribute("data-step")));
        render();
        return;
      }
      var tog = t.closest(".toggle");
      if (tog) {
        toggleParam(tog.getAttribute("data-key"));
        render();
        return;
      }
      if (t.closest("[data-cancel]")) {
        setTool("select");
        return;
      }
      if (t.closest("[data-apply]")) {
        state.message = "applied";
        renderStatus();
        return;
      }
    });
    panel.addEventListener("input", function (e) {
      var inp = e.target.closest("[data-input]");
      if (!inp) return;
      setParam(inp.getAttribute("data-input"), inp.value);
      renderCanvas();
      updateSummary();
      layoutPanel();
    });
  }

  /* ------------------------------------------------------------------ */
  /* panel placement                                                     */
  /* ------------------------------------------------------------------ */

  function viewToCss(x, y) {
    var svgRect = svg.getBoundingClientRect();
    var vpRect = viewport.getBoundingClientRect();
    var s = Math.min(svgRect.width / VB.w, svgRect.height / VB.h);
    var offX = (svgRect.width - VB.w * s) / 2 + (svgRect.left - vpRect.left);
    var offY = (svgRect.height - VB.h * s) / 2 + (svgRect.top - vpRect.top);
    return [offX + x * s, offY + y * s];
  }

  function selectionScreenBounds(scene) {
    var sel = selectedCurves(scene);
    if (!sel.length) return null;
    return boundsOf(sel.concat(ghostList(scene)));
  }

  function layoutPanel() {
    if (panel.hidden) return;
    var scene = SCENES[state.scene];
    var b = selectionScreenBounds(scene);
    var vw = viewport.clientWidth;
    var vh = viewport.clientHeight;
    var pw = panel.offsetWidth;
    var ph = panel.offsetHeight;
    var left, top;
    if (b) {
      var right = viewToCss(b.x2 * VB.s + VB.ox, 0)[0];
      var topPx = viewToCss(0, VB.oy - b.y2 * VB.s)[1];
      left = right + 20;
      top = topPx - 6;
      if (left + pw > vw - 12) {
        var leftEdge = viewToCss(b.x1 * VB.s + VB.ox, 0)[0];
        left = leftEdge - pw - 20;
      }
    } else {
      left = vw - pw - 24;
      top = 24;
    }
    left = clamp(left, 12, Math.max(12, vw - pw - 12));
    top = clamp(top, 12, Math.max(12, vh - ph - 12));
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  }

  /* ------------------------------------------------------------------ */
  /* render pipeline                                                     */
  /* ------------------------------------------------------------------ */

  function renderCanvas() {
    var scene = SCENES[state.scene];
    layers.ref.innerHTML = renderRefs(scene);
    layers.ghost.innerHTML = renderGhosts(scene);
    layers.selection.innerHTML = renderSelection(scene);
    layers.geometry.innerHTML = renderGeometry(scene);
    layers.manip.innerHTML = renderManip(scene);
    renderStatus();
    renderLegend();
    var hasSel = selectedCurves(scene).length > 0;
    prompt.hidden = !(state.tool !== "select" && !hasSel);
    if (state.tool !== "select" && !hasSel) {
      prompt.textContent =
        "select geometry to " +
        (state.tool === "rect" || state.tool === "circular" ? "pattern" : state.tool);
    }
  }

  function render() {
    renderCanvas();
    renderPanel();
    layoutPanel();
  }

  /* ------------------------------------------------------------------ */
  /* timeline                                                            */
  /* ------------------------------------------------------------------ */

  var TIMELINES = {
    rect: {
      active: "02",
      steps: [
        ["01", "sketch", "bolt plate", "XY · plate + hole"],
        ["02", "pattern", "hole grid", "rect · 4 × 2"]
      ],
      detail: [["step", "hole grid"], ["source", "sketch 01"], ["copies", "8"]]
    },
    circular: {
      active: "02",
      steps: [
        ["01", "sketch", "flange", "XY · centre + bolt"],
        ["02", "pattern", "bolt circle", "circular · 6"]
      ],
      detail: [["step", "bolt circle"], ["axis", "sketch origin"], ["sweep", "360°"]]
    },
    mirror: {
      active: "02",
      steps: [
        ["01", "sketch", "half profile", "XY · 5 curves"],
        ["02", "mirror", "symmetric body", "Y axis"]
      ],
      detail: [["step", "symmetric body"], ["line", "Y axis"], ["keep", "original"]]
    },
    offset: {
      active: "02",
      steps: [
        ["01", "sketch", "L profile", "XY · closed loop"],
        ["02", "offset", "outer wall", "8.0 mm · miter"]
      ],
      detail: [["step", "outer wall"], ["distance", "8.0 mm"], ["side", "outside"]]
    }
  };

  function renderTimeline() {
    var t = TIMELINES[state.scene];
    if (!t) return;
    stepsEl.innerHTML = t.steps
      .map(function (s) {
        var cls = "step" + (s[0] === t.active ? " is-active" : "");
        return (
          '<button class="' + cls + '" type="button">' +
          '<span class="step-index">' + s[0] + "</span>" +
          '<span class="step-kind">' + s[1] + "</span>" +
          '<span class="step-name">' + s[2] + "</span>" +
          '<span class="step-meta">' + s[3] + "</span></button>"
        );
      })
      .join("");
    detailEl.innerHTML = t.detail
      .map(function (d) {
        return (
          '<span class="detail-item"><span class="detail-key">' + d[0] +
          '</span><span class="detail-value">' + d[1] + "</span></span>"
        );
      })
      .join("");
  }

  /* ------------------------------------------------------------------ */
  /* tool switching + selection                                          */
  /* ------------------------------------------------------------------ */

  function updateToolLine() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-tool]"), function (btn) {
      var on = btn.getAttribute("data-tool") === state.tool;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", String(on));
    });
  }

  function setTool(tool) {
    if (!SPECS[tool] && tool !== "select") return;
    state.tool = tool;
    state.message = "";
    if (tool !== "select") {
      state.scene = tool;
      state.selection = SCENES[tool].defaultSelection.slice();
    }
    updateToolLine();
    renderTimeline();
    render();
  }

  function toggleSelection(id) {
    var i = state.selection.indexOf(id);
    if (i === -1) state.selection.push(id);
    else state.selection.splice(i, 1);
  }

  /* ------------------------------------------------------------------ */
  /* pointer interaction                                                 */
  /* ------------------------------------------------------------------ */

  function clientToMm(e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    var m = svg.getScreenCTM().inverse();
    var q = pt.matrixTransform(m);
    return [(q.x - VB.ox) / VB.s, (VB.oy - q.y) / VB.s];
  }

  function onPointerDown(e) {
    var h = e.target.closest ? e.target.closest("[data-handle]") : null;
    if (!h) return;
    state.drag = h.getAttribute("data-handle");
    state.justDragged = false;
    try {
      svg.setPointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    e.preventDefault();
  }

  function applyDrag(mm) {
    var scene = SCENES[state.scene];
    var p = state.params[state.tool];
    if (state.drag === "rect1") {
      var anchor = scene.anchor || centroid(selectedCurves(scene)) || [0, 0];
      var a1 = p.axis1 === "y" ? [0, 1] : [1, 0];
      p.dist1 = clamp(dot(sub(mm, anchor), a1), 1, 500);
    } else if (state.drag === "rect2") {
      var anchor2 = scene.anchor || centroid(selectedCurves(scene)) || [0, 0];
      var a2 = p.axis2 === "y" ? [0, 1] : [1, 0];
      p.dist2 = clamp(dot(sub(mm, anchor2), a2), 1, 500);
    } else if (state.drag === "circAngle") {
      var center = scene.axis || [0, 0];
      var v = sub(mm, center);
      var deg = (Math.atan2(v[1], v[0]) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      p.angle = clamp(deg, 5, 360);
      p.mode = "extent";
    } else if (state.drag === "offset") {
      var sel = selectedCurves(scene).filter(function (c) {
        return c.type === "line";
      });
      if (!sel.length) return;
      var pts = orderedChain(sel);
      if (pts.length < 3) return;
      var closed = near(pts[0], pts[pts.length - 1]);
      if (closed) pts = pts.slice(0, -1);
      var best = null;
      for (var i = 0; i < pts.length; i++) {
        var a = pts[i],
          b = pts[(i + 1) % pts.length];
        var L = vlen(sub(b, a));
        if (!best || L > best.L) best = { a: a, b: b, L: L };
      }
      var m = mid(best.a, best.b);
      var t = unit(sub(best.b, best.a));
      var nrm = [-t[1], t[0]];
      var area = signedArea(pts);
      var outward = area > 0 ? -1 : 1;
      var signed = dot(sub(mm, m), nrm);
      p.dist = clamp(Math.abs(signed), 0.5, 200);
      p.side = signed * outward > 0 ? 1 : -1;
    }
  }

  function onPointerMove(e) {
    if (!state.drag) return;
    state.justDragged = true;
    applyDrag(clientToMm(e));
    renderCanvas();
    updateSummary();
    layoutPanel();
  }

  function onPointerUp(e) {
    if (!state.drag) return;
    state.drag = null;
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch (err) {
      /* ignore */
    }
    // a click fires after pointerup; swallow it if we actually dragged
    if (state.justDragged) {
      setTimeout(function () {
        state.justDragged = false;
      }, 0);
    }
  }

  function wireSvg() {
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
    svg.addEventListener("click", function (e) {
      if (state.justDragged) return;
      var el = e.target.closest ? e.target.closest("[data-curve]") : null;
      if (!el) return;
      toggleSelection(el.getAttribute("data-curve"));
      render();
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-tool]"), function (btn) {
      btn.addEventListener("click", function () {
        setTool(btn.getAttribute("data-tool"));
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */

  function boot() {
    initDom();
    wirePanel();
    wireSvg();
    var params = new URLSearchParams(window.location.search);
    var tool = params.get("tool");
    setTool(tool && (SPECS[tool] || tool === "select") ? tool : "rect");
    window.addEventListener("resize", function () {
      layoutPanel();
    });
    if (window.M && window.M.hydrateIcons) window.M.hydrateIcons(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
