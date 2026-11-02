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

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  function subv(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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

  // a box whose top face has a real circular hole (even-odd fill)
  function drawBoxHole(iso, b, hole) {
    var f = boxFaces(b);
    var html =
      poly(pts3(iso, f.ymax), "bo-face-y") +
      poly(pts3(iso, f.xmax), "bo-face-x");
    var top = pts3(iso, f.top);
    var d =
      "M " +
      top
        .map(function (q) {
          return q[0].toFixed(1) + " " + q[1].toFixed(1);
        })
        .join(" L ") +
      " Z";
    if (hole) d += " " + ellipsePath(iso, hole.x, hole.y, b.z1, hole.r);
    html +=
      '<path d="' + d + '" fill-rule="evenodd" class="bo-face-top"/>';
    return html;
  }

  function boxCorners(b) {
    return [
      [b.x0, b.y0, b.z0],
      [b.x1, b.y0, b.z0],
      [b.x1, b.y1, b.z0],
      [b.x0, b.y1, b.z0],
      [b.x0, b.y0, b.z1],
      [b.x1, b.y0, b.z1],
      [b.x1, b.y1, b.z1],
      [b.x0, b.y1, b.z1]
    ];
  }

  // a box from its 8 corners (bottom 0-3, top 4-7), so it can be rotated.
  // only front-facing faces are drawn, shaded by their dominant axis.
  function drawBoxCorners(iso, c, prefix, ghost) {
    var quads = [
      [0, 3, 2, 1],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [1, 2, 6, 5],
      [2, 3, 7, 6],
      [3, 0, 4, 7]
    ];
    var html = "";
    quads.forEach(function (q) {
      var p0 = c[q[0]],
        p1 = c[q[1]],
        p2 = c[q[2]];
      var n = cross(subv(p1, p0), subv(p2, p1));
      if (n[0] + n[1] + n[2] <= 0) return;
      var ax = Math.abs(n[0]),
        ay = Math.abs(n[1]),
        az = Math.abs(n[2]);
      var name = az >= ax && az >= ay ? "top" : ax >= ay ? "x" : "y";
      var cls = ghost
        ? "bo-ghost"
        : prefix
          ? prefix + "-" + name
          : "bo-face-" + name;
      html += poly(pts3(iso, q.map(function (i) { return c[i]; })), cls);
    });
    return html;
  }

  // the visible far wall of a bore, between the top and bottom openings.
  // In this isometric the far side of a circle is theta in [135deg, 315deg].
  function boreWall(iso, x, y, r, zTop, zBot) {
    var pts = [];
    var n = 24;
    for (var k = 0; k <= n; k++) {
      var th = Math.PI * 0.75 + (Math.PI * k) / n;
      pts.push(iso.p(x + r * Math.cos(th), y + r * Math.sin(th), zTop));
    }
    for (var k2 = 0; k2 <= n; k2++) {
      var th2 = Math.PI * 1.75 - (Math.PI * k2) / n;
      pts.push(iso.p(x + r * Math.cos(th2), y + r * Math.sin(th2), zBot));
    }
    return poly(pts, "bo-bore");
  }

  // a transparent cylinder outline, for a ghost tool body
  function cylinderGhost(iso, x, y, r, z0, z1, cls) {
    var top = iso.p(x, y, z1),
      bot = iso.p(x, y, z0);
    var rx = 1.2247 * r * iso.s;
    return (
      '<path d="' + ellipsePath(iso, x, y, z1, r) + '" class="' + cls + '" fill="none"/>' +
      '<path d="' + ellipsePath(iso, x, y, z0, r) + '" class="' + cls + '" fill="none"/>' +
      '<line x1="' + (top[0] - rx).toFixed(1) + '" y1="' + top[1].toFixed(1) +
      '" x2="' + (bot[0] - rx).toFixed(1) + '" y2="' + bot[1].toFixed(1) +
      '" class="' + cls + '"/>' +
      '<line x1="' + (top[0] + rx).toFixed(1) + '" y1="' + top[1].toFixed(1) +
      '" x2="' + (bot[0] + rx).toFixed(1) + '" y2="' + bot[1].toFixed(1) +
      '" class="' + cls + '"/>'
    );
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

  function planeLabel(iso, b, axis, pos, text) {
    var a;
    if (axis === "x") a = iso.p(pos, b.y1, b.z1);
    else if (axis === "y") a = iso.p(b.x1, pos, b.z1);
    else a = iso.p(b.x1, b.y1, pos);
    return (
      '<text class="bo-plane-label" x="' + (a[0] + 8).toFixed(1) + '" y="' +
      (a[1] - 6).toFixed(1) + '">' + text + "</text>"
    );
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
    if (spec.list) {
      html += '<div class="picker-section">' + spec.list.label + "</div>";
      spec.list.rows.forEach(function (r) {
        html +=
          '<button class="picker-row' +
          (p[spec.list.key] === r.value ? " is-selected" : "") +
          '" type="button" data-list="' + r.value + '">' +
          '<span class="row-name">' + r.name + "</span>" +
          '<span class="row-meta">' + r.meta + "</span></button>";
      });
    }
    spec.rows.forEach(function (row) {
      if (row.when && !row.when(p)) return;
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
      } else if (row.type === "input") {
        ctrl =
          '<label class="tool-input"><input type="text" inputmode="decimal" data-input="' +
          row.key + '" value="' + fmt1(v) + '">' +
          '<span class="unit">' + (row.unit || "") + "</span></label>";
      } else if (row.type === "static") {
        ctrl = '<span class="tool-note">' + row.value + "</span>";
      }
      html +=
        '<div class="tool-row"><span class="tool-label">' + row.label +
        "</span>" + ctrl + "</div>";
    });
    html += "</div>";
    if (spec.hint) html += '<div class="tool-hint">' + spec.hint + "</div>";
    html += ShowcaseUI.footer(spec.summary(p), [
      { id: "apply", label: spec.primary || "apply" },
      { id: "cancel", label: "cancel", quiet: true }
    ]);
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
    if (panel.dataset && panel.dataset.dragged) return;
    panel.style.left = "auto";
    panel.style.top = "24px";
    panel.style.right = "24px";
  }

  /* ------------------------------------------------------------------ */
  /* body ops: combine + split body                                      */
  /* ------------------------------------------------------------------ */

  var PLATE = { x0: 0, y0: 0, z0: 0, x1: 110, y1: 74, z1: 18 };
  var CYL = { x: 55, y: 37, r: 16, z0: -10, z1: 52 };
  var ENV = { x0: 0, y0: 0, z0: -10, x1: 110, y1: 74, z1: 52 };

  // splitting tools: existing datum planes or a tool body (not a free slider)
  var SPLIT_TOOLS = {
    plane1: { name: "Plane 1", meta: "offset", axis: "x", at: 40, plane: true },
    plane2: { name: "Plane 2", meta: "midplane", axis: "y", at: 37, plane: true },
    body2: { name: "Body 2", meta: "tool body", axis: "z", at: 9, plane: false }
  };

  var bo = {
    tool: "combine",
    msg: "",
    params: {
      combine: { op: "cut", keepTools: false },
      split: { tool: "plane1", offset: 40, keepBoth: true }
    }
  };
  var BO_DEFAULTS = JSON.parse(JSON.stringify(bo.params));

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
      list: {
        label: "splitting tool",
        key: "tool",
        rows: [
          { value: "plane1", name: "Plane 1", meta: "offset 40.0 mm" },
          { value: "plane2", name: "Plane 2", meta: "midplane" },
          { value: "body2", name: "Body 2", meta: "tool body" }
        ]
      },
      rows: [
        { type: "input", key: "offset", label: "plane offset", unit: "mm", when: function (p) { return SPLIT_TOOLS[p.tool].plane; } },
        { type: "toggle", key: "keepBoth", label: "keep both" },
        { type: "static", label: "target", value: "plate" }
      ],
      hint: "the position lives on the plane; edit the plane, not the split",
      summary: function (p) {
        var t = SPLIT_TOOLS[p.tool];
        var pos = t.plane ? p.offset : t.at;
        return (
          t.name + " \u00b7 " + t.meta +
          (t.plane ? " " + fmt1(pos) + " mm" : "") +
          " \u00b7 " + (p.keepBoth ? "keep both" : "keep one")
        );
      }
    };
  }

  function fmt1(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
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

  function splitAt(p) {
    var t = SPLIT_TOOLS[p.tool];
    return { axis: t.axis, pos: t.plane ? p.offset : t.at };
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
        // a real bore through the top face, and the tool ghosted above the plate
        html += boreWall(iso, CYL.x, CYL.y, CYL.r, PLATE.z1, PLATE.z0);
        html += drawBoxHole(iso, PLATE, { x: CYL.x, y: CYL.y, r: CYL.r });
        html += p.keepTools
          ? cylinderSolid(iso, CYL.x, CYL.y, CYL.r, PLATE.z1, CYL.z1, "bo-tool-kept", "bo-tool-kept")
          : cylinderGhost(iso, CYL.x, CYL.y, CYL.r, PLATE.z1, CYL.z1, "bo-ghost");
      } else {
        html += drawBox(iso, PLATE, null, true);
        html += cylinderSolid(iso, CYL.x, CYL.y, CYL.r, PLATE.z0, PLATE.z1, "bo-face-x", "bo-face-top");
        if (p.keepTools) {
          html += cylinderSolid(iso, CYL.x, CYL.y, CYL.r, PLATE.z1, CYL.z1, "bo-tool-kept", "bo-tool-kept");
        }
      }
    } else {
      var at = splitAt(p);
      var a = splitBox(at.axis, at.pos, true);
      var b = splitBox(at.axis, at.pos, false);
      html += drawBox(iso, a, null, false);
      html += p.keepBoth ? drawBox(iso, b, null, false) : drawBox(iso, b, null, true);
      html += planeQuad(iso, ENV, at.axis, at.pos);
      if (SPLIT_TOOLS[p.tool].plane) {
        html += planeLabel(iso, ENV, at.axis, at.pos, SPLIT_TOOLS[p.tool].name);
      }
    }
    layer.innerHTML = html;
    footEl.innerHTML =
      "<b>" + (tool === "combine" ? "combine" : "split body") + "</b> \u00b7 " +
      boSpec(tool).summary(p) + (bo.msg ? " \u00b7 " + bo.msg : "");
  }

  /* ------------------------------------------------------------------ */
  /* bodies in the timeline                                              */
  /* ------------------------------------------------------------------ */

  var BD_R1 = { x0: 10, y0: 10, z0: 0, x1: 60, y1: 50, z1: 8 };
  var BD_R2 = { x0: 70, y0: 10, z0: 0, x1: 120, y1: 50, z1: 8 };
  var BD_RM = { x0: 10, y0: 10, z0: 0, x1: 120, y1: 50, z1: 8 };
  var BD_BOSS = { x: 35, y: 30, r: 9, z0: 8, z1: 20 };
  var BD_HOLE = { x: 95, y: 30, r: 7 };

  var bd = {
    active: 8,
    connected: false,
    selected: null,
    order: [1, 2, 3, 4, 5, 6, 7, 8],
    groups: [{ id: "g1", name: "case details", ids: [4, 5, 6, 7], collapsed: false }],
    nextGid: 1,
    names: {},
    editing: null,
    drag: null,
    insertMenu: false,
    custom: [],
    nextNum: 8
  };

  var INSERT_TYPES = [
    { kind: "sketch", name: "sketch", note: "on a support" },
    { kind: "plane", name: "plane", note: "datum plane" }
  ];

  function bdStep(n) {
    var base = bdSteps();
    if (n >= 1 && n <= base.length) return base[n - 1];
    for (var i = 0; i < bd.custom.length; i++) {
      if (bd.custom[i].num === n) return bd.custom[i];
    }
    return { kind: "?", name: "?", meta: "", out: [] };
  }

  // a step's identity is stable; the number it shows is its position in the
  // timeline, so inserting in the middle renumbers the display, not the step.
  function bdPos(n) {
    return bd.order.indexOf(n) + 1;
  }

  function bdInsert(kind) {
    bd.nextNum++;
    var n = bd.nextNum;
    bd.custom.push({
      num: n,
      kind: kind,
      name: kind === "sketch" ? "new sketch" : "new plane",
      meta: kind === "sketch" ? "choosing support" : "offset 10.0 mm",
      out: [
        {
          op: "+",
          kind: kind,
          id: (kind === "sketch" ? "s" : "p") + n,
          label: kind === "sketch" ? "new sketch" : "new plane"
        }
      ]
    });
    // insert directly after the selected step, inside its group if it has one
    var g = bdGroupOf(bd.active);
    var pos = bd.order.indexOf(bd.active);
    if (g) {
      var ai = g.ids.indexOf(bd.active);
      g.ids.splice(ai + 1, 0, n);
    }
    bd.order.splice(pos + 1, 0, n);
    bd.active = n;
    bd.insertMenu = false;
  }

  function bdGroup(id) {
    for (var i = 0; i < bd.groups.length; i++) {
      if (bd.groups[i].id === id) return bd.groups[i];
    }
    return null;
  }

  function bdGroupOf(n) {
    for (var i = 0; i < bd.groups.length; i++) {
      if (bd.groups[i].ids.indexOf(n) !== -1) return bd.groups[i];
    }
    return null;
  }

  function bdDissolve() {
    bd.groups = bd.groups.filter(function (g) {
      return g.ids.length > 1;
    });
  }

  function bdMembersInOrder(g) {
    return g.ids.slice().sort(function (a, b) {
      return bd.order.indexOf(a) - bd.order.indexOf(b);
    });
  }

  // groups stay contiguous: only the first or last member can leave, and a
  // step that is not in a group can only group with an adjacent step.
  function bdCanDrag(n) {
    var g = bdGroupOf(n);
    if (!g) return true;
    var m = bdMembersInOrder(g);
    return n === m[0] || n === m[m.length - 1];
  }

  // Drag a step onto another step:
  //  - neither in a group and adjacent  -> start a group
  //  - dropped onto a group's edge       -> grow the group
  //  - first/last member dragged out     -> leave, landing beside the group
  // Groups stay contiguous and steps are not reordered, so a middle member is
  // not draggable and an ungrouped step only groups with an adjacent one.
  function bdApplyDrag(a, b) {
    if (a === b) return;
    var ga = bdGroupOf(a);
    var gb = bdGroupOf(b);
    if (ga && gb && ga === gb) return;
    var pa = bd.order.indexOf(a);
    var pb = bd.order.indexOf(b);
    if (ga) {
      var mem = bdMembersInOrder(ga);
      if (a !== mem[0] && a !== mem[mem.length - 1]) return;
      var first = a === mem[0];
      ga.ids = ga.ids.filter(function (x) {
        return x !== a;
      });
      bd.order.splice(pa, 1);
      var left = bdMembersInOrder(ga);
      var anchor = first ? left[0] : left[left.length - 1];
      var ai = bd.order.indexOf(anchor);
      bd.order.splice(first ? ai : ai + 1, 0, a);
      bdDissolve();
      return;
    }
    if (gb) {
      var pos = gb.ids.map(function (x) {
        return bd.order.indexOf(x);
      });
      var lo = Math.min.apply(null, pos);
      var hi = Math.max.apply(null, pos);
      if (pa === lo - 1 || pa === hi + 1) gb.ids.push(a);
      return;
    }
    if (Math.abs(pa - pb) === 1) {
      bd.nextGid = (bd.nextGid || 1) + 1;
      bd.groups.push({
        id: "g" + bd.nextGid,
        name: "group " + bd.nextGid,
        ids: [a, b],
        collapsed: false
      });
    }
  }

  function bdSteps() {
    var merged = bd.connected;
    return [
      {
        kind: "sketch",
        name: "base profiles",
        meta: merged ? "XY \u00b7 1 profile" : "XY \u00b7 2 profiles",
        out: [{ op: "+", kind: "sketch", id: "s1", label: "base profiles" }]
      },
      {
        kind: "extrude",
        name: "tab bodies",
        meta: "8.0 mm \u00b7 new body",
        out: merged
          ? [{ op: "+", kind: "body", id: "body", label: "body" }]
          : [
              { op: "+", kind: "body", id: "body", label: "body" },
              { op: "+", kind: "body", id: "lid", label: "lid" }
            ]
      },
      {
        kind: "plane",
        name: "symmetry",
        meta: "midplane",
        out: [{ op: "+", kind: "plane", id: "p1", label: "symmetry" }]
      },
      {
        kind: "sketch",
        name: "boss profile",
        meta: "on symmetry",
        group: true,
        out: [{ op: "+", kind: "sketch", id: "s2", label: "boss profile" }]
      },
      {
        kind: "extrude",
        name: "boss",
        meta: "6.0 mm \u00b7 join",
        group: true,
        out: [{ op: "\u2192", kind: "body", id: "body", label: "body" }]
      },
      {
        kind: "sketch",
        name: "mounting hole",
        meta: "top of lid",
        group: true,
        out: [{ op: "+", kind: "sketch", id: "s3", label: "mounting hole" }]
      },
      {
        kind: "extrude",
        name: "hole",
        meta: "through all \u00b7 cut",
        group: true,
        out: [
          { op: "\u2192", kind: "body", id: "lid", label: "lid", lost: merged }
        ]
      },
      {
        kind: "combine",
        name: "merge lid",
        meta: "join \u00b7 lid into body",
        out: [
          { op: "\u2192", kind: "body", id: "body", label: "body" },
          { op: "\u2212", kind: "body", id: "lid", label: "lid", consumed: true, lost: merged }
        ]
      }
    ];
  }

  function bdName(o) {
    return bd.names[o.id] || o.label;
  }

  function bdSelectOverlay(iso, box, hole) {
    var f = boxFaces(box);
    var html = "";
    html += poly(pts3(iso, f.xmax), "bo-select-x");
    html += poly(pts3(iso, f.ymax), "bo-select-y");
    var top = pts3(iso, f.top);
    var d =
      "M " +
      top
        .map(function (q) {
          return q[0].toFixed(1) + " " + q[1].toFixed(1);
        })
        .join(" L ") +
      " Z";
    // cut the hole out of the tint so the hole itself is not highlighted
    if (hole) d += " " + ellipsePath(iso, hole.x, hole.y, box.z1, hole.r);
    html += '<path d="' + d + '" fill-rule="evenodd" class="bo-select-top"/>';
    return html;
  }

  function bdRenderStage(iso, layer) {
    var at = bdPos(bd.active);
    var html = "";
    if (at <= 1) {
      html += profileQuad(iso, BD_R1, 0, "bo-profile");
      if (!bd.connected) html += profileQuad(iso, BD_R2, 0, "bo-profile");
      layer.innerHTML = html;
      return;
    }
    var merged = bd.connected || at >= 8;
    var hasHole = at >= 7;
    var hole = { x: BD_HOLE.x, y: BD_HOLE.y, r: BD_HOLE.r };
    var selBody = bd.selected && bd.selected.id === "body";
    var selLid = bd.selected && bd.selected.id === "lid";

    // 1. the bodies (the lid's top face is drawn with the hole cut out)
    if (merged) {
      if (hasHole) {
        html += boreWall(iso, hole.x, hole.y, hole.r, BD_RM.z1, BD_RM.z0);
        html += drawBoxHole(iso, BD_RM, hole);
      } else {
        html += drawBox(iso, BD_RM, null, false);
      }
    } else {
      html += drawBox(iso, BD_R1, null, false);
      if (hasHole) {
        html += boreWall(iso, hole.x, hole.y, hole.r, BD_R2.z1, BD_R2.z0);
        html += drawBoxHole(iso, BD_R2, hole);
      } else {
        html += drawBox(iso, BD_R2, null, false);
      }
    }

    // 2. the selection tint, over the body but under the boss
    if (selBody) {
      html += bdSelectOverlay(iso, merged ? BD_RM : BD_R1, merged && hasHole ? hole : null);
    }
    if (selLid && !merged) {
      html += bdSelectOverlay(iso, BD_R2, hasHole ? hole : null);
    }

    // 3. the boss, on top
    if (at >= 5) {
      html += cylinderSolid(
        iso, BD_BOSS.x, BD_BOSS.y, BD_BOSS.r, BD_BOSS.z0, BD_BOSS.z1,
        "bo-face-x", "bo-face-top"
      );
      if (selBody) {
        html += cylinderSolid(
          iso, BD_BOSS.x, BD_BOSS.y, BD_BOSS.r, BD_BOSS.z0, BD_BOSS.z1,
          "bo-select-x", "bo-select-top"
        );
      }
    }

    layer.innerHTML = html;
  }

  function bdPad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function bdChip(o) {
    var name = bdName(o);
    var dot = '<span class="body-dot is-' + o.kind + '"></span>';
    if (bd.editing && bd.editing.kind === "output" && bd.editing.id === o.id) {
      return (
        '<span class="body-chip is-editing">' + dot +
        '<input class="chip-input" data-rename="' + o.id + '" value="' + name +
        '" aria-label="Name">' +
        "</span>"
      );
    }
    var cls = "body-chip";
    if (bd.selected && bd.selected.id === o.id && !o.consumed) cls += " is-selected";
    if (o.consumed) cls += " is-consumed";
    if (o.lost) cls += " is-lost";
    if (o.consumed) {
      return (
        '<span class="' + cls + '" title="consumed by this step">' +
        '<span class="body-op">' + o.op + "</span>" + dot +
        '<span class="body-name">' + name + "</span></span>"
      );
    }
    return (
      '<button class="' + cls + '" type="button" data-out="' + o.id +
      '" data-kind="' + o.kind + '">' +
      '<span class="body-op">' + o.op + "</span>" + dot +
      '<span class="body-name">' + name + "</span></button>"
    );
  }

  function bdStepHtml(s, n) {
    var lost = s.out.some(function (o) {
      return o.lost;
    });
    var disp = bdPos(n);
    var cls = "step";
    if (n === bd.active) cls += " is-active";
    if (disp > bdPos(bd.active)) cls += " is-paused";
    if (lost) cls += " is-error";
    var chips = s.out.map(bdChip).join("");
    return (
      '<div class="' + cls + '" data-step="' + n + '" role="button" tabindex="0">' +
      (bdCanDrag(n)
        ? '<span class="step-grip" data-grip="1" aria-hidden="true"></span>'
        : "") +
      '<span class="step-head"><span class="step-index">' + bdPad(disp) +
      '</span><span class="step-sep">\u00b7</span>' +
      '<span class="step-kind">' + s.kind + "</span></span>" +
      '<span class="step-name">' + s.name + "</span>" +
      '<span class="step-meta">' + s.meta + "</span>" +
      (chips ? '<span class="step-bodies">' + chips + "</span>" : "") +
      "</div>"
    );
  }

  function bdGroupHtml(g) {
    var members = bdMembersInOrder(g);
    var activeIn = members.indexOf(bd.active) !== -1;
    var editing = bd.editing && bd.editing.kind === "group" && bd.editing.id === g.id;
    var name = editing
      ? '<input class="chip-input" data-rename="__group:' + g.id + '" value="' +
        g.name + '" aria-label="Group name">'
      : '<span class="group-name">' + g.name + "</span>";
    if (g.collapsed) {
      return (
        '<div class="step-group is-collapsed" data-group="' + g.id +
        '" role="button" tabindex="0" title="Expand group">' +
        '<span class="group-mark"></span>' +
        '<span class="collapsed-body">' + name +
        '<span class="group-meta">' + members.length + " steps</span></span>" +
        "</div>"
      );
    }
    var inner = "";
    members.forEach(function (n, idx) {
      inner += bdStepHtml(bdStep(n), n);
      if (idx < members.length - 1) inner += bdGapButton(n);
    });
    var collapseBtn = activeIn
      ? '<button class="group-btn" type="button" disabled ' +
        'title="the active step is inside this group \u2014 roll back first">\u2212</button>'
      : '<button class="group-btn" type="button" data-collapse="' + g.id +
        '" aria-label="Collapse group">\u2212</button>';
    return (
      '<div class="step-group" data-group="' + g.id + '">' +
      '<div class="group-head">' +
      collapseBtn +
      name +
      '<span class="group-meta">' + members.length + " steps</span>" +
      '<button class="group-btn" type="button" data-ungroup="' + g.id +
      '">ungroup</button>' +
      "</div>" +
      '<div class="group-steps">' + inner + "</div>" +
      "</div>"
    );
  }

  // a narrow, full-height column between two steps. Invisible until hovered so
  // the steps never move; the one after the active step is always shown, which
  // keeps it usable on touch. Clicking it selects the step before it.
  function bdGapButton(after) {
    var near = after === bd.active;
    return (
      '<button class="insert-gap' + (near ? " is-near" : "") +
      '" type="button" data-gap="' + after +
      '" aria-label="Insert a step after step ' + bdPos(after) + '"></button>'
    );
  }

  function bdRenderTimeline(stepsEl, detailEl) {
    var html = "";
    var i = 0;
    while (i < bd.order.length) {
      var n = bd.order[i];
      var g = bdGroupOf(n);
      if (g) {
        var members = bdMembersInOrder(g);
        html += bdGroupHtml(g);
        html += bdGapButton(members[members.length - 1]);
        i += g.ids.length;
        continue;
      }
      html += bdStepHtml(bdStep(n), n);
      html += bdGapButton(n);
      i++;
    }
    stepsEl.innerHTML = html;

    var cur = bdStep(bd.active);
    var curLost = cur.out.some(function (o) {
      return o.lost;
    });
    detailEl.innerHTML = curLost
      ? '<span class="detail-item"><span class="detail-key">lost</span>' +
        '<span class="detail-value">body \u201clid\u201d no longer exists</span></span>' +
        '<span class="detail-actions">' +
        '<button class="text-action" type="button">reselect body</button>' +
        '<button class="text-action is-quiet" type="button">open sketch</button></span>'
      : '<span class="timeline-note">autosaved locally</span>';
  }

  function bdRenderMenu(menuEl, timelineEl, stepsEl) {
    if (!bd.insertMenu) {
      menuEl.hidden = true;
      return;
    }
    menuEl.hidden = false;
    menuEl.innerHTML =
      '<div class="grid-menu-head">insert after step ' + bdPad(bdPos(bd.active)) + "</div>" +
      INSERT_TYPES.map(function (t) {
        return (
          '<button class="grid-option" type="button" data-insert-kind="' +
          t.kind + '"><span>' + t.name +
          '</span><span class="grid-option-note">' + t.note + "</span></button>"
        );
      }).join("");
    var gap = stepsEl.querySelector('[data-gap="' + bd.active + '"]');
    if (gap) {
      var gr = gap.getBoundingClientRect();
      var tr = timelineEl.getBoundingClientRect();
      var left = Math.max(0, gr.left + gr.width / 2 - 88);
      menuEl.style.left = Math.min(left, Math.max(0, tr.width - 184)) + "px";
    }
  }

  function bdFindOutput(id) {
    var steps = bdSteps();
    for (var i = 0; i < steps.length; i++) {
      for (var j = 0; j < steps[i].out.length; j++) {
        if (steps[i].out[j].id === id) {
          return { o: steps[i].out[j], step: bdPos(i + 1) };
        }
      }
    }
    for (var k = 0; k < bd.custom.length; k++) {
      var c = bd.custom[k];
      for (var m = 0; m < c.out.length; m++) {
        if (c.out[m].id === id) return { o: c.out[m], step: bdPos(c.num) };
      }
    }
    return null;
  }

  function bdRenderPanel(panel) {
    if (!bd.selected) {
      panel.hidden = true;
      return;
    }
    var sel = bd.selected;
    var title = bd.names[sel.id] || sel.label;
    var rows =
      '<div class="tool-row"><span class="tool-label">kind</span>' +
      '<span class="tool-note">' + sel.kind + "</span></div>" +
      '<div class="tool-row"><span class="tool-label">created by</span>' +
      '<span class="tool-note">step ' + bdPad(sel.step) + "</span></div>";
    if (sel.kind === "body") {
      rows +=
        '<div class="tool-row"><span class="tool-label">visibility</span>' +
        '<button class="toggle" type="button" aria-pressed="true">on</button></div>' +
        '<div class="tool-row"><span class="tool-label">appearance</span>' +
        '<span class="tool-note">warm grey</span></div>';
    }
    var actions =
      sel.kind === "body"
        ? [{ id: "isolate", label: "isolate", quiet: true }]
        : [
            {
              id: "open",
              label: sel.kind === "sketch" ? "open sketch" : "edit plane",
              quiet: true
            }
          ];
    panel.innerHTML =
      '<div class="tool-panel-head"><div>' +
      '<div class="tool-panel-kicker">' + sel.kind + "</div>" +
      '<h2 class="tool-panel-title">' + title + "</h2></div></div>" +
      '<div class="tool-panel-body">' + rows + "</div>" +
      '<div class="tool-hint">double-click the chip to rename it</div>' +
      ShowcaseUI.footer(sel.kind, actions);
    if (!panel.dataset.dragged) {
      panel.style.left = "auto";
      panel.style.top = "24px";
      panel.style.right = "24px";
    }
  }

  function bootBodies() {
    var layer = document.getElementById("bd-layer");
    var stepsEl = document.getElementById("bd-steps");
    var detailEl = document.getElementById("bd-detail");
    var foot = document.getElementById("bd-foot");
    var panel = document.getElementById("tool-panel");
    var whatif = document.getElementById("bd-whatif");
    var menuEl = document.getElementById("bd-insert-menu");
    var timelineEl = document.querySelector(".timeline");
    var iso = makeIso(560, 380, 2.6);
    ShowcaseUI.makeDraggable(panel, document.getElementById("viewport"));

    function render() {
      bdRenderStage(iso, layer);
      bdRenderTimeline(stepsEl, detailEl);
      bdRenderMenu(menuEl, timelineEl, stepsEl);
      bdRenderPanel(panel);
      var count = bd.connected || bdPos(bd.active) >= 8 ? 1 : 2;
      foot.innerHTML =
        "<b>" + count + (count === 1 ? " body" : " bodies") + "</b> \u00b7 step " +
        bdPos(bd.active) + " of " + bd.order.length +
        (bd.connected ? " \u00b7 what-if: profiles connected" : "");
      if (whatif) {
        whatif.textContent = bd.connected
          ? "separate the profiles"
          : "connect the profiles";
      }
    }

    function commitRename(inp) {
      var id = inp.getAttribute("data-rename");
      var v = inp.value.trim();
      if (v) {
        if (id.indexOf("__group:") === 0) {
          var g = bdGroup(id.slice(8));
          if (g) g.name = v;
        } else {
          bd.names[id] = v;
        }
      }
      bd.editing = null;
      render();
    }

    function startRename(kind, id) {
      bd.editing = { kind: kind, id: id };
      render();
      var inp = stepsEl.querySelector("[data-rename]");
      if (inp) {
        inp.focus();
        inp.select();
      }
    }

    function clearDrop() {
      Array.prototype.forEach.call(
        stepsEl.querySelectorAll(".is-drop"),
        function (el) {
          el.classList.remove("is-drop");
        }
      );
    }

    // pointer drag: only from the grip; drop a step onto another step to group
    stepsEl.addEventListener("pointerdown", function (e) {
      if (!e.target.closest("[data-grip]")) return;
      var step = e.target.closest("[data-step]");
      if (!step) return;
      bd.drag = {
        from: Number(step.getAttribute("data-step")),
        over: null,
        x: e.clientX,
        y: e.clientY,
        active: false,
        pid: e.pointerId
      };
    });

    stepsEl.addEventListener("pointermove", function (e) {
      if (!bd.drag) return;
      if (!bd.drag.active) {
        if (
          Math.abs(e.clientX - bd.drag.x) < 6 &&
          Math.abs(e.clientY - bd.drag.y) < 6
        ) {
          return;
        }
        bd.drag.active = true;
        bd.dragMoved = true;
        try {
          stepsEl.setPointerCapture(bd.drag.pid);
        } catch (err) {
          /* ignore */
        }
        stepsEl.classList.add("is-dragging");
      }
      clearDrop();
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var step = el && el.closest ? el.closest("[data-step]") : null;
      if (step) {
        step.classList.add("is-drop");
        bd.drag.over = Number(step.getAttribute("data-step"));
      } else {
        bd.drag.over = null;
      }
    });

    function endDrag() {
      if (!bd.drag) return;
      var d = bd.drag;
      bd.drag = null;
      stepsEl.classList.remove("is-dragging");
      clearDrop();
      if (d.active && d.over != null) {
        bdApplyDrag(d.from, d.over);
        render();
      }
      setTimeout(function () {
        bd.dragMoved = false;
      }, 0);
    }
    stepsEl.addEventListener("pointerup", endDrag);
    stepsEl.addEventListener("pointercancel", endDrag);

    stepsEl.addEventListener("click", function (e) {
      if (e.target.closest("[data-rename]")) return;
      if (bd.dragMoved) return;
      var gap = e.target.closest("[data-gap]");
      if (gap) {
        // select the step before the button, then open the insert menu
        bd.active = Number(gap.getAttribute("data-gap"));
        bd.selected = null;
        bd.insertMenu = true;
        render();
        return;
      }
      var collapse = e.target.closest("[data-collapse]");
      if (collapse) {
        var gc = bdGroup(collapse.getAttribute("data-collapse"));
        if (gc) gc.collapsed = true;
        render();
        return;
      }
      var ungroup = e.target.closest("[data-ungroup]");
      if (ungroup) {
        bd.groups = bd.groups.filter(function (x) {
          return x.id !== ungroup.getAttribute("data-ungroup");
        });
        render();
        return;
      }
      var chip = e.target.closest("[data-out]");
      if (chip) {
        var id = chip.getAttribute("data-out");
        if (bd.selected && bd.selected.id === id) return;
        var found = bdFindOutput(id);
        if (found) {
          bd.selected = {
            id: found.o.id,
            kind: found.o.kind,
            label: found.o.label,
            step: found.step
          };
        }
        render();
        return;
      }
      var step = e.target.closest("[data-step]");
      if (step) {
        bd.active = Number(step.getAttribute("data-step"));
        bd.selected = null;
        render();
        return;
      }
      // a group is not selectable; clicking a collapsed chip just expands it
      var grp = e.target.closest(".step-group");
      if (grp) {
        var g = bdGroup(grp.getAttribute("data-group"));
        if (g && g.collapsed) {
          g.collapsed = false;
          render();
        }
      }
    });

    stepsEl.addEventListener("dblclick", function (e) {
      var chip = e.target.closest("[data-out]");
      if (chip) {
        startRename("output", chip.getAttribute("data-out"));
        return;
      }
      var grp = e.target.closest("[data-group]");
      if (grp) startRename("group", grp.getAttribute("data-group"));
    });

    stepsEl.addEventListener("keydown", function (e) {
      var inp = e.target.closest("[data-rename]");
      if (!inp) return;
      if (e.key === "Enter") {
        e.preventDefault();
        commitRename(inp);
      } else if (e.key === "Escape") {
        bd.editing = null;
        render();
      }
    });

    stepsEl.addEventListener("focusout", function (e) {
      var inp = e.target.closest("[data-rename]");
      if (inp && bd.editing) commitRename(inp);
    });

    if (whatif) {
      whatif.addEventListener("click", function () {
        bd.connected = !bd.connected;
        bd.selected = null;
        render();
      });
    }
    if (menuEl) {
      menuEl.addEventListener("click", function (e) {
        var opt = e.target.closest("[data-insert-kind]");
        if (opt) {
          bdInsert(opt.getAttribute("data-insert-kind"));
          render();
        }
      });
    }
    document.addEventListener("click", function (e) {
      if (!bd.insertMenu) return;
      if (e.target.closest("#bd-insert-menu") || e.target.closest("[data-gap]")) return;
      bd.insertMenu = false;
      render();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && bd.insertMenu) {
        bd.insertMenu = false;
        render();
      }
    });

    render();
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

  var sec = { pos: 56, flip: false, msg: "" };
  var SEC_DEFAULTS = JSON.parse(JSON.stringify(sec));

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
      (sec.flip ? "keep +x" : "keep \u2212x") +
      (sec.msg ? " \u00b7 " + sec.msg : "");
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */

  function bootBodyOps() {
    var layer = document.getElementById("bo-layer");
    var panel = document.getElementById("tool-panel");
    ShowcaseUI.makeDraggable(panel, document.getElementById("viewport"));
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
      var act = e.target.closest("[data-action]");
      if (act) {
        if (act.getAttribute("data-action") === "cancel") {
          bo.params = JSON.parse(JSON.stringify(BO_DEFAULTS));
          bo.msg = "";
        } else {
          bo.msg = "applied";
        }
        render();
        return;
      }
      var listRow = e.target.closest("[data-list]");
      if (listRow) {
        var t = listRow.getAttribute("data-list");
        bo.params.split.tool = t;
        var def = SPLIT_TOOLS[t];
        if (def.plane) bo.params.split.offset = def.at;
        render();
        return;
      }
      var seg = e.target.closest(".seg button");
      if (seg) {
        var key = seg.closest(".seg").getAttribute("data-key");
        var val = seg.getAttribute("data-value");
        bo.params[bo.tool][key] = val;
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
        var key = inp.getAttribute("data-input");
        var v = Number(inp.value);
        if (key === "offset") v = Math.max(0, Math.min(110, v));
        bo.params[bo.tool][key] = v;
        boRender(iso, layer, foot);
      }
    });

    setTool("combine");
  }

  /* ------------------------------------------------------------------ */
  /* body transforms: move / copy + align                                */
  /* ------------------------------------------------------------------ */

  var TR_PLATE = { x0: 0, y0: 0, z0: 0, x1: 110, y1: 74, z1: 18 };
  var TR_BLOCK = { x0: 18, y0: 22, z0: 34, x1: 50, y1: 54, z1: 66 };

  var tr = {
    tool: "move",
    msg: "",
    params: {
      move: { dx: 34, dy: 22, dz: 0, rot: 0, copy: true },
      align: { ax: "centre", ay: "centre", az: "ontop" }
    }
  };
  var TR_DEFAULTS = JSON.parse(JSON.stringify(tr.params));

  function alignAxis(bmin, bmax, rmin, rmax, mode) {
    if (mode === "min") return rmin;
    if (mode === "max") return rmax;
    if (mode === "centre") return (rmin + rmax) / 2 - (bmax - bmin) / 2;
    if (mode === "ontop") return rmax;
    if (mode === "below") return rmin - (bmax - bmin);
    return bmin;
  }

  function alignedBox(b, ref, p) {
    var w = b.x1 - b.x0,
      d = b.y1 - b.y0,
      h = b.z1 - b.z0;
    var x0 = alignAxis(b.x0, b.x1, ref.x0, ref.x1, p.ax);
    var y0 = alignAxis(b.y0, b.y1, ref.y0, ref.y1, p.ay);
    var z0 = alignAxis(b.z0, b.z1, ref.z0, ref.z1, p.az);
    return { x0: x0, y0: y0, z0: z0, x1: x0 + w, y1: y0 + d, z1: z0 + h };
  }

  function movedCorners(b, p) {
    var cx = (b.x0 + b.x1) / 2,
      cy = (b.y0 + b.y1) / 2;
    var a = ((p.rot || 0) * Math.PI) / 180;
    var ca = Math.cos(a),
      sa = Math.sin(a);
    return boxCorners(b).map(function (q) {
      var dx = q[0] - cx,
        dy = q[1] - cy;
      return [
        cx + dx * ca - dy * sa + p.dx,
        cy + dx * sa + dy * ca + p.dy,
        q[2] + p.dz
      ];
    });
  }

  function trSpec(tool) {
    if (tool === "move") {
      return {
        kicker: "body transform",
        title: "move / copy",
        rows: [
          { type: "input", key: "dx", label: "x", unit: "mm" },
          { type: "input", key: "dy", label: "y", unit: "mm" },
          { type: "input", key: "dz", label: "z", unit: "mm" },
          { type: "input", key: "rot", label: "rotate Z", unit: "deg" },
          { type: "toggle", key: "copy", label: "create copy" },
          { type: "static", label: "body", value: "block" }
        ],
        hint: "move or duplicate a body without redrawing it",
        summary: function (p) {
          return (
            (p.copy ? "copy" : "move") + " \u00b7 " +
            fmt1(p.dx) + ", " + fmt1(p.dy) + ", " + fmt1(p.dz) + " mm" +
            (p.rot ? " \u00b7 " + fmt1(p.rot) + "\u00b0" : "")
          );
        }
      };
    }
    return {
      kicker: "body transform",
      title: "align",
      rows: [
        { type: "seg", key: "ax", label: "X", options: [["none", "none"], ["min", "left"], ["centre", "centre"], ["max", "right"]] },
        { type: "seg", key: "ay", label: "Y", options: [["none", "none"], ["min", "front"], ["centre", "centre"], ["max", "back"]] },
        { type: "seg", key: "az", label: "Z", options: [["none", "none"], ["below", "below"], ["centre", "centre"], ["ontop", "on top"]] },
        { type: "static", label: "reference", value: "plate" }
      ],
      hint: "snap the block to the plate on each axis",
      summary: function (p) {
        return "X " + p.ax + " \u00b7 Y " + p.ay + " \u00b7 Z " + p.az;
      }
    };
  }

  function trRender(iso, layer, footEl) {
    var tool = tr.tool;
    var p = tr.params[tool];
    var html = "";
    if (tool === "move") {
      var moved = movedCorners(TR_BLOCK, p);
      html += drawBox(iso, TR_PLATE, null, false);
      if (p.copy) {
        html += drawBoxCorners(iso, boxCorners(TR_BLOCK), null, false);
        html += drawBoxCorners(iso, moved, "bo-result", false);
      } else {
        html += drawBoxCorners(iso, boxCorners(TR_BLOCK), null, true);
        html += drawBoxCorners(iso, moved, "bo-result", false);
      }
    } else {
      var aligned = alignedBox(TR_BLOCK, TR_PLATE, p);
      html += drawBox(iso, TR_PLATE, null, false);
      html += drawBoxCorners(iso, boxCorners(TR_BLOCK), null, true);
      html += drawBoxCorners(iso, boxCorners(aligned), "bo-result", false);
      // a guide from the block's centre to where it lands
      var from = [
        (TR_BLOCK.x0 + TR_BLOCK.x1) / 2,
        (TR_BLOCK.y0 + TR_BLOCK.y1) / 2,
        TR_BLOCK.z0
      ];
      var to = [
        (aligned.x0 + aligned.x1) / 2,
        (aligned.y0 + aligned.y1) / 2,
        aligned.z0
      ];
      var f = iso.p(from[0], from[1], from[2]);
      var t = iso.p(to[0], to[1], to[2]);
      html +=
        '<line x1="' + f[0].toFixed(1) + '" y1="' + f[1].toFixed(1) +
        '" x2="' + t[0].toFixed(1) + '" y2="' + t[1].toFixed(1) +
        '" class="bo-ghost"/>';
    }
    layer.innerHTML = html;
    footEl.innerHTML =
      "<b>" + (tool === "move" ? "move / copy" : "align") + "</b> \u00b7 " +
      trSpec(tool).summary(p) + (tr.msg ? " \u00b7 " + tr.msg : "");
  }

  function bootTransform() {
    var layer = document.getElementById("tr-layer");
    var panel = document.getElementById("tool-panel");
    ShowcaseUI.makeDraggable(panel, document.getElementById("viewport"));
    var foot = document.getElementById("tr-foot");
    var iso = makeIso(540, 400, 2.6);

    function render() {
      trRender(iso, layer, foot);
      panel.innerHTML = panelHtml(trSpec(tr.tool), tr.params[tr.tool]);
      layoutPanel(panel);
    }

    function setTool(tool) {
      tr.tool = tool;
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
      var act = e.target.closest("[data-action]");
      if (act) {
        if (act.getAttribute("data-action") === "cancel") {
          tr.params = JSON.parse(JSON.stringify(TR_DEFAULTS));
          tr.msg = "";
        } else {
          tr.msg = "applied";
        }
        render();
        return;
      }
      var seg = e.target.closest(".seg button");
      if (seg) {
        tr.params[tr.tool][seg.closest(".seg").getAttribute("data-key")] = seg.getAttribute("data-value");
        render();
        return;
      }
      var tog = e.target.closest(".toggle");
      if (tog) {
        var k = tog.getAttribute("data-key");
        tr.params[tr.tool][k] = !tr.params[tr.tool][k];
        render();
      }
    });
    panel.addEventListener("input", function (e) {
      var inp = e.target.closest("[data-input]");
      if (inp) {
        tr.params[tr.tool][inp.getAttribute("data-input")] = Number(inp.value) || 0;
        trRender(iso, layer, foot);
      }
    });

    setTool("move");
  }

  /* ------------------------------------------------------------------ */
  /* extrude options                                                     */
  /* ------------------------------------------------------------------ */

  var EX_PROFILE = { x0: 34, y0: 22, x1: 74, y1: 50 };
  var EX_TARGET = { x0: 24, y0: 12, x1: 84, y1: 60, z0: 40, z1: 58 };

  var ex = {
    start: "plane",
    startOffset: 14,
    end: "object",
    distance: 30,
    taper: 0,
    op: "join",
    msg: ""
  };
  var EX_DEFAULTS = JSON.parse(JSON.stringify(ex));

  function exExtents(p) {
    var z0 = p.start === "offset" ? p.startOffset : 0;
    var z1;
    if (p.end === "blind") z1 = z0 + p.distance;
    else if (p.end === "all") z1 = EX_TARGET.z1 + 12;
    else z1 = EX_TARGET.z0;
    if (z1 <= z0 + 0.5) z1 = z0 + 0.5;
    return [z0, z1];
  }

  function exCorners(p) {
    var e = exExtents(p);
    var h = e[1] - e[0];
    var b = EX_PROFILE;
    var w = b.x1 - b.x0,
      d = b.y1 - b.y0;
    var inset = h * Math.tan(((p.taper || 0) * Math.PI) / 180);
    var lim = Math.min(w, d) / 2 - 1;
    inset = Math.max(-lim, Math.min(lim, inset));
    return [
      [b.x0, b.y0, e[0]],
      [b.x1, b.y0, e[0]],
      [b.x1, b.y1, e[0]],
      [b.x0, b.y1, e[0]],
      [b.x0 + inset, b.y0 + inset, e[1]],
      [b.x1 - inset, b.y0 + inset, e[1]],
      [b.x1 - inset, b.y1 - inset, e[1]],
      [b.x0 + inset, b.y1 - inset, e[1]]
    ];
  }

  function profileQuad(iso, b, z, cls) {
    return poly(
      pts3(iso, [
        [b.x0, b.y0, z],
        [b.x1, b.y0, z],
        [b.x1, b.y1, z],
        [b.x0, b.y1, z]
      ]),
      cls
    );
  }

  var EX_SPEC = {
    kicker: "sketch feature",
    title: "extrude",
    rows: [
      { type: "seg", key: "start", label: "start", options: [["plane", "profile"], ["offset", "offset"]] },
      { type: "input", key: "startOffset", label: "start offset", unit: "mm", when: function (p) { return p.start === "offset"; } },
      { type: "seg", key: "end", label: "end", options: [["blind", "blind"], ["object", "to object"], ["next", "to next"], ["all", "all"]] },
      { type: "input", key: "distance", label: "distance", unit: "mm", when: function (p) { return p.end === "blind"; } },
      { type: "input", key: "taper", label: "taper", unit: "deg" },
      { type: "seg", key: "op", label: "operation", options: [["new", "new"], ["join", "join"], ["cut", "cut"], ["intersect", "intersect"]] },
      { type: "static", label: "target", value: "block", when: function (p) { return p.op !== "new"; } }
    ],
    hint: "start offset and to-object are the two that are used most",
    summary: function (p) {
      var s = p.start === "offset" ? "offset " + fmt1(p.startOffset) : "from profile";
      var e =
        p.end === "blind"
          ? "blind " + fmt1(p.distance)
          : p.end === "object"
            ? "to object"
            : p.end === "next"
              ? "to next"
              : "all";
      var t = p.taper ? " \u00b7 taper " + fmt1(p.taper) + "\u00b0" : "";
      return s + " \u00b7 " + e + t + " \u00b7 " + p.op;
    }
  };

  function exRender(iso, layer, footEl) {
    var p = ex;
    var e = exExtents(p);
    var html = "";
    // the sketch profile, and the start position when offset
    html += profileQuad(iso, EX_PROFILE, 0, "bo-profile");
    if (p.start === "offset") {
      html += profileQuad(iso, EX_PROFILE, p.startOffset, "bo-profile-ghost");
    }
    if (p.op !== "new") {
      html += drawBox(iso, EX_TARGET, null, p.op === "intersect");
    }
    var solid = drawBoxCorners(iso, exCorners(p), "bo-result", false);
    if (p.op === "cut") {
      // the extruded solid is the cutter
      html += drawBoxCorners(iso, exCorners(p), null, true);
    } else {
      html += solid;
    }
    layer.innerHTML = html;
    footEl.innerHTML = "<b>extrude</b> \u00b7 " + EX_SPEC.summary(p) +
      (ex.msg ? " \u00b7 " + ex.msg : "");
  }

  function bootExtrude() {
    var layer = document.getElementById("ex-layer");
    var panel = document.getElementById("tool-panel");
    ShowcaseUI.makeDraggable(panel, document.getElementById("viewport"));
    var foot = document.getElementById("ex-foot");
    var iso = makeIso(540, 380, 2.6);

    function render() {
      exRender(iso, layer, foot);
      panel.innerHTML = panelHtml(EX_SPEC, ex);
      layoutPanel(panel);
    }

    panel.addEventListener("click", function (e) {
      var act = e.target.closest("[data-action]");
      if (act) {
        if (act.getAttribute("data-action") === "cancel") {
          Object.keys(ex).forEach(function (k) { delete ex[k]; });
          Object.keys(EX_DEFAULTS).forEach(function (k) { ex[k] = EX_DEFAULTS[k]; });
          ex.msg = "";
        } else {
          ex.msg = "applied";
        }
        render();
        return;
      }
      var seg = e.target.closest(".seg button");
      if (seg) {
        ex[seg.closest(".seg").getAttribute("data-key")] = seg.getAttribute("data-value");
        render();
      }
    });
    panel.addEventListener("input", function (e) {
      var inp = e.target.closest("[data-input]");
      if (inp) {
        ex[inp.getAttribute("data-input")] = Number(inp.value) || 0;
        exRender(iso, layer, foot);
      }
    });

    render();
  }

  function bootSection() {
    var layer = document.getElementById("sec-layer");
    var panel = document.getElementById("tool-panel");
    ShowcaseUI.makeDraggable(panel, document.getElementById("viewport"));
    var meta = document.getElementById("sec-meta");
    var iso = makeIso(540, 400, 2.6);
    var spec = {
      kicker: "inspect",
      title: "section analysis",
      primary: "done",
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
      var act = e.target.closest("[data-action]");
      if (act) {
        if (act.getAttribute("data-action") === "cancel") {
          sec.pos = SEC_DEFAULTS.pos;
          sec.flip = SEC_DEFAULTS.flip;
          sec.msg = "";
        } else {
          sec.msg = "done";
        }
        render();
        return;
      }
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
    if (document.getElementById("tr-layer")) bootTransform();
    if (document.getElementById("ex-layer")) bootExtrude();
    if (document.getElementById("bd-layer")) bootBodies();
    if (document.getElementById("sec-layer")) bootSection();
    if (window.M && window.M.hydrateIcons) window.M.hydrateIcons(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
