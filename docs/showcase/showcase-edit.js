/*
 * Sketch selection inputs: the selection popover (constraints) and the inline
 * dimension editor. Design target only — not imported by src/.
 * See INTERACTION.md: selection opens a popover; a single value stays inline.
 */
(function () {
  "use strict";

  var VB = { w: 1200, h: 700, ox: 520, oy: 430, s: 3.6 };

  function px(p) {
    return [VB.ox + p[0] * VB.s, VB.oy - p[1] * VB.s];
  }
  function sp(p) {
    var q = px(p);
    return q[0].toFixed(1) + " " + q[1].toFixed(1);
  }
  function line(a, b, cls) {
    return (
      '<line x1="' + px(a)[0].toFixed(1) + '" y1="' + px(a)[1].toFixed(1) +
      '" x2="' + px(b)[0].toFixed(1) + '" y2="' + px(b)[1].toFixed(1) +
      '" class="' + cls + '"/>'
    );
  }
  function dot(p, cls) {
    return (
      '<circle cx="' + px(p)[0].toFixed(1) + '" cy="' + px(p)[1].toFixed(1) +
      '" r="3.4" class="' + cls + '"/>'
    );
  }

  var L1 = { a: [12, 14], b: [82, 14] };
  var L2 = { a: [82, 14], b: [82, 58] };
  var C1 = { c: [38, 42], r: 17 };
  var P1 = [16, 52];
  var DIM = { a: [12, 14], b: [82, 14], y: -10, text: "70.0" };

  var CHIPS = {
    lines: ["horizontal", "vertical", "parallel", "perpendicular", "equal", "collinear", "coincident", "fix", "construction"],
    circle: ["radius", "diameter", "equal", "concentric", "tangent", "coincident", "fix"],
    point: ["coincident", "midpoint", "fix", "construction"]
  };

  var state = {
    sel: "lines",
    chips: {},
    point: { x: 16, y: 52 },
    dimKind: "driving"
  };

  var layerGeom, layerDim, layerWash, panel, inline, viewport;

  function renderGeom() {
    var html = "";
    html += line(L1.a, L1.b, "sketch-line");
    html += line(L2.a, L2.b, "sketch-line");
    var p = px(C1.c);
    html +=
      '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' +
      (C1.r * VB.s).toFixed(1) + '" class="sketch-line"/>';
    html += dot(P1, "sketch-point");
    html += dot(L1.a, "sketch-point") + dot(L1.b, "sketch-point") +
      dot(L2.b, "sketch-point");
    layerGeom.innerHTML = html;
  }

  function renderDim() {
    var y = DIM.y;
    var a = [DIM.a[0], y];
    var b = [DIM.b[0], y];
    var html = "";
    html += line(DIM.a, [DIM.a[0], y - 3], "dim-ext");
    html += line(DIM.b, [DIM.b[0], y - 3], "dim-ext");
    html += line(a, b, "dim-line");
    if (state.sel !== "dimension") {
      var mid = px([(a[0] + b[0]) / 2, y]);
      html +=
        '<text class="dim-text" x="' + mid[0].toFixed(1) + '" y="' +
        (mid[1] - 8).toFixed(1) + '" text-anchor="middle">' + DIM.text + "</text>";
    }
    layerDim.innerHTML = html;
  }

  function renderWash() {
    var html = "";
    if (state.sel === "lines") {
      html += line(L1.a, L1.b, "sc-wash");
      html += line(L2.a, L2.b, "sc-wash");
      html += line(L1.a, L1.b, "sketch-line");
      html += line(L2.a, L2.b, "sketch-line");
    } else if (state.sel === "circle") {
      var p = px(C1.c);
      html +=
        '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' +
        (C1.r * VB.s).toFixed(1) + '" class="sc-wash"/>';
      html +=
        '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' +
        (C1.r * VB.s).toFixed(1) + '" class="sketch-line"/>';
    } else if (state.sel === "point") {
      html += dot(P1, "sc-point-wash");
    }
    layerWash.innerHTML = html;
  }

  function chipRow(list) {
    return (
      '<div class="sc-chip-row">' +
      list
        .map(function (c) {
          return (
            '<button type="button" class="sc-chip' +
            (state.chips[state.sel + ":" + c] ? " is-on" : "") +
            '" data-chip="' + c + '">' + c + "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function row(label, ctrl) {
    return '<div class="tool-row"><span class="tool-label">' + label + "</span>" + ctrl + "</div>";
  }

  function renderPanel() {
    if (state.sel === "dimension") {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    var title =
      state.sel === "lines" ? "2 lines" : state.sel === "circle" ? "circle" : "point";
    var body = "";
    if (state.sel === "lines") {
      body =
        '<div class="tool-row"><span class="tool-label">line 1</span><span class="tool-note">70.0 mm</span></div>' +
        '<div class="tool-row"><span class="tool-label">line 2</span><span class="tool-note">44.0 mm</span></div>' +
        chipRow(CHIPS.lines);
    } else if (state.sel === "circle") {
      body =
        '<div class="tool-row"><span class="tool-label">circle</span><span class="tool-note">\u00d834.0 mm</span></div>' +
        chipRow(CHIPS.circle);
    } else {
      body =
        row("x", '<label class="tool-input"><input type="text" data-xy="x" value="' + state.point.x + '"><span class="unit">mm</span></label>') +
        row("y", '<label class="tool-input"><input type="text" data-xy="y" value="' + state.point.y + '"><span class="unit">mm</span></label>') +
        chipRow(CHIPS.point);
    }
    var summary =
      state.sel === "lines" ? "2 lines \u00b7 4 DOF" : state.sel === "circle" ? "1 circle \u00b7 2 DOF" : "1 point";
    panel.innerHTML =
      '<div class="tool-panel-head"><div>' +
      '<div class="tool-panel-kicker">selection</div>' +
      '<h2 class="tool-panel-title">' + title + "</h2></div></div>" +
      '<div class="tool-panel-body">' + body + "</div>" +
      '<div class="tool-hint">constraints apply immediately</div>' +
      ShowcaseUI.footer(summary, [
        { id: "delete", label: "delete", quiet: true }
      ]);
    if (!panel.dataset.dragged) {
      panel.style.left = "auto";
      panel.style.top = "24px";
      panel.style.right = "24px";
    }
  }

  function viewToCss(x, y) {
    var sr = document.getElementById("svg").getBoundingClientRect();
    var vr = viewport.getBoundingClientRect();
    var s = Math.min(sr.width / VB.w, sr.height / VB.h);
    var offX = (sr.width - VB.w * s) / 2 + (sr.left - vr.left);
    var offY = (sr.height - VB.h * s) / 2 + (sr.top - vr.top);
    return [offX + x * s, offY + y * s];
  }

  function renderInline() {
    if (state.sel !== "dimension") {
      inline.hidden = true;
      return;
    }
    var mid = px([(DIM.a[0] + DIM.b[0]) / 2, DIM.y]);
    var q = viewToCss(mid[0], mid[1]);
    inline.hidden = false;
    inline.style.width = "148px";
    inline.style.left = q[0] - 74 + "px";
    inline.style.top = q[1] - 34 + "px";
    inline.innerHTML = ShowcaseUI.inlineEditor({
      value: DIM.text,
      unit: "mm",
      kind: state.dimKind
    });
  }

  function render() {
    renderGeom();
    renderDim();
    renderWash();
    renderPanel();
    renderInline();
    Array.prototype.forEach.call(document.querySelectorAll("[data-sel]"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-sel") === state.sel);
    });
    var foot = document.getElementById("edit-foot");
    foot.innerHTML =
      "<b>" +
      (state.sel === "lines" ? "2 lines" : state.sel === "circle" ? "circle" : state.sel === "point" ? "point" : "dimension") +
      "</b> \u00b7 " +
      (state.sel === "dimension"
        ? "edited at the dimension"
        : "selection popover, draggable");
  }

  function boot() {
    viewport = document.getElementById("viewport");
    layerGeom = document.getElementById("edit-geom");
    layerDim = document.getElementById("edit-dim");
    layerWash = document.getElementById("edit-wash");
    panel = document.getElementById("edit-panel");
    inline = document.getElementById("edit-inline");
    ShowcaseUI.makeDraggable(panel, viewport);

    Array.prototype.forEach.call(document.querySelectorAll("[data-sel]"), function (b) {
      b.addEventListener("click", function () {
        state.sel = b.getAttribute("data-sel");
        render();
      });
    });
    panel.addEventListener("click", function (e) {
      var chip = e.target.closest("[data-chip]");
      if (chip) {
        var key = state.sel + ":" + chip.getAttribute("data-chip");
        state.chips[key] = !state.chips[key];
        render();
      }
    });
    panel.addEventListener("input", function (e) {
      var inp = e.target.closest("[data-xy]");
      if (inp) {
        state.point[inp.getAttribute("data-xy")] = Number(inp.value) || 0;
        P1[0] = state.point.x;
        P1[1] = state.point.y;
        renderGeom();
        renderWash();
      }
    });
    inline.addEventListener("click", function (e) {
      if (e.target.closest(".dim-kind")) {
        state.dimKind = state.dimKind === "driving" ? "reference" : "driving";
        renderInline();
      }
    });

    render();
    if (window.M && window.M.hydrateIcons) window.M.hydrateIcons(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
