/*
 * Dimension kind: the inline editor's driving / reference control.
 *
 * The value is an editable field only while the dimension drives geometry; a
 * reference dimension's value is an observation, so it renders as a readout.
 * The kind is a segmented control in both the editor and the placement flyout.
 * Design target only — not imported by src/. See dimension.html, INTERACTION.md.
 */
(function () {
  "use strict";

  var VB = { w: 1200, h: 700, ox: 520, oy: 430, s: 3.6 };
  var R = { x0: 12, y0: 14, x1: 82, y1: 58 };
  var CIRCLE = { c: [38, 42], r: 17 };

  function px(p) {
    return [VB.ox + p[0] * VB.s, VB.oy - p[1] * VB.s];
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

  // The dimensions on the sketch. `y` is the label offset in sketch mm.
  var dims = [
    { id: "d-width", a: [R.x0, R.y0], b: [R.x1, R.y0], y: -10, kind: "driving", value: "70.0" }
  ];

  var state = {
    tool: "select",
    draftKind: "driving",
    editingId: "d-width",
    editor: null,
    status: "the editor is open on the width dimension"
  };

  var layerGeom, layerLines, editorEl, flyout, foot, viewport;

  function dimById(id) {
    for (var i = 0; i < dims.length; i++) if (dims[i].id === id) return dims[i];
    return null;
  }

  /* geometry ------------------------------------------------------------- */

  function renderGeom() {
    var html = "";
    html += line([R.x0, R.y0], [R.x1, R.y0], "sketch-line");
    html += line([R.x1, R.y0], [R.x1, R.y1], "sketch-line");
    html += line([R.x1, R.y1], [R.x0, R.y1], "sketch-line");
    html += line([R.x0, R.y1], [R.x0, R.y0], "sketch-line");
    var p = px(CIRCLE.c);
    html +=
      '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' +
      (CIRCLE.r * VB.s).toFixed(1) + '" class="sketch-line"/>';
    html += dot([R.x0, R.y0], "sketch-point");
    html += dot([R.x1, R.y0], "sketch-point");
    html += dot([R.x1, R.y1], "sketch-point");
    html += dot([R.x0, R.y1], "sketch-point");
    layerGeom.innerHTML = html;
  }

  function renderDims() {
    var html = "";
    dims.forEach(function (d) {
      var y = d.y;
      html += line(d.a, [d.a[0], y - 3], "dim-ext");
      html += line(d.b, [d.b[0], y - 3], "dim-ext");
      html += line([d.a[0], y], [d.b[0], y], "dim-line");
      if (state.editingId !== d.id) {
        var mid = px([(d.a[0] + d.b[0]) / 2, y]);
        var ref = d.kind === "reference";
        html +=
          '<text class="dim-text' + (ref ? " is-ref" : "") + '" x="' + mid[0].toFixed(1) +
          '" y="' + (mid[1] - 8).toFixed(1) + '" text-anchor="middle">' +
          (ref ? "(" + d.value + ")" : d.value) + "</text>";
      }
    });
    layerLines.innerHTML = html;
  }

  /* the inline editor ---------------------------------------------------- */

  function viewToCss(x, y) {
    var sr = document.getElementById("svg").getBoundingClientRect();
    var vr = viewport.getBoundingClientRect();
    var s = Math.min(sr.width / VB.w, sr.height / VB.h);
    var offX = (sr.width - VB.w * s) / 2 + (sr.left - vr.left);
    var offY = (sr.height - VB.h * s) / 2 + (sr.top - vr.top);
    return [offX + x * s, offY + y * s];
  }

  function openEditor(id) {
    var d = dimById(id);
    if (!d) return;
    state.editingId = id;
    state.editor = { kind: d.kind, value: d.value, base: { kind: d.kind, value: d.value } };
    render();
    var inp = editorEl.querySelector("input");
    if (inp) inp.focus();
  }

  function closeEditor() {
    state.editingId = null;
    state.editor = null;
    render();
  }

  function commitEditor() {
    var d = dimById(state.editingId);
    if (!d || !state.editor) return;
    var before = d.kind;
    d.kind = state.editor.kind;
    if (d.kind === "driving") d.value = state.editor.value;
    state.status =
      before === d.kind
        ? "committed"
        : d.kind === "reference"
          ? "released the width — it measures now"
          : "constrained the width at the measured value";
    closeEditor();
  }

  function revertEditor() {
    state.status = "reverted — nothing changed";
    closeEditor();
  }

  function renderEditor() {
    if (!state.editor) {
      editorEl.hidden = true;
      return;
    }
    var d = dimById(state.editingId);
    var mid = px([(d.a[0] + d.b[0]) / 2, d.y]);
    var q = viewToCss(mid[0], mid[1]);
    editorEl.hidden = false;
    editorEl.style.left = q[0] + "px";
    editorEl.style.transform = "translateX(-50%)";
    editorEl.style.top = q[1] - 34 + "px";
    editorEl.innerHTML = ShowcaseUI.inlineEditor({
      value: state.editor.value,
      unit: "mm",
      kind: state.editor.kind,
      deletable: true
    });
  }

  // Swap just the value control, so the editor (and the caret) is not rebuilt.
  function syncEditorKind() {
    if (!state.editor) return;
    var field = editorEl.querySelector(".dim-field");
    if (field) field.innerHTML = ShowcaseUI.dimField(state.editor.kind, state.editor.value, "mm");
    Array.prototype.forEach.call(editorEl.querySelectorAll("[data-kind-option]"), function (b) {
      b.classList.toggle("is-selected", b.getAttribute("data-kind-option") === state.editor.kind);
    });
    var inp = editorEl.querySelector("input");
    if (inp) inp.focus();
    renderFoot();
  }

  /* the placement flyout ------------------------------------------------ */

  function renderFlyout() {
    if (state.tool !== "dimension") {
      flyout.hidden = true;
      flyout.innerHTML = "";
      return;
    }
    flyout.hidden = false;
    var ref = state.draftKind === "reference";
    flyout.innerHTML =
      '<span class="tool-kicker">new dimension</span>' +
      '<span class="seg" role="group" aria-label="New dimension kind">' +
      '<button type="button" data-draft-kind="driving"' + (ref ? "" : ' class="is-selected"') + ">driving</button>" +
      '<button type="button" data-draft-kind="reference"' + (ref ? ' class="is-selected"' : "") + ">reference</button>" +
      "</span>" +
      '<span class="tool-note">' + (ref ? "measures only — no DOF spent" : "constrains the geometry") + "</span>";
  }

  /* the foot ------------------------------------------------------------- */

  function dof() {
    var d = dimById("d-width");
    var kind = state.editor ? state.editor.kind : (d ? d.kind : null);
    var n = 3; // height, circle centre, circle radius — say
    if (!d) n += 1;
    else if (kind === "reference") n += 1;
    return n;
  }

  function renderFoot() {
    foot.innerHTML =
      "<b>" + dof() + " DOF</b> \u00b7 " + state.status +
      ' \u00b7 <span class="mono">' + (state.editor ? state.editor.kind : "—") + "</span>";
  }

  /* render --------------------------------------------------------------- */

  function render() {
    renderGeom();
    renderDims();
    renderEditor();
    renderFlyout();
    renderFoot();
    Array.prototype.forEach.call(document.querySelectorAll("[data-tool]"), function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-tool") === state.tool);
    });
    var modeEl = document.getElementById("dim-mode");
    if (modeEl) modeEl.textContent = state.tool;
  }

  /* boot ----------------------------------------------------------------- */

  function boot() {
    viewport = document.getElementById("viewport");
    layerGeom = document.getElementById("dim-geom");
    layerLines = document.getElementById("dim-lines");
    editorEl = document.getElementById("dim-editor");
    flyout = document.getElementById("dim-flyout");
    foot = document.getElementById("dim-foot");

    Array.prototype.forEach.call(document.querySelectorAll("[data-tool]"), function (b) {
      b.addEventListener("click", function () {
        state.tool = b.getAttribute("data-tool");
        state.status = state.tool === "dimension"
          ? "pick the kind, then click the sketch to place it"
          : "double-click a dimension to edit it";
        render();
      });
    });

    flyout.addEventListener("click", function (e) {
      var opt = e.target.closest("[data-draft-kind]");
      if (!opt) return;
      state.draftKind = opt.getAttribute("data-draft-kind");
      render();
    });

    var svg = document.getElementById("svg");

    // place a dimension on the top edge with the draft kind
    svg.addEventListener("click", function (e) {
      if (state.tool !== "dimension") return;
      if (e.target.closest(".dim-editor")) return;
      var existing = dimById("d-place");
      if (!existing) {
        dims.push({
          id: "d-place",
          a: [R.x0, R.y1],
          b: [R.x1, R.y1],
          y: R.y1 + 22,
          kind: state.draftKind,
          value: "70.0"
        });
      } else {
        existing.kind = state.draftKind;
      }
      state.status = "placed a " + state.draftKind + " dimension";
      render();
      openEditor("d-place");
    });

    // double-click an existing label to edit it
    svg.addEventListener("dblclick", function (e) {
      var text = e.target.closest("text.dim-text");
      if (!text) return;
      var at = Number(text.getAttribute("x"));
      var best = null;
      var bestD = 1e9;
      dims.forEach(function (d) {
        var p = px([(d.a[0] + d.b[0]) / 2, d.y]);
        var dd = Math.abs(p[0] - at);
        if (dd < bestD) { bestD = dd; best = d; }
      });
      if (best) openEditor(best.id);
    });

    editorEl.addEventListener("click", function (e) {
      var opt = e.target.closest("[data-kind-option]");
      if (opt && state.editor) {
        state.editor.kind = opt.getAttribute("data-kind-option");
        state.status = state.editor.kind === "reference"
          ? "reference — the width would be released"
          : "driving — the width would be constrained";
        syncEditorKind();
        return;
      }
      if (e.target.closest("[data-dim-delete]")) {
        dims = dims.filter(function (d) { return d.id !== state.editingId; });
        state.status = "deleted the dimension";
        closeEditor();
      }
    });

    editorEl.addEventListener("input", function (e) {
      if (e.target.matches("input") && state.editor) state.editor.value = e.target.value;
    });

    // Enter commits, Escape reverts — there is no apply button
    document.addEventListener("keydown", function (e) {
      if (!state.editor) return;
      if (e.key === "Enter") { e.preventDefault(); commitEditor(); }
      else if (e.key === "Escape") { e.preventDefault(); revertEditor(); }
    });

    // a click outside commits
    document.addEventListener("pointerdown", function (e) {
      if (!state.editor) return;
      if (editorEl.contains(e.target)) return;
      commitEditor();
    });

    openEditor("d-width");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
