/*
 * Model-tool showcase: Combine / Split Body (body ops) and Section Analysis.
 * Isometric, stylised geometry — a design target, not a real B-rep.
 * Not imported by src/.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* isometric helpers                                                   */
  /* ------------------------------------------------------------------ */

  var K = 0.8660254;

  function makeIso(cx, cy, s) {
    return {
      s: s,
      p: function (x, y, z) {
        return [cx + (x - y) * K * s, cy + (x + y) * 0.5 * s - z * s];
      }
    };
  }

  function pts3(iso, arr) {
    return arr.map(function (q) {
      return iso.p(q[0], q[1], q[2]);
    });
  }

  function poly(pts, cls) {
    return (
      '<polygon points="' +
      pts
        .map(function (q) {
          return q[0].toFixed(1) + "," + q[1].toFixed(1);
        })
        .join(" ") +
      '" class="' + cls + '"/>'
    );
  }

  function clipX(ring, x, keepLess) {
    var out = [];
    var n = ring.length;
    for (var i = 0; i < n; i++) {
      var a = ring[i],
        b = ring[(i + 1) % n];
      var ain = keepLess ? a[0] <= x : a[0] >= x;
      var bin = keepLess ? b[0] <= x : b[0] >= x;
      if (ain) out.push(a);
      if (ain !== bin) {
        var t = (x - a[0]) / (b[0] - a[0] || 1);
        out.push([x, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return out;
  }

  function boxFaces(b) {
    return {
      top: [
        [b.x0, b.y0, b.z1],
        [b.x1, b.y0, b.z1],
        [b.x1, b.y1, b.z1],
        [b.x0, b.y1, b.z1]
      ],
      xmax: [
        [b.x1, b.y0, b.z0],
        [b.x1, b.y1, b.z0],
        [b.x1, b.y1, b.z1],
        [b.x1, b.y0, b.z1]
      ],
      ymax: [
        [b.x0, b.y1, b.z0],
        [b.x1, b.y1, b.z0],
        [b.x1, b.y1, b.z1],
        [b.x0, b.y1, b.z1]
      ]
    };
  }

  function drawBox(iso, b, clip, ghost) {
    var f = boxFaces(b);
    var html = "";
    function emit(ring, cls) {
      var r = clip ? clipX(ring, clip.value, clip.keepLess) : ring;
      if (r.length >= 3) html += poly(pts3(iso, r), ghost ? "bo-ghost" : cls);
    }
    emit(f.ymax, "bo-face-y");
    emit(f.xmax, "bo-face-x");
    emit(f.top, "bo-face-top");
    return html;
  }

  function ellipsePath(iso, x, y, z, r) {
    var pts = [];
    var n = 48;
    for (var k = 0; k <= n; k++) {
      var a = (k / n) * Math.PI * 2;
      pts.push(iso.p(x + r * Math.cos(a), y + r * Math.sin(a), z));
    }
    return (
      "M " +
      pts
        .map(function (q) {
          return q[0].toFixed(1) + " " + q[1].toFixed(1);
        })
        .join(" L ") +
      " Z"
    );
  }

  function cylinderSolid(iso, x, y, r, z0, z1, sideCls, topCls) {
    var top = iso.p(x, y, z1),
      bot = iso.p(x, y, z0);
    var rx = 1.2247 * r * iso.s;
    var d =
      "M " + (top[0] - rx).toFixed(1) + " " + top[1].toFixed(1) +
      " L " + (bot[0] - rx).toFixed(1) + " " + bot[1].toFixed(1);
    var a0 = Math.PI * 0.75,
      a1 = -Math.PI * 0.25,
      n = 24;
    for (var k = 0; k <= n; k++) {
      var a = a0 + ((a1 - a0) * k) / n;
      var q = iso.p(x + r * Math.cos(a), y + r * Math.sin(a), z0);
      d += " L " + q[0].toFixed(1) + " " + q[1].toFixed(1);
    }
    d += " L " + (top[0] + rx).toFixed(1) + " " + top[1].toFixed(1) + " Z";
    return (
      '<path d="' + d + '" class="' + sideCls + '"/>' +
      '<path d="' + ellipsePath(iso, x, y, z1, r) + '" class="' + topCls + '"/>'
    );
  }

  function planeQuad(iso, b, axis, pos) {
    var q;
    if (axis === "x")
      q = [
        [pos, b.y0, b.z0],
        [pos, b.y1, b.z0],
        [pos, b.y1, b.z1],
        [pos, b.y0, b.z1]
      ];
    else if (axis === "y")
      q = [
        [b.x0, pos, b.z0],
        [b.x1, pos, b.z0],
        [b.x1, pos, b.z1],
        [b.x0, pos, b.z1]
      ];
    else
      q = [
        [b.x0, b.y0, pos],
        [b.x1, b.y0, pos],
        [b.x1, b.y1, pos],
        [b.x0, b.y1, pos]
      ];
    return poly(pts3(iso, q), "bo-plane");
  }

  /* ------------------------------------------------------------------ */
  /* shared panel                                                        */
  /* ------------------------------------------------------------------ */

  function panelHtml(spec, p) {
    var html =
      '<div class="tool-panel-head"><div>' +
      '<div class="tool-panel-kicker">' + spec.kicker + "</div>" +
      '<h2 class="tool-panel-title">' + spec.title + "</h2></div></div>" +
      '<div class="tool-panel-body">';
    spec.rows.forEach(function (row) {
      var v = p[row.key];
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
      } else if (row.type === "toggle") {
        ctrl =
          '<button type="button" class="toggle" data-key="' + row.key +
          '" aria-pressed="' + (v ? "true" : "false") + '">' +
          (v ? "on" : "off") + "</button>";
      } else if (row.type === "range") {
        ctrl =
          '<input class="tool-range" type="range" data-input="' + row.key +
          '" min="' + row.min + '" max="' + row.max + '" step="1" value="' +
          v + '">';
      } else if (row.type === "static") {
        ctrl = '<span class="tool-note">' + row.value + "</span>";
      }
      html +=
        '<div class="tool-row"><span class="tool-label">' + row.label +
        "</span>" + ctrl + "</div>";
    });
    html += "</div>";
    if (spec.hint) html += '<div class="tool-hint">' + spec.hint + "</div>";
    html +=
      '<div class="tool-panel-foot"><span class="tool-summary">' +
      spec.summary(p) + "</span></div>";
    return html;
  }

  function wirePanel(panel, onSeg, onToggle, onInput) {
    panel.addEventListener("click", function (e) {
      var seg = e.target.closest(".seg button");
      if (seg) {
        onSeg(seg.closest(".seg").getAttribute("data-key"), seg.getAttribute("data-value"));
        return;
      }
      var tog = e.target.closest(".toggle");
      if (tog) onToggle(tog.getAttribute("data-key"));
    });
    panel.addEventListener("input", function (e) {
      var inp = e.target.closest("[data-input]");
      if (inp) onInput(inp.getAttribute("data-input"), Number(inp.value));
    });
  }

  function layoutPanel(panel, viewport) {
    panel.style.left = "auto";
    panel.style.top = "24px";
    panel.style.right = "24px";
  }

  /* ------------------------------------------------------------------ */
  /* body ops: combine + split body                                      */
  /* ------------------------------------------------------------------ */

  var PLATE = { x0: 0, y0: 0, z0: 0, x1: 110, y1: 74, z1: 18 };
  var CYL = { x: 80, y: 37, r: 15, z0: -10, z1: 54 };
  var ENV = { x0: 0, y0: 0, z0: -10, x1: 110, y1: 74, z1: 54 };

  var bo = {
    tool: "combine",
    params: {
      combine: { op: "cut", keepTools: false },
      split: { axis: "x", pos: 55, keepBoth: true }
    }
  };

  function axisMax(axis) {
    return axis === "x" ? 110 : axis === "y" ? 74 : 18;
  }

  function boSpec(tool) {
    if (tool === "combine") {
      return {
        kicker: "body op",
        title: "combine",
        rows: [
          { type: "seg", key: "op", label: "operation", options: [["join", "join"], ["cut", "cut"], ["intersect", "intersect"]] },
          { type: "static", label: "target", value: "plate" },
          { type: "static", label: "tool", value: "cylinder" },
          { type: "toggle", key: "keepTools", label: "keep tool bodies" }
        ],
        hint: "the tool body is consumed unless it is kept",
        summary: function (p) {
          return p.op + " \u00b7 " + (p.keepTools ? "keep tools" : "consume tool");
        }
      };
    }
    return {
      kicker: "body op",
      title: "split body",
      rows: [
        { type: "seg", key: "axis", label: "splitting tool", options: [["x", "X"], ["y", "Y"], ["z", "Z"]] },
        { type: "range", key: "pos", label: "position", min: 0, max: axisMax(bo.params.split.axis) },
        { type: "toggle", key: "keepBoth", label: "keep both" },
        { type: "static", label: "target", value: "plate" }
      ],
      hint: "a split keeps two independent bodies",
      summary: function (p) {
        return (
          p.axis.toUpperCase() + " plane \u00b7 " + Math.round(p.pos) + " mm \u00b7 " +
          (p.keepBoth ? "keep both" : "keep one")
        );
      }
    };
  }

  function splitBox(axis, pos, first) {
    var c = { x0: PLATE.x0, y0: PLATE.y0, z0: PLATE.z0, x1: PLATE.x1, y1: PLATE.y1, z1: PLATE.z1 };
    if (axis === "x") {
      if (first) c.x1 = pos;
      else c.x0 = pos;
    } else if (axis === "y") {
      if (first) c.y1 = pos;
      else c.y0 = pos;
    } else {
      if (first) c.z1 = pos;
      else c.z0 = pos;
    }
    return c;
  }

  function boRender(iso, layer, footEl) {
    var tool = bo.tool;
    var p = bo.params[tool];
    var html = "";
    if (tool === "combine") {
      var op = p.op;
      if (op === "join") {
        html += drawBox(iso, PLATE, null, false);
        html += cylinderSolid(iso, CYL.x, CYL.y, CYL.r, PLATE.z1, CYL.z1, "bo-face-x", "bo-face-top");
      } else if (op === "cut") {
        html += drawBox(iso, PLATE, null, false);
        html +=
          '<path d="' + ellipsePath(iso, CYL.x, CYL.y, PLATE.z1, CYL.r) +
          '" class="bo-hole"/>';
        html += cylinderSolid(
          iso, CYL.x, CYL.y, CYL.r, CYL.z0, CYL.z1,
          p.keepTools ? "bo-tool-kept" : "bo-ghost",
          p.keepTools ? "bo-tool-kept" : "bo-ghost"
        );
      } else {
        html += drawBox(iso, PLATE, null, true);
        html += cylinderSolid(iso, CYL.x, CYL.y, CYL.r, PLATE.z0, PLATE.z1, "bo-face-x", "bo-face-top");
        if (p.keepTools) {
          html += cylinderSolid(iso, CYL.x, CYL.y, CYL.r, PLATE.z1, CYL.z1, "bo-tool-kept", "bo-tool-kept");
        }
      }
    } else {
      var a = splitBox(p.axis, p.pos, true);
      var b = splitBox(p.axis, p.pos, false);
      html += drawBox(iso, a, null, false);
      html += p.keepBoth ? drawBox(iso, b, null, false) : drawBox(iso, b, null, true);
      html += planeQuad(iso, ENV, p.axis, p.pos);
    }
    layer.innerHTML = html;
    footEl.innerHTML =
      "<b>" + (tool === "combine" ? "combine" : "split body") + "</b> \u00b7 " +
      boSpec(tool).summary(p);
  }

  /* ------------------------------------------------------------------ */
  /* section analysis                                                    */
  /* ------------------------------------------------------------------ */

  var STEP = [
    { x0: 0, y0: 0, z0: 0, x1: 38, y1: 70, z1: 32 },
    { x0: 38, y0: 0, z0: 0, x1: 76, y1: 70, z1: 16 },
    { x0: 76, y0: 0, z0: 0, x1: 104, y1: 70, z1: 46 }
  ];
  var SEC_ENV = { x0: 0, y0: 0, z0: 0, x1: 104, y1: 70, z1: 46 };

  var sec = { pos: 56, flip: false };

  function secRender(iso, layer, metaEl) {
    var keepLess = !sec.flip;
    var clip = { value: sec.pos, keepLess: keepLess };
    var html = "";
    // the cutting plane behind the body
    html += planeQuad(iso, SEC_ENV, "x", sec.pos);
    STEP.forEach(function (b) {
      html += drawBox(iso, b, clip, false);
    });
    // the cut cross-section
    STEP.forEach(function (b) {
      if (b.x0 <= sec.pos && sec.pos <= b.x1) {
        html += poly(
          pts3(iso, [
            [sec.pos, b.y0, b.z0],
            [sec.pos, b.y1, b.z0],
            [sec.pos, b.y1, b.z1],
            [sec.pos, b.y0, b.z1]
          ]),
          "sec-cut"
        );
      }
    });
    layer.innerHTML = html;
    metaEl.textContent =
      "plane X \u00b7 " + Math.round(sec.pos) + " mm \u00b7 " +
      (sec.flip ? "keep +x" : "keep \u2212x");
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */

  function bootBodyOps() {
    var layer = document.getElementById("bo-layer");
    var panel = document.getElementById("tool-panel");
    var foot = document.getElementById("bo-foot");
    var iso = makeIso(540, 400, 2.6);

    function render() {
      boRender(iso, layer, foot);
      panel.innerHTML = panelHtml(boSpec(bo.tool), bo.params[bo.tool]);
      layoutPanel(panel);
    }

    function setTool(tool) {
      bo.tool = tool;
      Array.prototype.forEach.call(document.querySelectorAll("[data-tool]"), function (b) {
        var on = b.getAttribute("data-tool") === tool;
        b.classList.toggle("is-active", on);
      });
      render();
    }

    Array.prototype.forEach.call(document.querySelectorAll("[data-tool]"), function (b) {
      b.addEventListener("click", function () {
        setTool(b.getAttribute("data-tool"));
      });
    });

    panel.addEventListener("click", function (e) {
      var seg = e.target.closest(".seg button");
      if (seg) {
        var key = seg.closest(".seg").getAttribute("data-key");
        var val = seg.getAttribute("data-value");
        bo.params[bo.tool][key] = val;
        if (bo.tool === "split" && key === "axis") {
          bo.params.split.pos = Math.round(axisMax(val) / 2);
        }
        render();
        return;
      }
      var tog = e.target.closest(".toggle");
      if (tog) {
        var k = tog.getAttribute("data-key");
        bo.params[bo.tool][k] = !bo.params[bo.tool][k];
        render();
      }
    });
    panel.addEventListener("input", function (e) {
      var inp = e.target.closest("[data-input]");
      if (inp) {
        bo.params[bo.tool][inp.getAttribute("data-input")] = Number(inp.value);
        boRender(iso, layer, foot);
      }
    });

    setTool("combine");
  }

  function bootSection() {
    var layer = document.getElementById("sec-layer");
    var panel = document.getElementById("tool-panel");
    var meta = document.getElementById("sec-meta");
    var iso = makeIso(540, 400, 2.6);
    var spec = {
      kicker: "inspect",
      title: "section analysis",
      rows: [
        { type: "range", key: "pos", label: "plane X", min: 0, max: 104 },
        { type: "toggle", key: "flip", label: "flip side" }
      ],
      hint: "a view-only cut through the body",
      summary: function () {
        return "X \u00b7 " + Math.round(sec.pos) + " mm";
      }
    };

    function render() {
      secRender(iso, layer, meta);
      panel.innerHTML = panelHtml(spec, sec);
      layoutPanel(panel);
    }

    panel.addEventListener("click", function (e) {
      var tog = e.target.closest(".toggle");
      if (tog && tog.getAttribute("data-key") === "flip") {
        sec.flip = !sec.flip;
        render();
      }
    });
    panel.addEventListener("input", function (e) {
      var inp = e.target.closest("[data-input]");
      if (inp) {
        sec[inp.getAttribute("data-input")] = Number(inp.value);
        secRender(iso, layer, meta);
      }
    });

    render();
  }

  function boot() {
    if (document.getElementById("bo-layer")) bootBodyOps();
    if (document.getElementById("sec-layer")) bootSection();
    if (window.M && window.M.hydrateIcons) window.M.hydrateIcons(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
