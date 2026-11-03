/*
 * Selection filters as a tool options row. Design target only — not imported by
 * src/. One row under the tool line holds the current tool's options: the
 * selection filters (points / curves / dimensions) for select / box / lasso, and
 * the create variants (centre / 2-point / 3-point) for rect / circle / arc. See
 * docs/showcase/TIMELINE.md.
 */
(function () {
  "use strict";

  var VB = { w: 1200, h: 700, ox: 520, oy: 430, s: 3.6 };

  function px(p) {
    return [VB.ox + p[0] * VB.s, VB.oy - p[1] * VB.s];
  }
  function n(v) {
    return Number(v).toFixed(1);
  }
  function line(a, b, cls) {
    var A = px(a);
    var B = px(b);
    return (
      '<line x1="' + n(A[0]) + '" y1="' + n(A[1]) + '" x2="' + n(B[0]) +
      '" y2="' + n(B[1]) + '" class="' + cls + '"/>'
    );
  }
  function dot(p, cls, r) {
    var P = px(p);
    return (
      '<circle cx="' + n(P[0]) + '" cy="' + n(P[1]) + '" r="' + (r || 3.4) +
      '" class="' + cls + '"/>'
    );
  }
  function ring(c, r, cls) {
    var C = px(c);
    return (
      '<circle cx="' + n(C[0]) + '" cy="' + n(C[1]) + '" r="' + n(r * VB.s) +
      '" class="' + cls + '"/>'
    );
  }
  function arc(c, r, a0, a1, cls) {
    var C = px(c);
    var rp = r * VB.s;
    var x0 = C[0] + rp * Math.cos(a0);
    var y0 = C[1] - rp * Math.sin(a0);
    var x1 = C[0] + rp * Math.cos(a1);
    var y1 = C[1] - rp * Math.sin(a1);
    var large = a1 - a0 > Math.PI ? 1 : 0;
    return (
      '<path d="M ' + n(x0) + " " + n(y0) + " A " + n(rp) + " " + n(rp) +
      " 0 " + large + " 0 " + n(x1) + " " + n(y1) + '" class="' + cls + '"/>'
    );
  }

  var L1 = { a: [12, 14], b: [82, 14] };
  var L2 = { a: [82, 14], b: [82, 58] };
  var C1 = { c: [38, 42], r: 17 };
  var P1 = [16, 52];
  var DIM = { a: [12, 14], b: [82, 14], y: -10, text: "70.0" };

  // the pickable things; the corner is shared by both lines, so picks overlap
  var ITEMS = [
    { id: "l1", kind: "curve", shape: "line", a: L1.a, b: L1.b, label: "line" },
    { id: "l2", kind: "curve", shape: "line", a: L2.a, b: L2.b, label: "line" },
    { id: "c1", kind: "curve", shape: "circle", c: C1.c, r: C1.r, label: "circle" },
    { id: "p1", kind: "point", p: P1, label: "point" },
    { id: "pa", kind: "point", p: L1.a, label: "point" },
    { id: "pb", kind: "point", p: L1.b, label: "point" },
    { id: "pc", kind: "point", p: L2.b, label: "point" },
    { id: "dim", kind: "dimension", label: "dimension" }
  ];

  var FILTERS = ["all", "points", "curves", "dimensions"];
  var SHAPES = {
    rect: ["2-point", "centre"],
    circle: ["centre", "2-point", "3-point"],
    arc: ["centre", "3-point", "tangent"]
  };
  var CREATE = { rect: true, circle: true, arc: true };
  var SELECT_TOOLS = { select: true, box: true, lasso: true };

  var state = {
    tool: "select",
    filter: "all",
    variant: { rect: "2-point", circle: "centre", arc: "centre" },
    hover: null,
    hits: [],
    other: 0,
    cursor: null,
    sel: null
  };

  var svg;
  var layerGeom;
  var layerPreview;
  var layerHover;
  var layerWash;
  var optionsEl;
  var otherEl;
  var panel;
  var viewport;
  var foot;

  function findItem(id) {
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].id === id) return ITEMS[i];
    return null;
  }

  function allowed(it) {
    if (state.filter === "all") return true;
    if (state.filter === "points") return it.kind === "point";
    if (state.filter === "curves") return it.kind === "curve";
    if (state.filter === "dimensions") return it.kind === "dimension";
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* geometry                                                            */
  /* ------------------------------------------------------------------ */

  function renderGeom() {
    var html = "";
    ITEMS.forEach(function (it) {
      var cls = allowed(it) ? "" : " is-filtered";
      if (it.kind === "point") {
        html += dot(it.p, "sketch-point" + cls);
      } else if (it.kind === "curve" && it.shape === "line") {
        html += line(it.a, it.b, "sketch-line" + cls);
      } else if (it.kind === "curve" && it.shape === "circle") {
        html += ring(it.c, it.r, "sketch-line" + cls);
      } else if (it.kind === "dimension") {
        var y = DIM.y;
        html += line(DIM.a, [DIM.a[0], y - 3], "dim-ext" + cls);
        html += line(DIM.b, [DIM.b[0], y - 3], "dim-ext" + cls);
        html += line([DIM.a[0], y], [DIM.b[0], y], "dim-line" + cls);
        var mid = px([(DIM.a[0] + DIM.b[0]) / 2, y]);
        html += (
          '<text class="dim-text' + cls + '" x="' + n(mid[0]) + '" y="' +
          n(mid[1] - 8) + '" text-anchor="middle">' + DIM.text + "</text>"
        );
      }
    });
    layerGeom.innerHTML = html;
  }

  function renderHover() {
    var it = state.hover && findItem(state.hover);
    var html = "";
    if (it && !CREATE[state.tool]) {
      if (it.kind === "curve") {
        html += it.shape === "line"
          ? line(it.a, it.b, "sel-hover-line")
          : ring(it.c, it.r, "sel-hover-ring");
      } else if (it.kind === "point") {
        html += dot(it.p, "sel-hover-point", 5);
      } else {
        html += line([DIM.a[0], DIM.y], [DIM.b[0], DIM.y], "sel-hover-line");
      }
    }
    layerHover.innerHTML = html;
  }

  function renderWash() {
    var it = state.sel && findItem(state.sel);
    var html = "";
    if (it && !CREATE[state.tool]) {
      if (it.kind === "curve") {
        html += it.shape === "line"
          ? line(it.a, it.b, "sel-wash-line")
          : ring(it.c, it.r, "sel-wash-line");
      } else if (it.kind === "point") {
        html += dot(it.p, "sel-wash-fill", 7);
      } else {
        html += line([DIM.a[0], DIM.y], [DIM.b[0], DIM.y], "sel-wash-line");
      }
    }
    layerWash.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* the create preview                                                  */
  /* ------------------------------------------------------------------ */

  var PV = { c: [108, 30], r: 15 };

  function renderPreview() {
    if (!CREATE[state.tool]) {
      layerPreview.innerHTML = "";
      return;
    }
    var v = state.variant[state.tool];
    var html = "";
    if (state.tool === "circle") {
      html += ring(PV.c, PV.r, "sel-preview");
      if (v === "centre") {
        html += line(PV.c, [PV.c[0] + PV.r, PV.c[1]], "sel-preview-guide");
        html += dot(PV.c, "sel-preview-handle", 3.2);
      } else if (v === "2-point") {
        html += line([PV.c[0] - PV.r, PV.c[1]], [PV.c[0] + PV.r, PV.c[1]], "sel-preview-guide");
        html += dot([PV.c[0] - PV.r, PV.c[1]], "sel-preview-handle", 3.2);
        html += dot([PV.c[0] + PV.r, PV.c[1]], "sel-preview-handle", 3.2);
      } else {
        var pts = [
          [PV.c[0], PV.c[1] + PV.r],
          [PV.c[0] - PV.r * 0.87, PV.c[1] - PV.r * 0.5],
          [PV.c[0] + PV.r * 0.87, PV.c[1] - PV.r * 0.5]
        ];
        pts.forEach(function (p) {
          html += dot(p, "sel-preview-handle", 3.2);
        });
      }
    } else if (state.tool === "rect") {
      var w = PV.r * 2, h = PV.r * 1.4;
      var x0 = PV.c[0] - (v === "2-point" ? w : w / 2);
      var y0 = PV.c[1] - (v === "2-point" ? h : h / 2);
      var corners = [
        [x0, y0],
        [x0 + w, y0],
        [x0 + w, y0 + h],
        [x0, y0 + h]
      ];
      html +=
        '<rect x="' + n(px(corners[0])[0]) + '" y="' + n(px(corners[3])[1]) +
        '" width="' + n(w * VB.s) + '" height="' + n(h * VB.s) +
        '" class="sel-preview"/>';
      if (v === "2-point") {
        html += dot(corners[0], "sel-preview-handle", 3.2);
        html += dot(corners[2], "sel-preview-handle", 3.2);
        html += line(corners[0], corners[2], "sel-preview-guide");
      } else {
        html += dot(PV.c, "sel-preview-handle", 3.2);
        html += dot(corners[2], "sel-preview-handle", 3.2);
      }
    } else {
      html += arc(PV.c, PV.r, Math.PI * 0.1, Math.PI * 0.9, "sel-preview");
      if (v === "centre") {
        html += line(PV.c, [PV.c[0] + PV.r, PV.c[1]], "sel-preview-guide");
        html += dot(PV.c, "sel-preview-handle", 3.2);
      } else if (v === "3-point") {
        html += dot([PV.c[0] - PV.r * 0.9, PV.c[1] + PV.r * 0.4], "sel-preview-handle", 3.2);
        html += dot([PV.c[0], PV.c[1] + PV.r], "sel-preview-handle", 3.2);
        html += dot([PV.c[0] + PV.r * 0.9, PV.c[1] + PV.r * 0.4], "sel-preview-handle", 3.2);
      } else {
        html += dot([PV.c[0] - PV.r * 0.9, PV.c[1] + PV.r * 0.4], "sel-preview-handle", 3.2);
        html += dot([PV.c[0] + PV.r * 0.9, PV.c[1] + PV.r * 0.4], "sel-preview-handle", 3.2);
      }
    }
    layerPreview.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* the options row                                                     */
  /* ------------------------------------------------------------------ */

  function filterNote() {
    if (state.filter === "all") return "everything can be picked";
    return "only " + state.filter + " can be picked";
  }

  function renderOptions() {
    var tool = state.tool;
    var create = CREATE[tool];
    var opts;
    var kicker;
    if (create) {
      kicker = "shape";
      opts = SHAPES[tool];
    } else if (SELECT_TOOLS[tool]) {
      kicker = "filter";
      opts = FILTERS;
    } else {
      optionsEl.hidden = true;
      return;
    }
    optionsEl.hidden = false;
    optionsEl.innerHTML =
      '<span class="tool-kicker">' + kicker + "</span>" +
      opts
        .map(function (o) {
          var on = create ? state.variant[tool] === o : state.filter === o;
          return (
            '<button class="tool-option' + (on ? " is-on" : "") +
            '" type="button" data-option="' + o + '">' + o + "</button>"
          );
        })
        .join("") +
      (create ? "" : '<span class="tool-note">' + filterNote() + "</span>");
  }

  /* ------------------------------------------------------------------ */
  /* select other                                                        */
  /* ------------------------------------------------------------------ */

  function renderOther() {
    if (state.hits.length < 2 || CREATE[state.tool] || !state.cursor) {
      otherEl.hidden = true;
      return;
    }
    var vr = viewport.getBoundingClientRect();
    otherEl.hidden = false;
    otherEl.innerHTML =
      '<span class="sel-other-kind">' + state.hits[state.other].it.kind + "</span>" +
      '<span class="sel-other-count">' + (state.other + 1) + " of " +
      state.hits.length + "</span><span>click to cycle</span>";
    otherEl.style.left = state.cursor[0] - vr.left + 14 + "px";
    otherEl.style.top = state.cursor[1] - vr.top + 16 + "px";
  }

  /* ------------------------------------------------------------------ */
  /* the selection popover                                               */
  /* ------------------------------------------------------------------ */

  function renderPanel() {
    var it = state.sel && findItem(state.sel);
    if (!it || CREATE[state.tool]) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    panel.innerHTML =
      '<div class="tool-panel-head"><div>' +
      '<div class="tool-panel-kicker">selection</div>' +
      '<h2 class="tool-panel-title">' + it.label + "</h2></div></div>" +
      '<div class="tool-panel-body">' +
      '<div class="tool-row"><span class="tool-label">kind</span>' +
      '<span class="tool-note">' + it.kind + "</span></div>" +
      '<div class="tool-hint">the selection popover is its own study</div>' +
      ShowcaseUI.footer("1 " + it.label, [
        { id: "delete", label: "delete", quiet: true }
      ]);
    if (!panel.dataset.dragged) {
      panel.style.left = "auto";
      panel.style.top = "24px";
      panel.style.right = "24px";
    }
  }

  /* ------------------------------------------------------------------ */
  /* hit testing                                                         */
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

  function hitTest(v) {
    var hits = [];
    ITEMS.forEach(function (it) {
      if (!allowed(it)) return;
      var d = null;
      if (it.kind === "point") {
        d = dist(v, px(it.p)) - 4;
      } else if (it.kind === "curve" && it.shape === "line") {
        d = distToSegment(v, px(it.a), px(it.b));
      } else if (it.kind === "curve" && it.shape === "circle") {
        d = Math.abs(dist(v, px(it.c)) - it.r * VB.s);
      } else if (it.kind === "dimension") {
        d = Math.abs(v[1] - px([0, DIM.y])[1]) + 2;
      }
      if (d !== null && d <= 8) hits.push({ it: it, d: d });
    });
    hits.sort(function (a, b) {
      return a.d - b.d;
    });
    return hits;
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
    renderGeom();
    renderPreview();
    renderHover();
    renderWash();
    renderOptions();
    renderOther();
    renderPanel();
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-tool]"),
      function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-tool") === state.tool);
      }
    );
    var modeEl = document.getElementById("sel-mode");
    if (modeEl) modeEl.textContent = state.tool;
    var create = CREATE[state.tool];
    foot.innerHTML =
      "<b>" + state.tool + "</b> \u00b7 " +
      (create
        ? state.variant[state.tool] + " \u00b7 preview"
        : "filter: " + state.filter) +
      (state.sel && !create ? " \u00b7 selected " + findItem(state.sel).label : "");
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */

  function boot() {
    viewport = document.getElementById("viewport");
    svg = document.getElementById("svg");
    layerGeom = document.getElementById("sel-geom");
    layerPreview = document.getElementById("sel-preview");
    layerHover = document.getElementById("sel-hover");
    layerWash = document.getElementById("sel-wash");
    optionsEl = document.getElementById("tool-options");
    otherEl = document.getElementById("sel-other");
    panel = document.getElementById("sel-panel");
    foot = document.getElementById("sel-foot");
    ShowcaseUI.makeDraggable(panel, viewport);

    Array.prototype.forEach.call(
      document.querySelectorAll("[data-tool]"),
      function (b) {
        b.addEventListener("click", function () {
          state.tool = b.getAttribute("data-tool");
          state.hits = [];
          state.hover = null;
          state.other = 0;
          if (CREATE[state.tool]) state.sel = null;
          render();
        });
      }
    );

    optionsEl.addEventListener("click", function (e) {
      var opt = e.target.closest("[data-option]");
      if (!opt) return;
      var v = opt.getAttribute("data-option");
      if (CREATE[state.tool]) state.variant[state.tool] = v;
      else state.filter = v;
      state.hits = [];
      state.hover = null;
      state.other = 0;
      render();
    });

    otherEl.addEventListener("click", function () {
      if (state.hits.length < 2) return;
      state.other = (state.other + 1) % state.hits.length;
      state.hover = state.hits[state.other].it.id;
      renderHover();
      renderOther();
    });

    svg.addEventListener("mousemove", function (e) {
      state.cursor = [e.clientX, e.clientY];
      if (CREATE[state.tool]) return;
      var v = viewFromEvent(e);
      var hits = v ? hitTest(v) : [];
      state.hits = hits;
      if (hits.length === 0) {
        state.other = 0;
        state.hover = null;
      } else {
        if (state.other >= hits.length) state.other = 0;
        state.hover = hits[state.other].it.id;
      }
      renderHover();
      renderOther();
    });

    svg.addEventListener("mouseleave", function () {
      state.hits = [];
      state.hover = null;
      state.cursor = null;
      renderHover();
      renderOther();
    });

    svg.addEventListener("click", function () {
      if (CREATE[state.tool]) return;
      if (state.hits.length === 0) {
        state.sel = null;
      } else if (state.hits.length > 1) {
        // select what is hovered, then advance so the next click cycles
        state.sel = state.hits[state.other].it.id;
        state.other = (state.other + 1) % state.hits.length;
        state.hover = state.hits[state.other].it.id;
      } else {
        state.sel = state.hits[0].it.id;
      }
      renderHover();
      renderOther();
      renderWash();
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
