/*
 * Sketch create-tool atlas: the drawing variants Fusion exposes per tool.
 * Design target only — not imported by src/.
 *
 * Each tool shows its click sequence (numbered markers), the construction it
 * implies, and the resulting geometry. Polygon is live (sides + mode).
 */
(function () {
  "use strict";

  var VB = { w: 1200, h: 700, ox: 560, oy: 380, s: 3.6 };

  function px(p) {
    return [VB.ox + p[0] * VB.s, VB.oy - p[1] * VB.s];
  }
  function sp(p) {
    var q = px(p);
    return q[0].toFixed(1) + " " + q[1].toFixed(1);
  }
  function dist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  function norm2pi(a) {
    while (a < 0) a += Math.PI * 2;
    while (a >= Math.PI * 2) a -= Math.PI * 2;
    return a;
  }
  function circumcenter(a, b, c) {
    var d =
      2 *
      (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    var ux =
      ((a[0] * a[0] + a[1] * a[1]) * (b[1] - c[1]) +
        (b[0] * b[0] + b[1] * b[1]) * (c[1] - a[1]) +
        (c[0] * c[0] + c[1] * c[1]) * (a[1] - b[1])) /
      d;
    var uy =
      ((a[0] * a[0] + a[1] * a[1]) * (c[0] - b[0]) +
        (b[0] * b[0] + b[1] * b[1]) * (a[0] - c[0]) +
        (c[0] * c[0] + c[1] * c[1]) * (b[0] - a[0])) /
      d;
    return [ux, uy];
  }
  function arcThrough(a, b, c) {
    var o = circumcenter(a, b, c);
    var r = dist(o, a);
    var a0 = Math.atan2(a[1] - o[1], a[0] - o[0]);
    var a1 = Math.atan2(b[1] - o[1], b[0] - o[0]);
    var ac = Math.atan2(c[1] - o[1], c[0] - o[0]);
    var ccwDelta = norm2pi(a1 - a0);
    var ccw = norm2pi(ac - a0) < ccwDelta;
    return { type: "arc", c: o, r: r, a0: a0, a1: a1, ccw: ccw };
  }

  function polyline(pts, closed) {
    var p = pts
      .map(function (q) {
        return sp(q);
      })
      .join(" ");
    return closed
      ? '<polygon points="' + p + '" class="c-result"/>'
      : '<polyline points="' + p + '" class="c-result"/>';
  }

  function curveEl(c, cls) {
    if (c.type === "circle") {
      var p = px(c.c);
      return (
        '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) +
        '" r="' + (c.r * VB.s).toFixed(1) + '" class="' + cls + '"/>'
      );
    }
    if (c.type === "line") {
      var a = px(c.a),
        b = px(c.b);
      return (
        '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' +
        b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '" class="' + cls + '"/>'
      );
    }
    if (c.type === "arc") {
      var steps = 48,
        d = "";
      for (var k = 0; k <= steps; k++) {
        var t = k / steps;
        var ang = c.ccw
          ? c.a0 + norm2pi(c.a1 - c.a0) * t
          : c.a0 - norm2pi(c.a0 - c.a1) * t;
        var q = [c.c[0] + c.r * Math.cos(ang), c.c[1] + c.r * Math.sin(ang)];
        d += (k === 0 ? "M " : " L ") + sp(q);
      }
      return '<path d="' + d + '" class="' + cls + '" fill="none"/>';
    }
    if (c.type === "poly") {
      return polyline(c.pts, true).replace('class="c-result"', 'class="' + cls + '"');
    }
    return "";
  }

  /* ------------------------------------------------------------------ */
  /* tools                                                               */
  /* ------------------------------------------------------------------ */

  var CIRCLE3 = { c: [0, -0.6], r: 36.6 };
  var ARC3 = arcThrough([-38, -16], [38, -16], [0, 30]);
  var ARC_T = { type: "arc", c: [10, 10.36], r: 30.36, a0: -Math.PI / 2, a1: 0.1536, ccw: true };

  var TOOLS = {
    rect2: {
      label: "rect 2-pt",
      caption: "Click one corner, then the opposite corner.",
      steps: [
        { p: [-42, -26], n: 1 },
        { p: [42, 26], n: 2 }
      ],
      result: [{ type: "poly", pts: [[-42, -26], [42, -26], [42, 26], [-42, 26]] }]
    },
    rectC: {
      label: "rect centre",
      caption: "Click the centre, then a corner. The rectangle stays centred.",
      steps: [
        { p: [0, 0], n: 1 },
        { p: [42, 26], n: 2 }
      ],
      construction: [{ type: "line", a: [-6, 0], b: [6, 0] }, { type: "line", a: [0, -6], b: [0, 6] }],
      result: [{ type: "poly", pts: [[-42, -26], [42, -26], [42, 26], [-42, 26]] }]
    },
    rect3: {
      label: "rect 3-pt",
      caption: "Click a corner, the end of the first edge, then the width.",
      steps: [
        { p: [-40, -22], n: 1 },
        { p: [30, 10], n: 2 },
        { p: [-56.6, 14.4], n: 3 }
      ],
      result: [
        {
          type: "poly",
          pts: [
            [-40, -22],
            [30, 10],
            [13.4, 46.4],
            [-56.6, 14.4]
          ]
        }
      ]
    },
    circleC: {
      label: "circle centre",
      caption: "Click the centre, then a point on the circle.",
      steps: [
        { p: [0, 0], n: 1 },
        { p: [38, 0], n: 2 }
      ],
      construction: [
        { type: "line", a: [0, 0], b: [38, 0] },
        { type: "line", a: [-6, 0], b: [6, 0] },
        { type: "line", a: [0, -6], b: [0, 6] }
      ],
      result: [{ type: "circle", c: [0, 0], r: 38 }]
    },
    circle2: {
      label: "circle 2-pt",
      caption: "Click two points across the diameter.",
      steps: [
        { p: [-38, 0], n: 1 },
        { p: [38, 0], n: 2 }
      ],
      construction: [{ type: "line", a: [-38, 0], b: [38, 0] }],
      result: [{ type: "circle", c: [0, 0], r: 38 }]
    },
    circle3: {
      label: "circle 3-pt",
      caption: "Click three points on the circumference.",
      steps: [
        { p: [-34, -14], n: 1 },
        { p: [34, -14], n: 2 },
        { p: [0, 36], n: 3 }
      ],
      result: [{ type: "circle", c: CIRCLE3.c, r: CIRCLE3.r }]
    },
    arc3: {
      label: "arc 3-pt",
      caption: "Click the start, the end, then a point on the arc.",
      steps: [
        { p: [-38, -16], n: 1 },
        { p: [38, -16], n: 2 },
        { p: [0, 30], n: 3 }
      ],
      result: [ARC3]
    },
    arcC: {
      label: "arc centre",
      caption: "Click the centre, the start, then the end.",
      steps: [
        { p: [0, 0], n: 1 },
        { p: [35.7, 13.0], n: 2 },
        { p: [-35.7, 13.0], n: 3 }
      ],
      construction: [
        { type: "line", a: [0, 0], b: [35.7, 13.0] },
        { type: "line", a: [0, 0], b: [-35.7, 13.0] }
      ],
      result: [{ type: "arc", c: [0, 0], r: 38, a0: 0.349, a1: 2.793, ccw: true }]
    },
    arcT: {
      label: "arc tangent",
      caption: "Click a start on an existing curve (starts tangent), then the end.",
      context: [{ type: "line", a: [-46, -20], b: [10, -20] }],
      steps: [
        { p: [10, -20], n: 1 },
        { p: [40, 15], n: 2 }
      ],
      construction: [{ type: "line", a: [10, -20], b: [40, -20] }],
      result: [ARC_T]
    },
    polygon: {
      label: "polygon",
      caption: "Click the centre, then a vertex (or edge midpoint). Set N below.",
      live: true,
      steps: [
        { p: [0, 0], n: 1 },
        { p: [0, 40], n: 2 }
      ],
      construction: [{ type: "circle", c: [0, 0], r: 40 }]
    }
  };

  var poly = { sides: 6, mode: "inscribed", radius: 40 };

  function polygonResult() {
    var N = Math.max(3, Math.round(poly.sides));
    var R = poly.radius;
    var circ =
      poly.mode === "inscribed" ? R : R / Math.cos(Math.PI / N);
    var startAng = Math.PI / 2;
    if (poly.mode === "circumscribed") startAng += Math.PI / N;
    var pts = [];
    for (var k = 0; k < N; k++) {
      var a = startAng + (k * Math.PI * 2) / N;
      pts.push([circ * Math.cos(a), circ * Math.sin(a)]);
    }
    return [{ type: "poly", pts: pts }];
  }

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */

  var svg, captionEl, panelEl, layerContext, layerConstruction, layerResult, layerMarkers;
  var active = "rect2";

  function render() {
    var tool = TOOLS[active];
    var html = "";
    (tool.context || []).forEach(function (c) {
      html += curveEl(c, "c-context");
    });
    layerContext.innerHTML = html;

    html = "";
    (tool.construction || []).forEach(function (c) {
      html += curveEl(c, "c-construct");
    });
    layerConstruction.innerHTML = html;

    var result = tool.live ? polygonResult() : tool.result || [];
    html = "";
    result.forEach(function (c) {
      html += curveEl(c, "c-result");
    });
    layerResult.innerHTML = html;

    html = "";
    tool.steps.forEach(function (s) {
      var P = px(s.p);
      html +=
        '<circle class="c-step" cx="' + P[0].toFixed(1) + '" cy="' +
        P[1].toFixed(1) + '" r="9"/>' +
        '<text class="c-step-n" x="' + P[0].toFixed(1) + '" y="' +
        (P[1] + 3.2).toFixed(1) + '">' + s.n + "</text>";
    });
    layerMarkers.innerHTML = html;

    captionEl.textContent = tool.caption;
    renderOptions();
  }

  function renderOptions() {
    var tool = TOOLS[active];
    if (!tool.live) {
      panelEl.hidden = true;
      panelEl.innerHTML = "";
      return;
    }
    panelEl.hidden = false;
    panelEl.innerHTML =
      '<div class="tool-panel-head"><div>' +
      '<div class="tool-panel-kicker">sketch tool</div>' +
      '<h2 class="tool-panel-title">polygon</h2></div></div>' +
      '<div class="tool-panel-body">' +
      '<div class="tool-row"><span class="tool-label">sides</span>' +
      '<div class="stepper" data-poly="sides">' +
      '<button type="button" data-step="-1">\u2212</button>' +
      '<span class="stepper-value">' + poly.sides + "</span>" +
      '<button type="button" data-step="1">+</button></div></div>' +
      '<div class="tool-row"><span class="tool-label">mode</span>' +
      '<div class="seg" data-poly="mode">' +
      '<button type="button" data-value="inscribed" class="' +
      (poly.mode === "inscribed" ? "is-selected" : "") +
      '">inscribed</button>' +
      '<button type="button" data-value="circumscribed" class="' +
      (poly.mode === "circumscribed" ? "is-selected" : "") +
      '">circumscribed</button></div></div>' +
      "</div>" +
      '<div class="tool-hint">place the centre, then a vertex</div>' +
      ShowcaseUI.footer(poly.sides + " sides \u00b7 " + poly.mode, [
        { id: "apply", label: "apply" },
        { id: "cancel", label: "cancel", quiet: true }
      ]);
    if (!panelEl.dataset.dragged) {
      panelEl.style.left = "auto";
      panelEl.style.top = "24px";
      panelEl.style.right = "24px";
    }
  }

  function setActive(id) {
    if (!TOOLS[id]) return;
    active = id;
    Array.prototype.forEach.call(document.querySelectorAll("[data-create]"), function (b) {
      var on = b.getAttribute("data-create") === id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    render();
  }

  function boot() {
    svg = document.getElementById("svg");
    captionEl = document.getElementById("create-caption");
    panelEl = document.getElementById("create-panel");
    layerContext = document.getElementById("layer-context");
    layerConstruction = document.getElementById("layer-construction");
    layerResult = document.getElementById("layer-result");
    layerMarkers = document.getElementById("layer-markers");

    ShowcaseUI.makeDraggable(panelEl, document.getElementById("viewport"));

    Array.prototype.forEach.call(document.querySelectorAll("[data-create]"), function (b) {
      b.addEventListener("click", function () {
        setActive(b.getAttribute("data-create"));
      });
    });

    panelEl.addEventListener("click", function (e) {
      var act = e.target.closest("[data-action]");
      if (act) {
        if (act.getAttribute("data-action") === "cancel") {
          poly.sides = 6;
          poly.mode = "inscribed";
          render();
        }
        return;
      }
      var step = e.target.closest(".stepper button");
      if (step) {
        poly.sides = Math.max(3, Math.min(12, poly.sides + Number(step.getAttribute("data-step"))));
        render();
        return;
      }
      var seg = e.target.closest(".seg button");
      if (seg) {
        poly.mode = seg.getAttribute("data-value");
        render();
      }
    });

    setActive("rect2");
    if (window.M && window.M.hydrateIcons) window.M.hydrateIcons(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
