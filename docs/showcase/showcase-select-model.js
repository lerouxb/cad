/*
 * Model-mode selection: the select tools and their own filters (edges / faces /
 * bodies) on a 3D body, in the same tool options row the sketch study uses.
 * Design target only — not imported by src/. See docs/showcase/TIMELINE.md:
 * the options row follows the tool, not the mode.
 */
(function () {
  "use strict";

  var K = 0.8660254;
  var VIEW = { cx: 520, cy: 420, s: 3.1 };

  function P(x, y, z) {
    return [VIEW.cx + (x - y) * K * VIEW.s, VIEW.cy + (x + y) * 0.5 * VIEW.s - z * VIEW.s];
  }
  function f(q) {
    return q[0].toFixed(1) + "," + q[1].toFixed(1);
  }
  function xs(q) {
    return q[0].toFixed(1);
  }
  function ys(q) {
    return q[1].toFixed(1);
  }

  // two disjoint plates, so the body filter has more than one thing to pick
  var BODIES = {
    body: [0, 0, 0, 30, 50, 14],
    lid: [76, 4, 0, 110, 44, 14]
  };

  // the three faces an isometric view shows: top (+z), the +x side, the +y front
  var FACES = [
    { name: "top", keys: ["001", "101", "111", "011"], shade: 1 },
    { name: "side", keys: ["100", "110", "111", "101"], shade: 2 },
    { name: "front", keys: ["010", "110", "111", "011"], shade: 3 }
  ];

  function corners(b) {
    var v = {};
    [
      [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
      [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]
    ].forEach(function (c) {
      v[c.join("")] = P(
        c[0] ? b[3] : b[0], c[1] ? b[4] : b[1], c[2] ? b[5] : b[2]
      );
    });
    return v;
  }

  function edgeList(v) {
    var seen = {};
    var out = [];
    FACES.forEach(function (face) {
      for (var i = 0; i < face.keys.length; i++) {
        var a = face.keys[i];
        var b = face.keys[(i + 1) % face.keys.length];
        var key = a < b ? a + "|" + b : b + "|" + a;
        if (seen[key]) continue;
        seen[key] = true;
        out.push([a, b]);
      }
    });
    return out;
  }

  // the scene: face polygons are the pick targets, and each edge gets a wide
  // transparent hit stroke under a thin visible line
  var scene = [];
  Object.keys(BODIES).forEach(function (id) {
    var v = corners(BODIES[id]);
    FACES.forEach(function (face) {
      scene.push({
        kind: "face", body: id, face: face.name,
        pts: face.keys.map(function (k) { return v[k]; }),
        shade: face.shade
      });
    });
    edgeList(v).forEach(function (e, i) {
      scene.push({ kind: "edge", body: id, i: i, a: v[e[0]], b: v[e[1]] });
    });
  });

  var FILTERS = ["all", "edges", "faces", "bodies"];
  var state = { tool: "select", filter: "all", hover: null, hits: [], other: 0, sel: null, cursor: null };

  var svg, layerScene, layerHover, layerSel, optionsEl, otherEl, panel, viewport, foot;

  function facePath(pts) {
    return "M " + pts.map(f).join(" L ") + " Z";
  }

  function renderScene() {
    var html = "";
    scene.forEach(function (it) {
      if (it.kind === "face") {
        html +=
          '<polygon class="ms-face ms-shade-' + it.shade + '" points="' +
          it.pts.map(f).join(" ") + '" data-pick="face" data-body="' + it.body +
          '" data-face="' + it.face + '"/>';
      }
    });
    scene.forEach(function (it) {
      if (it.kind !== "edge") return;
      var a = 'x1="' + xs(it.a) + '" y1="' + ys(it.a) + '" x2="' + xs(it.b) +
        '" y2="' + ys(it.b) + '"';
      html +=
        '<line class="ms-edge-hit" ' + a + ' data-pick="edge" data-body="' +
        it.body + '" data-edge="' + it.i + '"/>';
      html += '<line class="ms-edge" ' + a + "/>";
    });
    layerScene.innerHTML = html;
    svg.setAttribute("data-filter", state.filter);
  }

  function drawItem(it, cls) {
    if (!it) return "";
    if (it.kind === "edge") {
      var a = 'x1="' + xs(it.a) + '" y1="' + ys(it.a) + '" x2="' + xs(it.b) +
        '" y2="' + ys(it.b) + '"';
      // hover is the block alone over the body's ink edge; selection adds the
      // ink centerline on top, so the edge reads like a selected sketch line.
      var out = '<line class="' + cls + '-edge" ' + a + "/>";
      if (cls === "ms-sel") out += '<line class="ms-sel-ink" ' + a + "/>";
      return out;
    }
    var faces = it.kind === "body"
      ? scene.filter(function (s) { return s.kind === "face" && s.body === it.body; })
      : [it];
    return faces.map(function (fa) {
      return '<path class="' + cls + '-face" d="' + facePath(fa.pts) + '"/>';
    }).join("");
  }

  function renderOverlays() {
    layerHover.innerHTML = drawItem(state.hover, "ms-hover");
    layerSel.innerHTML = drawItem(state.sel, "ms-sel");
  }

  /* ------------------------------------------------------------------ */
  /* the options row                                                     */
  /* ------------------------------------------------------------------ */

  function filterNote() {
    if (state.filter === "all") return "edges, faces and bodies";
    return "only " + state.filter + " can be picked";
  }

  function renderOptions() {
    optionsEl.innerHTML =
      '<span class="tool-kicker">filter</span>' +
      FILTERS.map(function (o) {
        return (
          '<button class="tool-option' + (state.filter === o ? " is-on" : "") +
          '" type="button" data-option="' + o + '">' + o + "</button>"
        );
      }).join("") +
      '<span class="tool-note">' + filterNote() + "</span>";
  }

  function renderOther() {
    if (state.hits.length < 2 || !state.cursor) {
      otherEl.hidden = true;
      return;
    }
    var vr = viewport.getBoundingClientRect();
    otherEl.hidden = false;
    otherEl.innerHTML =
      '<span class="sel-other-kind">' + state.hits[state.other].kind + "</span>" +
      '<span class="sel-other-count">' + (state.other + 1) + " of " +
      state.hits.length + "</span><span>click to cycle</span>";
    otherEl.style.left = state.cursor[0] - vr.left + 14 + "px";
    otherEl.style.top = state.cursor[1] - vr.top + 16 + "px";
  }

  function renderPanel() {
    if (!state.sel) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    var it = state.sel;
    panel.innerHTML =
      '<div class="tool-panel-head"><div>' +
      '<div class="tool-panel-kicker">selection</div>' +
      '<h2 class="tool-panel-title">' + it.kind + "</h2></div></div>" +
      '<div class="tool-panel-body">' +
      '<div class="tool-row"><span class="tool-label">body</span>' +
      '<span class="tool-note">' + it.body + "</span></div>" +
      (it.kind === "face"
        ? '<div class="tool-row"><span class="tool-label">face</span>' +
          '<span class="tool-note">' + it.face + "</span></div>"
        : "") +
      '<div class="tool-hint">the selection popover is its own study</div>' +
      ShowcaseUI.footer("1 " + it.kind, [
        { id: "isolate", label: "isolate", quiet: true }
      ]);
    if (!panel.dataset.dragged) {
      panel.style.left = "auto";
      panel.style.top = "24px";
      panel.style.right = "24px";
    }
  }

  /* ------------------------------------------------------------------ */
  /* hit testing (geometric, so Select Other can list every hit)          */
  /* ------------------------------------------------------------------ */

  function dist(a, b) {
    var dx = a[0] - b[0];
    var dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }
  function distToSegment(p, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return dist(p, [a[0] + t * dx, a[1] + t * dy]);
  }
  function inPoly(p, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i];
      var b = pts[j];
      if (a[1] > p[1] !== b[1] > p[1] &&
          p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
        inside = !inside;
      }
    }
    return inside;
  }

  function allowed(it) {
    if (state.filter === "all") return true;
    if (state.filter === "bodies") return it.kind === "face";
    return it.kind === state.filter.slice(0, -1);
  }

  function hitsAt(v) {
    var hits = [];
    scene.forEach(function (it) {
      if (!allowed(it)) return;
      if (it.kind === "edge") {
        var d = distToSegment(v, it.a, it.b);
        if (d <= 7) hits.push({ it: it, d: d });
      } else if (inPoly(v, it.pts)) {
        hits.push({ it: it, d: 99 });
      }
    });
    hits.sort(function (a, b) { return a.d - b.d; });
    return hits.map(function (h) {
      // with the body filter a face pick means the whole body
      return state.filter === "bodies" ? { kind: "body", body: h.it.body } : h.it;
    });
  }

  function viewFromEvent(e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    var m = svg.getScreenCTM();
    if (!m) return null;
    var v = pt.matrixTransform(m.inverse());
    return [v.x, v.y];
  }

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */

  function render() {
    renderScene();
    renderOverlays();
    renderOptions();
    renderOther();
    renderPanel();
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-tool]"),
      function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-tool") === state.tool);
      }
    );
    var modeEl = document.getElementById("sm-mode");
    if (modeEl) modeEl.textContent = state.tool;
    foot.innerHTML =
      "<b>" + state.tool + "</b> \u00b7 filter: " + state.filter +
      (state.sel ? " \u00b7 selected " + state.sel.kind : "");
  }

  function boot() {
    viewport = document.getElementById("viewport");
    svg = document.getElementById("svg");
    layerScene = document.getElementById("sm-scene");
    layerHover = document.getElementById("sm-hover");
    layerSel = document.getElementById("sm-sel");
    optionsEl = document.getElementById("tool-options");
    otherEl = document.getElementById("sel-other");
    panel = document.getElementById("sm-panel");
    foot = document.getElementById("sm-foot");
    ShowcaseUI.makeDraggable(panel, viewport);

    Array.prototype.forEach.call(
      document.querySelectorAll("[data-tool]"),
      function (b) {
        b.addEventListener("click", function () {
          state.tool = b.getAttribute("data-tool");
          state.hits = [];
          state.hover = null;
          state.other = 0;
          render();
        });
      }
    );

    optionsEl.addEventListener("click", function (e) {
      var opt = e.target.closest("[data-option]");
      if (!opt) return;
      state.filter = opt.getAttribute("data-option");
      state.hits = [];
      state.hover = null;
      state.other = 0;
      if (state.sel && !allowed(state.sel)) state.sel = null;
      render();
    });

    svg.addEventListener("mousemove", function (e) {
      state.cursor = [e.clientX, e.clientY];
      var v = viewFromEvent(e);
      var hits = v ? hitsAt(v) : [];
      state.hits = hits;
      if (hits.length === 0) {
        state.other = 0;
        state.hover = null;
      } else {
        if (state.other >= hits.length) state.other = 0;
        state.hover = hits[state.other];
      }
      renderOverlays();
      renderOther();
    });

    svg.addEventListener("mouseleave", function () {
      state.hits = [];
      state.hover = null;
      state.cursor = null;
      renderOverlays();
      renderOther();
    });

    svg.addEventListener("click", function () {
      if (state.hits.length === 0) {
        state.sel = null;
      } else if (state.hits.length > 1) {
        state.sel = state.hits[state.other];
        state.other = (state.other + 1) % state.hits.length;
        state.hover = state.hits[state.other];
      } else {
        state.sel = state.hits[0];
      }
      renderOverlays();
      renderOther();
      renderPanel();
      render();
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
