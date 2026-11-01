/*
 * Shared interaction helpers for the showcase pages.
 * See INTERACTION.md: input is a draggable popover, actions are in its footer.
 * Design target only — not imported by src/.
 */
(function () {
  "use strict";

  // Make a popover draggable by its header. Once moved it stays put; the page's
  // own layout function must check `panel.dataset.dragged` and not reset it.
  function makeDraggable(panel, viewport) {
    var drag = null;
    panel.addEventListener("pointerdown", function (e) {
      var head = e.target.closest ? e.target.closest(".tool-panel-head") : null;
      if (!head || e.target.closest("button")) return;
      var pr = panel.getBoundingClientRect();
      var vr = viewport.getBoundingClientRect();
      panel.style.left = pr.left - vr.left + "px";
      panel.style.top = pr.top - vr.top + "px";
      panel.style.right = "auto";
      panel.dataset.dragged = "1";
      drag = { x: e.clientX - pr.left, y: e.clientY - pr.top };
      try {
        panel.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      e.preventDefault();
    });
    panel.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var vr = viewport.getBoundingClientRect();
      var l = e.clientX - vr.left - drag.x;
      var t = e.clientY - vr.top - drag.y;
      l = Math.max(4, Math.min(vr.width - panel.offsetWidth - 4, l));
      t = Math.max(4, Math.min(vr.height - panel.offsetHeight - 4, t));
      panel.style.left = l + "px";
      panel.style.top = t + "px";
    });
    function up(e) {
      if (!drag) return;
      drag = null;
      try {
        panel.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    }
    panel.addEventListener("pointerup", up);
    panel.addEventListener("pointercancel", up);
  }

  // The shared footer: a summary on the left, actions on the right.
  function footer(summary, actions) {
    return (
      '<div class="tool-panel-foot"><span class="tool-summary">' + summary +
      '</span><span class="tool-panel-actions">' +
      actions
        .map(function (a) {
          return (
            '<button type="button" class="text-action' +
            (a.quiet ? " is-quiet" : "") + '" data-action="' + a.id + '">' +
            a.label + "</button>"
          );
        })
        .join("") +
      "</span></div>"
    );
  }

  // The single-value inline editor. It replaces the annotation's label, carries
  // the value's own option (a dimension's driving/reference), and has NO buttons:
  // Enter commits, Escape (or a tap outside) cancels. See INTERACTION.md.
  // The mockups carry the same markup, with `is-inline` added for the
  // foreignObject positioning.
  function inlineEditor(opts) {
    opts = opts || {};
    var kind = opts.kind === "reference" ? "reference" : "driving";
    return (
      '<div class="dim-editor is-selected">' +
      '<input type="text" value="' +
      (opts.value == null ? "" : opts.value) +
      '" aria-label="Dimension value">' +
      (opts.unit ? '<span class="dim-unit">' + opts.unit + "</span>" : "") +
      '<button class="dim-kind' +
      (kind === "driving" ? " is-active" : "") +
      '" type="button">' +
      kind +
      "</button></div>"
    );
  }

  window.ShowcaseUI = {
    makeDraggable: makeDraggable,
    footer: footer,
    inlineEditor: inlineEditor
  };
})();
