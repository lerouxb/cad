/*
 * Shared helpers for the static UI mockups.
 *
 * These files are design targets, not application code. Nothing here is
 * imported by src/. Open the HTML files directly in a browser.
 */
(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* icons                                                              */
  /* ------------------------------------------------------------------ */

  var ICONS = {
    sketch:
      '<path d="M4 20h16M6 16 16.5 5.5a2.1 2.1 0 0 1 3 3L9 19l-4 1 1-4Z"/>',
    extrude:
      '<path d="M4 9.5 12 5l8 4.5v7L12 21l-8-4.5v-7Z"/><path d="M4 9.5 12 14l8-4.5M12 14v7" opacity=".65"/>',
    plane:
      '<path d="m3 15 9-5 9 5-9 5-9-5Z"/><path d="M6 13.3 15 8.3M9 17.3l9-5" opacity=".5"/>',
    midplane:
      '<path d="m3 14 9-5 9 5-9 5-9-5Z"/><path d="M12 3v18" stroke-dasharray="3 3"/>',
    offset:
      '<path d="m3 16 9-5 9 5-9 5-9-5Z"/><path d="m3 11 9-5 9 5" opacity=".55"/>',
    face:
      '<path d="M5 5h14v14H5z"/><path d="M5 9.5h14" opacity=".45"/><path d="m8 15 3-2 5 2.5" opacity=".65"/>',
    origin:
      '<circle cx="12" cy="12" r="2.2"/><path d="M12 3v18M3 12h18" opacity=".55"/>',
    gusset:
      '<path d="M4 20V9l7 11H4Z"/><path d="M4 9h7" opacity=".5"/>',
    cut:
      '<circle cx="9" cy="9" r="5"/><path d="M13 13 21 21M21 13l-8 8"/>',
    fillet:
      '<path d="M4 20V9a5 5 0 0 1 5-5h11"/><path d="M4 4h3M20 20v-3" opacity=".45"/>',
    warning:
      '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 9v5M12 17h.01"/>',
    error:
      '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    more:
      '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    eye:
      '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.7"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    fit:
      '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    grid:
      '<path d="M4 4h16v16H4z"/><path d="M9 4v16M15 4v16M4 9h16M4 15h16"/>',
    cube:
      '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9" opacity=".6"/>',
    undo:
      '<path d="M9 5 4 10l5 5"/><path d="M4 10h9a6 6 0 0 1 0 12" transform="translate(0 -2)"/>',
    redo:
      '<path d="m15 5 5 5-5 5"/><path d="M20 10h-9a6 6 0 0 0 0 12" transform="translate(0 -2)"/>',
    select: '<path d="M5 3l6.5 17 2.4-6.6 6.6-2.4L5 3Z"/>',
    line:
      '<path d="M4 19 19 5"/><circle cx="4" cy="19" r="1.6" fill="currentColor"/><circle cx="19" cy="5" r="1.6" fill="currentColor"/>',
    rect:
      '<rect x="4" y="6" width="16" height="12" rx="1"/><circle cx="4" cy="6" r="1.3" fill="currentColor"/><circle cx="20" cy="18" r="1.3" fill="currentColor"/>',
    circle:
      '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    arc:
      '<path d="M4 18a12 12 0 0 1 16-14"/><circle cx="4" cy="18" r="1.4" fill="currentColor"/><circle cx="20" cy="4" r="1.4" fill="currentColor"/>',
    dim:
      '<path d="M4 6v12M20 6v12M4 12h16m-12-3-4 3 4 3m8-6 4 3-4 3"/>',
    project:
      '<path d="M4 5h16M6 9l4 10M14 9l-4 10" opacity=".8"/><path d="M4 19h16" stroke-dasharray="3 3"/>',
    construction:
      '<path d="M4 19 19 5" stroke-dasharray="4 3"/><circle cx="4" cy="19" r="1.5"/><circle cx="19" cy="5" r="1.5"/>',
    trash:
      '<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    folder:
      '<path d="M3 7h7l2 2h9v10H3V7Z"/><path d="M3 10h18" opacity=".5"/>',
    lock:
      '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    pin:
      '<path d="m9 3 6 6-2 2 4 4-2 2-4-4-2 2-4-4 4-4Z"/><path d="m10 14-6 6" opacity=".5"/>',
    measure:
      '<path d="M3 17 17 3l4 4L7 21l-4-4Z"/><path d="m7 13 2 2m2-6 2 2m2-6 2 2"/>',
    export:
      '<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 17v4h16v-4"/>',
    gear:
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
    play: '<path d="m8 5 11 7-11 7V5Z"/>',
    skip: '<path d="m6 5 8 7-8 7V5ZM18 5v14"/>',
    rollback:
      '<path d="M4 12h12a4 4 0 0 1 0 8h-3"/><path d="m8 8-4 4 4 4"/>',
    layers:
      '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5" opacity=".6"/><path d="m3 17 9 5 9-5" opacity=".3"/>',
    info:
      '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    link:
      '<path d="M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
    edit: '<path d="M4 20h16M6 16 16.5 5.5a2.1 2.1 0 0 1 3 3L9 19l-4 1 1-4Z"/>',
    camera:
      '<path d="M4 8h4l2-2h4l2 2h4v11H4V8Z"/><circle cx="12" cy="13" r="3"/>',
  };

  function icon(name, size) {
    var path = ICONS[name] || ICONS.info;
    var px = size || 16;
    return (
      '<svg class="ico-svg" width="' +
      px +
      '" height="' +
      px +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      path +
      "</svg>"
    );
  }

  function hydrateIcons(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll("[data-icon]"), function (el) {
      if (el.dataset.hydrated === "1") return;
      el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size || 16));
      el.dataset.hydrated = "1";
    });
  }

  /* ------------------------------------------------------------------ */
  /* isometric model                                                     */
  /* ------------------------------------------------------------------ */

  function iso(cx, cy, s, x, y, z) {
    return [cx + (x - y) * 0.8660254 * s, cy + (x + y) * 0.5 * s - z * s];
  }

  function fmt(n) {
    return n.toFixed(1);
  }

  function poly(cx, cy, s, points, cls, extra) {
    var coords = points
      .map(function (p) {
        var q = iso(cx, cy, s, p[0], p[1], p[2]);
        return fmt(q[0]) + "," + fmt(q[1]);
      })
      .join(" ");
    return (
      '<polygon points="' +
      coords +
      '" class="' +
      cls +
      '"' +
      (extra ? " " + extra : "") +
      "/>"
    );
  }

  function pathOf(points, close) {
    return (
      "M " +
      points
        .map(function (q) {
          return fmt(q[0]) + " " + fmt(q[1]);
        })
        .join(" L ") +
      (close ? " Z" : "")
    );
  }

  function ellipsePath(cx, cy, s, map, segments) {
    var n = segments || 64;
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var a = (i / n) * Math.PI * 2;
      pts.push(iso(cx, cy, s, map[0](a), map[1](a), map[2](a)));
    }
    return pathOf(pts, true);
  }

  /*
   * An L-shaped angle bracket with a gusset and mounting holes.
   *
   * Profile (XZ): (0,0) (150,0) (150,14) (24,14) (24,110) (0,110)
   * Extruded along +Y by 40 mm.
   *
   * options:
   *   cx, cy, s        screen placement / scale
   *   dim              ghost the whole body
   *   showGusset       draw the solid triangular gusset (default true)
   *   ghostGusset      draw the gusset as a translucent preview
   *   highlight        "front" | "top" | ""  (blue pick overlay)
   *   holes            draw the three holes (default true)
   *   shadow           draw the ground shadow (default true)
   */
  function bracket(opts) {
    opts = opts || {};
    var cx = opts.cx == null ? 560 : opts.cx;
    var cy = opts.cy == null ? 420 : opts.cy;
    var s = opts.s == null ? 3 : opts.s;
    var showGusset = opts.showGusset !== false;
    var ghostGusset = !!opts.ghostGusset;
    var holes = opts.holes !== false;
    var highlight = opts.highlight || "";
    var highlightGusset = !!opts.highlightGusset;
    var cls =
      "model-bracket" +
      (opts.dim ? " is-dim" : "") +
      (opts.className ? " " + opts.className : "");

    var front = [
      [0, 40, 0],
      [150, 40, 0],
      [150, 40, 14],
      [24, 40, 14],
      [24, 40, 110],
      [0, 40, 110],
    ];
    var topBase = [
      [24, 0, 14],
      [150, 0, 14],
      [150, 40, 14],
      [24, 40, 14],
    ];
    var rightBase = [
      [150, 0, 0],
      [150, 40, 0],
      [150, 40, 14],
      [150, 0, 14],
    ];
    var topUpright = [
      [0, 0, 110],
      [24, 0, 110],
      [24, 40, 110],
      [0, 40, 110],
    ];
    var innerUpright = [
      [24, 0, 14],
      [24, 40, 14],
      [24, 40, 110],
      [24, 0, 110],
    ];

    var out = [];
    out.push('<g class="' + cls + '">');
    if (opts.shadow === true) {
      var sh = iso(cx, cy, s, 78, 24, 0);
      out.push(
        '<ellipse class="model-shadow" cx="' +
          fmt(sh[0]) +
          '" cy="' +
          fmt(sh[1] + 8) +
          '" rx="' +
          fmt(150 * s) +
          '" ry="' +
          fmt(34 * s) +
          '"/>',
      );
    }

    out.push(poly(cx, cy, s, topBase, "face-top-base"));
    out.push(poly(cx, cy, s, topUpright, "face-top-upright"));
    out.push(poly(cx, cy, s, rightBase, "face-right-base"));
    out.push(poly(cx, cy, s, innerUpright, "face-inner-upright"));
    out.push(poly(cx, cy, s, front, "face-front"));

    if (highlight === "front") {
      out.push(poly(cx, cy, s, front, "face-overlay"));
    } else if (highlight === "top") {
      out.push(poly(cx, cy, s, topUpright, "face-overlay"));
    }

    if (showGusset || ghostGusset) {
      var gCls =
        (ghostGusset ? "gusset-face gusset-ghost" : "gusset-face") +
        (highlightGusset ? " is-highlight" : "");
      var gSlopeCls =
        (ghostGusset ? "gusset-slope gusset-ghost" : "gusset-slope") +
        (highlightGusset ? " is-highlight" : "");
      out.push(
        poly(
          cx,
          cy,
          s,
          [
            [24, 40, 14],
            [78, 40, 14],
            [24, 40, 78],
          ],
          gCls,
        ),
      );
      out.push(
        poly(
          cx,
          cy,
          s,
          [
            [78, 40, 14],
            [24, 40, 78],
            [24, 0, 78],
            [78, 0, 14],
          ],
          gSlopeCls,
        ),
      );
    }

    if (holes) {
      // Hole through the upright, seen on the front (y = 40) face.
      out.push(
        '<path class="hole" d="' +
          ellipsePath(cx, cy, s, [
            function (a) {
              return 12 + 6.5 * Math.cos(a);
            },
            function () {
              return 40;
            },
            function (a) {
              return 78 + 6.5 * Math.sin(a);
            },
          ]) +
          '"/>',
      );
      // Two holes through the base, seen on the top (z = 14) face.
      [98, 130].forEach(function (x0) {
        out.push(
          '<path class="hole" d="' +
            ellipsePath(cx, cy, s, [
              function (a) {
                return x0 + 6.5 * Math.cos(a);
              },
              function (a) {
                return 20 + 6.5 * Math.sin(a);
              },
              function () {
                return 14;
              },
            ]) +
            '"/>',
        );
      });
    }

    out.push("</g>");
    return out.join("");
  }

  /*
   * A translucent datum plane cutting the bracket. y = 20 is the midplane
   * between the two 40 mm side faces.
   */
  function datumPlane(opts) {
    opts = opts || {};
    var cx = opts.cx == null ? 560 : opts.cx;
    var cy = opts.cy == null ? 420 : opts.cy;
    var s = opts.s == null ? 3 : opts.s;
    var y = opts.y == null ? 20 : opts.y;
    var cls = "datum-group " + (opts.cls || "datum-plane");
    var label = opts.label == null ? "Plane 2 · Midplane" : opts.label;
    var showAxes = opts.showAxes !== false;

    var quad = [
      [0, y, 0],
      [150, y, 0],
      [150, y, 110],
      [0, y, 110],
    ];
    var out = [];
    out.push('<g class="' + cls + '">');
    out.push(poly(cx, cy, s, quad, "datum-quad"));

    if (showAxes) {
      var a = iso(cx, cy, s, 0, y, 55);
      var b = iso(cx, cy, s, 150, y, 55);
      var c = iso(cx, cy, s, 75, y, 0);
      var d = iso(cx, cy, s, 75, y, 110);
      out.push(
        '<line class="datum-axis datum-axis-x" x1="' +
          fmt(a[0]) +
          '" y1="' +
          fmt(a[1]) +
          '" x2="' +
          fmt(b[0]) +
          '" y2="' +
          fmt(b[1]) +
          '"/>',
      );
      out.push(
        '<line class="datum-axis datum-axis-z" x1="' +
          fmt(c[0]) +
          '" y1="' +
          fmt(c[1]) +
          '" x2="' +
          fmt(d[0]) +
          '" y2="' +
          fmt(d[1]) +
          '"/>',
      );
    }

    if (label) {
      var p = iso(cx, cy, s, 150, y, 110);
      var lx = p[0] + 10;
      var ly = p[1] - 12;
      out.push(
        '<g class="plane-label"><line class="plane-leader" x1="' +
          fmt(p[0]) +
          '" y1="' +
          fmt(p[1]) +
          '" x2="' +
          fmt(lx) +
          '" y2="' +
          fmt(ly + 4) +
          '"/><circle cx="' +
          fmt(p[0]) +
          '" cy="' +
          fmt(p[1]) +
          '" r="2.2"/><text x="' +
          fmt(lx + 8) +
          '" y="' +
          fmt(ly + 8) +
          '">' +
          label +
          "</text></g>",
      );
    }
    out.push("</g>");
    return out.join("");
  }

  /* Miniature bracket used for index cards and small contexts. */
  function miniBracket(opts) {
    opts = opts || {};
    return bracket({
      cx: opts.cx == null ? 190 : opts.cx,
      cy: opts.cy == null ? 128 : opts.cy,
      s: opts.s == null ? 1.18 : opts.s,
      dim: opts.dim,
      showGusset: opts.showGusset,
      ghostGusset: opts.ghostGusset,
      highlight: opts.highlight,
      highlightGusset: opts.highlightGusset,
      shadow: opts.shadow === true,
      holes: opts.holes,
    });
  }

  /* ------------------------------------------------------------------ */
  /* history strip                                                       */
  /* ------------------------------------------------------------------ */

  var HISTORY = [
    { num: "01", kind: "sketch", name: "base profile", meta: "XY · 8 curves" },
    { num: "02", kind: "extrude", name: "bracket body", meta: "12.0 mm · new" },
    { num: "03", kind: "plane", name: "symmetry", meta: "midplane" },
    { num: "04", kind: "sketch", name: "gusset profile", meta: "midplane" },
    { num: "05", kind: "extrude", name: "gusset 45°", meta: "40.0 mm · symmetric" },
    { num: "06", kind: "sketch", name: "M4 holes", meta: "Face 02 · front" },
    { num: "07", kind: "extrude", name: "holes cut", meta: "through all · cut" },
  ];

  function timeline(opts) {
    opts = opts || {};
    var active = opts.active || "";
    var pausedFrom = opts.pausedFrom || 0;
    var error = opts.error || "";
    var pending = opts.pending || null;
    var out = [];

    for (var i = 0; i < HISTORY.length; i++) {
      var step = HISTORY[i];
      var index = i + 1;
      var classes = ["step"];
      if (step.num === active) classes.push("is-active");
      if (pausedFrom && index >= pausedFrom) classes.push("is-paused");
      if (error && step.num === error) classes.push("is-error");

      out.push(
        '<button class="' +
          classes.join(" ") +
          '" type="button">' +
          '<span class="step-head">' +
          '<span class="step-index">' +
          step.num +
          "</span>" +
          '<span class="step-kind">' +
          step.kind +
          "</span>" +
          "</span>" +
          '<span class="step-name">' +
          step.name +
          (error && step.num === error ? '<span class="step-error"> !</span>' : "") +
          "</span>" +
          '<span class="step-meta">' +
          step.meta +
          "</span>" +
          "</button>",
      );
    }

    if (pending) {
      var pendingNum = ("0" + (HISTORY.length + 1)).slice(-2);
      out.push(
        '<button class="step is-active is-pending" type="button">' +
          '<span class="step-head">' +
          '<span class="step-index">' +
          pendingNum +
          "</span>" +
          '<span class="step-kind">' +
          pending.kind +
          "</span>" +
          "</span>" +
          '<span class="step-name">' +
          pending.name +
          "</span>" +
          '<span class="step-meta">' +
          pending.meta +
          "</span>" +
          "</button>",
      );
    }
    return out.join("");
  }

  /* ------------------------------------------------------------------ */
  /* page wiring                                                         */
  /* ------------------------------------------------------------------ */

  function readTheme() {
    try {
      var fromQuery = new URLSearchParams(window.location.search).get("theme");
      if (fromQuery === "day" || fromQuery === "night") return fromQuery;
      var stored = window.localStorage.getItem("cad-mockup-theme");
      if (stored === "day" || stored === "night") return stored;
    } catch (error) {
      /* file:// storage can be unavailable */
    }
    return "day";
  }

  function applyTheme(theme, persist) {
    var next = theme === "night" ? "night" : "day";
    document.documentElement.setAttribute("data-theme", next);
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-theme-option]"),
      function (btn) {
        btn.classList.toggle("is-active", btn.dataset.themeOption === next);
        btn.setAttribute("aria-pressed", String(btn.dataset.themeOption === next));
      },
    );
    if (persist !== false) {
      try {
        window.localStorage.setItem("cad-mockup-theme", next);
      } catch (error) {
        /* ignore */
      }
    }
    document.dispatchEvent(new CustomEvent("mockup-theme", { detail: next }));
    return next;
  }

  var HIGHLIGHTS = ["yellow", "pink", "blue", "green"];

  function readHighlight() {
    try {
      var fromQuery = new URLSearchParams(window.location.search).get(
        "highlight",
      );
      if (HIGHLIGHTS.indexOf(fromQuery) !== -1) return fromQuery;
      var stored = window.localStorage.getItem("cad-mockup-highlight");
      if (HIGHLIGHTS.indexOf(stored) !== -1) return stored;
    } catch (error) {
      /* file:// storage can be unavailable */
    }
    return "yellow";
  }

  function applyHighlight(name, persist) {
    var next = HIGHLIGHTS.indexOf(name) === -1 ? "yellow" : name;
    document.documentElement.setAttribute("data-highlight", next);
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-highlight-option]"),
      function (btn) {
        var active = btn.dataset.highlightOption === next;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", String(active));
      },
    );
    if (persist !== false) {
      try {
        window.localStorage.setItem("cad-mockup-highlight", next);
      } catch (error) {
        /* ignore */
      }
    }
    document.dispatchEvent(
      new CustomEvent("mockup-highlight", { detail: next }),
    );
    return next;
  }

  function wireDraggable() {
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-drag]"),
      function (el) {
        var handle =
          el.querySelector("[data-drag-handle]") ||
          el.querySelector(".picker-title") ||
          el.querySelector(".picker-kicker");
        if (!handle) return;
        var drag = null;
        handle.addEventListener("pointerdown", function (e) {
          if (e.target.closest("button")) return;
          var parent = el.offsetParent || document.body;
          var pr = el.getBoundingClientRect();
          var par = parent.getBoundingClientRect();
          el.style.left = pr.left - par.left + "px";
          el.style.top = pr.top - par.top + "px";
          el.style.right = "auto";
          el.style.bottom = "auto";
          drag = { x: e.clientX - pr.left, y: e.clientY - pr.top };
          try {
            handle.setPointerCapture(e.pointerId);
          } catch (err) {
            /* ignore */
          }
          e.preventDefault();
        });
        handle.addEventListener("pointermove", function (e) {
          if (!drag) return;
          var parent = el.offsetParent || document.body;
          var par = parent.getBoundingClientRect();
          var l = e.clientX - drag.x - par.left;
          var t = e.clientY - drag.y - par.top;
          l = Math.max(0, Math.min(par.width - el.offsetWidth, l));
          t = Math.max(0, Math.min(par.height - el.offsetHeight, t));
          el.style.left = l + "px";
          el.style.top = t + "px";
        });
        function up(e) {
          if (!drag) return;
          drag = null;
          try {
            handle.releasePointerCapture(e.pointerId);
          } catch (err) {
            /* ignore */
          }
        }
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      },
    );
  }

  function wire() {
    hydrateIcons(document);
    wireDraggable();

    var theme = applyTheme(readTheme(), false);
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-theme-option]"),
      function (btn) {
        btn.addEventListener("click", function () {
          theme = applyTheme(btn.dataset.themeOption, true);
        });
      },
    );

    var highlight = applyHighlight(readHighlight(), false);
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-highlight-option]"),
      function (btn) {
        btn.addEventListener("click", function () {
          highlight = applyHighlight(btn.dataset.highlightOption, true);
        });
      },
    );

    if (new URLSearchParams(window.location.search).get("embed") === "1") {
      document.body.classList.add("is-embed");
    }

    var notes = document.getElementById("notes");
    var toggles = document.querySelectorAll("[data-notes-toggle]");
    Array.prototype.forEach.call(toggles, function (btn) {
      btn.addEventListener("click", function () {
        if (!notes) return;
        notes.classList.toggle("is-open");
        btn.classList.toggle("is-active", notes.classList.contains("is-open"));
      });
    });
    var closers = document.querySelectorAll("[data-notes-close]");
    Array.prototype.forEach.call(closers, function (btn) {
      btn.addEventListener("click", function () {
        if (!notes) return;
        notes.classList.remove("is-open");
        Array.prototype.forEach.call(toggles, function (t) {
          t.classList.remove("is-active");
        });
      });
    });

    Array.prototype.forEach.call(
      document.querySelectorAll("[data-segmented]"),
      function (group) {
        Array.prototype.forEach.call(group.querySelectorAll("button"), function (btn) {
          btn.addEventListener("click", function () {
            if (btn.disabled) return;
            Array.prototype.forEach.call(group.querySelectorAll("button"), function (b) {
              b.classList.remove("is-active");
            });
            btn.classList.add("is-active");
          });
        });
      },
    );

    Array.prototype.forEach.call(
      document.querySelectorAll("[data-range]"),
      function (input) {
        var output = document.querySelector(input.dataset.range);
        var update = function () {
          if (output) output.textContent = Number(input.value).toFixed(1) + " mm";
        };
        input.addEventListener("input", update);
        update();
      },
    );

    Array.prototype.forEach.call(
      document.querySelectorAll("[data-select-group]"),
      function (group) {
        Array.prototype.forEach.call(
          group.querySelectorAll("[data-select-option]"),
          function (option) {
            option.addEventListener("click", function () {
              if (option.disabled) return;
              Array.prototype.forEach.call(
                group.querySelectorAll("[data-select-option]"),
                function (o) {
                  o.classList.remove("is-selected");
                },
              );
              option.classList.add("is-selected");
            });
          },
        );
      },
    );

    Array.prototype.forEach.call(
      document.querySelectorAll("[data-row-select]"),
      function (row) {
        row.addEventListener("click", function () {
          var scope = row.closest("[data-row-group]") || document;
          Array.prototype.forEach.call(
            scope.querySelectorAll("[data-row-select]"),
            function (r) {
              r.classList.remove("is-selected");
            },
          );
          row.classList.add("is-selected");
        });
      },
    );
  }

  window.M = {
    icon: icon,
    hydrateIcons: hydrateIcons,
    iso: iso,
    bracket: bracket,
    miniBracket: miniBracket,
    datumPlane: datumPlane,
    timeline: timeline,
    applyTheme: applyTheme,
    applyHighlight: applyHighlight,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
