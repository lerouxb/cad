/*
 * Sketch constraints and measurements: the visual atlas.
 * Design target only — not imported by src/. See CONSTRAINTS.md.
 */
(function () {
  "use strict";

  var OX = 130;
  var OY = 96;
  var S = 1.7;
  var NS = "http://www.w3.org/2000/svg";

  function f(n) {
    return Math.round(n * 100) / 100;
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function X(x) {
    return OX + x * S;
  }

  function Y(y) {
    return OY - y * S;
  }

  function line(x1, y1, x2, y2, cls, extra) {
    return (
      '<line x1="' + f(x1) + '" y1="' + f(y1) +
      '" x2="' + f(x2) + '" y2="' + f(y2) +
      '" class="' + (cls || "") + '"' + (extra ? " " + extra : "") + "/>"
    );
  }

  function circle(cx, cy, r, cls, extra) {
    return (
      '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r) +
      '" class="' + (cls || "sketch-line") + '"' + (extra ? " " + extra : "") + "/>"
    );
  }

  function path(d, cls, extra) {
    return (
      '<path d="' + d + '" class="' + (cls || "") + '"' +
      (extra ? " " + extra : "") + "/>"
    );
  }

  function text(x, y, value, cls, anchor) {
    return (
      '<text x="' + f(x) + '" y="' + f(y) + '" class="' + (cls || "") +
      '" text-anchor="' + (anchor || "middle") + '">' + esc(value) + "</text>"
    );
  }

  function L(a, b, cls, extra) {
    return line(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]), cls || "sketch-line", extra);
  }

  function P(p, cls) {
    return circle(X(p[0]), Y(p[1]), 3.2, cls || "sketch-point");
  }

  function at(a, b, t, dx, dy) {
    return [
      X(a[0]) + (X(b[0]) - X(a[0])) * t + (dx || 0),
      Y(a[1]) + (Y(b[1]) - Y(a[1])) * t + (dy || 0),
    ];
  }

  function badge(x, y, label, cls) {
    var w = 7 + String(label).length * 5.2;
    return (
      '<g class="con-badge ' + (cls || "") + '">' +
      '<rect class="con-badge-box" x="' + f(x - w / 2) + '" y="' + f(y - 6) +
      '" width="' + f(w) + '" height="12" rx="2"/>' +
      '<rect class="con-badge-underline" x="' + f(x - w / 2) + '" y="' + f(y + 6.5) +
      '" width="' + f(w) + '" height="1.6" rx="0.8"/>' +
      text(x, y + 3, label, "con-badge-text") +
      "</g>"
    );
  }

  function badgeOn(a, b, t, label, dx, dy, cls) {
    var p = at(a, b, t, dx, dy);
    return badge(p[0], p[1], label, cls);
  }

  function nameLabel(x, y, label, cls) {
    return text(x, y, label, "con-name" + (cls ? " " + cls : ""));
  }

  function ring(x, y, r, cls) {
    return circle(x, y, r || 5.4, cls || "con-mark");
  }

  function tick(a, b, t, count, cls) {
    var ax = X(a[0]);
    var ay = Y(a[1]);
    var bx = X(b[0]);
    var by = Y(b[1]);
    var dx = bx - ax;
    var dy = by - ay;
    var len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len;
    var ny = dx / len;
    var cx = ax + dx * t;
    var cy = ay + dy * t;
    var html = "";
    for (var i = 0; i < (count || 1); i++) {
      var off = (i - ((count || 1) - 1) / 2) * 3.6;
      html += line(
        cx + (dx / len) * off - nx * 4,
        cy + (dy / len) * off - ny * 4,
        cx + (dx / len) * off + nx * 4,
        cy + (dy / len) * off + ny * 4,
        cls || "con-mark",
      );
    }
    return html;
  }

  function radialTick(cx, cy, r, angleDeg, count, cls) {
    var a = (angleDeg * Math.PI) / 180;
    var ux = Math.cos(a);
    var uy = Math.sin(a);
    var tx = -uy;
    var ty = ux;
    var html = "";
    for (var i = 0; i < (count || 1); i++) {
      var off = (i - ((count || 1) - 1) / 2) * 3.6;
      html += line(
        cx + ux * (r - 4) + tx * off,
        cy + uy * (r - 4) + ty * off,
        cx + ux * (r + 4) + tx * off,
        cy + uy * (r + 4) + ty * off,
        cls || "con-mark",
      );
    }
    return html;
  }

  function chevron(x, y, deg, cls) {
    var a = (deg * Math.PI) / 180;
    var ux = Math.cos(a);
    var uy = Math.sin(a);
    var nx = -uy;
    var ny = ux;
    var bx = x - ux * 4;
    var by = y - uy * 4;
    return (
      line(bx + nx * 3, by + ny * 3, x, y, cls || "con-mark") +
      line(bx - nx * 3, by - ny * 3, x, y, cls || "con-mark")
    );
  }

  function diamond(x, y, r, cls) {
    return path(
      "M " + f(x) + " " + f(y - r) +
      " L " + f(x + r) + " " + f(y) +
      " L " + f(x) + " " + f(y + r) +
      " L " + f(x - r) + " " + f(y) + " Z",
      cls || "con-mark",
    );
  }

  function pin(x, y, cls) {
    return (
      '<g class="' + (cls || "con-mark") + '">' +
      '<rect x="' + f(x - 3.4) + '" y="' + f(y - 1) +
      '" width="6.8" height="5.2" rx="1"/>' +
      '<path d="M ' + f(x - 2) + " " + f(y - 1) +
      " V " + f(y - 3.4) + " A 2 2 0 0 1 " + f(x + 2) + " " + f(y - 3.4) +
      " V " + f(y - 1) + '"/>' +
      "</g>"
    );
  }

  function halfDot(x, y, cls) {
    return (
      circle(x, y, 3.4, "sketch-point") +
      halfFill(x, y, cls)
    );
  }

  function halfFill(x, y, cls) {
    return path(
      "M " + f(x) + " " + f(y - 3.4) +
      " A 3.4 3.4 0 0 1 " + f(x) + " " + f(y + 3.4) + " Z",
      "con-fill " + (cls || ""),
    );
  }

  function filledDot(x, y, cls) {
    return circle(x, y, 3, "con-fill " + (cls || ""));
  }

  function axis(a, b) {
    return L(a, b, "con-axis");
  }

  function connector(a, b, cls) {
    return line(a[0], a[1], b[0], b[1], cls || "con-connector");
  }

  function connectorMM(a, b, cls) {
    return L(a, b, cls || "con-connector");
  }

  function wash(a, b) {
    return L(a, b, "con-wash");
  }

  function slash(x, y, angle, size, cls) {
    var dx = Math.cos(angle) * size;
    var dy = Math.sin(angle) * size;
    return line(x - dx, y - dy, x + dx, y + dy, cls || "dim-line");
  }

  function arrow(x, y, deg, size) {
    return chevron(x, y, deg, "dim-line");
  }

  function dimLinear(a, b, offset, label, opts) {
    opts = opts || {};
    var A = [X(a[0]), Y(a[1])];
    var B = [X(b[0]), Y(b[1])];
    var dx = B[0] - A[0];
    var dy = B[1] - A[1];
    var len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len;
    var ny = dx / len;
    var C = [A[0] + nx * offset, A[1] + ny * offset];
    var D = [B[0] + nx * offset, B[1] + ny * offset];
    var t = opts.along == null ? 0.5 : opts.along;
    var m = [C[0] + (D[0] - C[0]) * t, C[1] + (D[1] - C[1]) * t];
    var html = "";

    html += line(A[0] + nx * 1.5, A[1] + ny * 1.5, C[0] + nx * 3, C[1] + ny * 3, "dim-ext");
    html += line(B[0] + nx * 1.5, B[1] + ny * 1.5, D[0] + nx * 3, D[1] + ny * 3, "dim-ext");
    html += line(C[0], C[1], D[0], D[1], "dim-line");

    var slashAngle = Math.atan2(D[1] - C[1], D[0] - C[0]) + Math.PI / 4;
    html += slash(C[0], C[1], slashAngle, 3.4);
    html += slash(D[0], D[1], slashAngle, 3.4);

    var lx;
    var ly;
    var anchor = "middle";
    if (opts.labelN != null) {
      lx = m[0] + nx * opts.labelN;
      ly = m[1] + ny * opts.labelN;
      anchor = opts.anchor || "middle";
    } else {
      lx = m[0];
      ly = m[1] - 7;
    }
    html += text(lx, ly + 3, label, "dim-text" + (opts.ref ? " is-ref" : ""), anchor);
    return html;
  }

  function dimAngle(vertex, dirA, dirB, r, label) {
    var vx = X(vertex[0]);
    var vy = Y(vertex[1]);
    var a0 = Math.atan2(-dirA[1], dirA[0]);
    var a1 = Math.atan2(-dirB[1], dirB[0]);
    var sweep = a1 - a0;
    while (sweep <= -Math.PI) sweep += Math.PI * 2;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    var end = a0 + sweep;
    var Sx = vx + Math.cos(a0) * r;
    var Sy = vy + Math.sin(a0) * r;
    var Ex = vx + Math.cos(end) * r;
    var Ey = vy + Math.sin(end) * r;
    var mid = a0 + sweep / 2;
    var Lx = vx + Math.cos(mid) * (r + 14);
    var Ly = vy + Math.sin(mid) * (r + 14);
    var html = "";

    html += line(vx, vy, Sx, Sy, "dim-ext");
    html += line(vx, vy, Ex, Ey, "dim-ext");
    html += path(
      "M " + f(Sx) + " " + f(Sy) + " A " + f(r) + " " + f(r) +
      " 0 " + (Math.abs(sweep) > Math.PI ? 1 : 0) + " " + (sweep > 0 ? 1 : 0) +
      " " + f(Ex) + " " + f(Ey),
      "dim-line",
    );

    var tan0 = a0 + (sweep > 0 ? Math.PI / 2 : -Math.PI / 2);
    var tan1 = end + (sweep > 0 ? Math.PI / 2 : -Math.PI / 2);
    html += arrow(Sx, Sy, (tan0 * 180) / Math.PI);
    html += arrow(Ex, Ey, (tan1 * 180) / Math.PI + 180);
    html += text(Lx, Ly + 3, label, "dim-text");
    return html;
  }

  function dimRadial(center, radiusMm, angleDeg, label, opts) {
    opts = opts || {};
    var cx = X(center[0]);
    var cy = Y(center[1]);
    var r = radiusMm * S;
    var a = (-angleDeg * Math.PI) / 180;
    var ux = Math.cos(a);
    var uy = Math.sin(a);
    var html = "";

    if (opts.diameter) {
      var P1 = [cx - ux * r, cy - uy * r];
      var P2 = [cx + ux * r, cy + uy * r];
      html += line(P1[0], P1[1], P2[0], P2[1], "dim-line");
      html += arrow(P1[0], P1[1], (a + Math.PI) * (180 / Math.PI));
      html += arrow(P2[0], P2[1], a * (180 / Math.PI));
      html += text(cx, cy - 12, label, "dim-text");
      return html;
    }

    var tip = [cx + ux * r, cy + uy * r];
    var end = [cx + ux * (r + 22), cy + uy * (r + 22)];
    html += line(cx - 4, cy, cx + 4, cy, "con-cross");
    html += line(cx, cy - 4, cx, cy + 4, "con-cross");
    html += line(cx, cy, tip[0], tip[1], "dim-line");
    html += line(tip[0], tip[1], end[0], end[1], "dim-line");
    html += arrow(tip[0], tip[1], a * (180 / Math.PI));
    html += text(end[0] + (ux > 0 ? 4 : -4), end[1] + 3, label, "dim-text", ux > 0 ? "start" : "end");
    return html;
  }

  function card(title, note, svg, opts) {
    opts = opts || {};
    var cls = "con-card";
    if (opts.wide) cls += " is-wide";
    if (opts.mods) cls += " " + opts.mods;
    var chip = opts.chip
      ? '<div class="con-chip-row">' + opts.chip + "</div>"
      : "";
    return (
      '<figure class="' + cls + '"' + (opts.toggle ? ' data-toggle="1"' : "") + ">" +
      '<svg viewBox="0 0 260 170" role="img" aria-label="' +
      esc(title + ": " + note) + '">' + svg + "</svg>" +
      '<figcaption><span class="con-title">' + esc(title) +
      '</span><span class="con-note">' + esc(note) + "</span></figcaption>" +
      chip +
      "</figure>"
    );
  }

  /* --------------------------------------------------------------------- */
  /* constraints                                                            */
  /* --------------------------------------------------------------------- */

  function horizontal() {
    var a = [-32, 0];
    var b = [32, 0];
    return L(a, b) + badge(X(0), Y(0), "H");
  }

  function vertical() {
    var a = [0, -26];
    var b = [0, 26];
    return L(a, b) + badge(X(0), Y(0), "V");
  }

  function parallel() {
    var l1 = [[-32, -16], [8, 16]];
    var l2 = [[-8, -16], [32, 16]];
    var p1 = at(l1[0], l1[1], 0.7, -11, 0);
    var p2 = at(l2[0], l2[1], 0.7, 11, 0);
    var m1 = at(l1[0], l1[1], 0.5);
    var m2 = at(l2[0], l2[1], 0.5);
    return (
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      connector(m1, m2, "con-connector") +
      badge(p1[0], p1[1], "∥") +
      badge(p2[0], p2[1], "∥")
    );
  }

  function perpendicular() {
    var v = [[-12, -28], [-12, 24]];
    var h = [[-34, 0], [34, 0]];
    var x = X(-12);
    var y = Y(0);
    return (
      L(v[0], v[1]) + L(h[0], h[1]) +
      path("M " + f(x + 8) + " " + f(y) + " L " + f(x + 8) + " " + f(y - 8) +
        " L " + f(x) + " " + f(y - 8), "con-mark")
    );
  }

  function perpendicularNoTouch() {
    var l1 = [[-32, -18], [-2, 18]];
    var l2 = [[8, -18], [34, 18]];
    var p1 = at(l1[0], l1[1], 0.55, -10, 0);
    var p2 = at(l2[0], l2[1], 0.55, 10, 0);
    return (
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      connector(at(l1[0], l1[1], 0.55), at(l2[0], l2[1], 0.55), "con-connector") +
      badge(p1[0], p1[1], "⊥" + "") +
      badge(p2[0], p2[1], "⊥")
    );
  }

  function collinear() {
    var a = [[-34, -5], [-8, -5]];
    var b = [[8, -5], [34, -5]];
    return (
      L(a[0], a[1]) + L(b[0], b[1]) +
      connectorMM([-8, -5], [8, -5]) +
      badge(X(0), Y(-5) - 9, "≡")
    );
  }

  function equalOne() {
    var l1 = [[-30, -14], [-2, 14]];
    var l2 = [[2, -14], [30, 14]];
    return (
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      tick(l1[0], l1[1], 0.32, 1) +
      tick(l2[0], l2[1], 0.32, 1)
    );
  }

  function equalTwo() {
    var top = [[-32, 14], [-4, 14]];
    var top2 = [[4, 14], [32, 14]];
    var bot = [[-32, -10], [-4, -10]];
    var bot2 = [[4, -10], [32, -10]];
    return (
      L(top[0], top[1]) + L(top2[0], top2[1]) +
      L(bot[0], bot[1]) + L(bot2[0], bot2[1]) +
      tick(top[0], top[1], 0.35, 1) +
      tick(top2[0], top2[1], 0.35, 1) +
      tick(bot[0], bot[1], 0.35, 2) +
      tick(bot2[0], bot2[1], 0.35, 2)
    );
  }

  function equalRadii() {
    var c1 = [-18, 0];
    var c2 = [18, 0];
    var r = 16;
    return (
      circle(X(c1[0]), Y(c1[1]), r * S) +
      circle(X(c2[0]), Y(c2[1]), r * S) +
      radialTick(X(c1[0]), Y(c1[1]), r * S, -90, 1) +
      radialTick(X(c2[0]), Y(c2[1]), r * S, -90, 1)
    );
  }

  function pointOnLine() {
    var a = [-34, -2];
    var b = [34, -2];
    var p = [8, -2];
    var x = X(p[0]);
    var y = Y(p[1]);
    return (
      L(a, b) + P(p) +
      ring(x, y) +
      line(x, y - 7, x, y + 7, "con-mark")
    );
  }

  function pointOnCircle() {
    var r = 30;
    var deg = 35;
    var p = [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
    var x = X(p[0]);
    var y = Y(p[1]);
    return (
      circle(X(0), Y(0), r * S) + P(p) +
      ring(x, y) +
      radialTick(X(0), Y(0), r * S, -deg, 1)
    );
  }

  function tangent() {
    var r = 22;
    var cx = X(0);
    var cy = Y(0);
    var top = Y(r);
    return (
      circle(cx, cy, r * S) +
      line(X(-34), top, X(34), top, "sketch-line") +
      diamond(cx, top, 4.2) +
      line(cx - 6, top - 6, cx + 6, top - 6, "con-mark")
    );
  }

  function midpoint() {
    var a = [-34, 0];
    var b = [34, 0];
    var x = X(0);
    var y = Y(0);
    return (
      L(a, b) +
      line(x, y - 6, x, y + 6, "con-mark") +
      halfDot(x, y)
    );
  }

  function coincident() {
    var a = [-30, 10];
    var b = [0, 10];
    var c = [30, -10];
    var x = X(0);
    var y = Y(10);
    return (
      L(a, b) + L(b, c) +
      ring(x, y, 6) +
      filledDot(x, y)
    );
  }

  function fix() {
    var x = X(0);
    var y = Y(0);
    return (
      L([-30, 0], [30, 0]) +
      P([0, 0]) +
      line(x, y - 1, x, y - 10, "con-mark") +
      pin(x, y - 13)
    );
  }

  function symmetricSmall() {
    var p1 = [-20, 0];
    var p2 = [20, 0];
    var A1 = [0, -36];
    var A2 = [0, 36];
    return (
      axis(A1, A2) +
      connectorMM(p1, p2) +
      P(p1) + P(p2) +
      chevron(X(-6), Y(0), 0) +
      chevron(X(6), Y(0), 180)
    );
  }

  /* --------------------------------------------------------------------- */
  /* measurements                                                           */
  /* --------------------------------------------------------------------- */

  function dimHorizontal() {
    return L([-30, 0], [30, 0]) + dimLinear([-30, 0], [30, 0], 30, "60.0");
  }

  function dimVertical() {
    return (
      L([0, -25], [0, 25]) +
      dimLinear([0, -25], [0, 25], -30, "50.0", { labelN: -8, anchor: "end" })
    );
  }

  function dimAligned() {
    return (
      L([-30, -15], [20, 20]) +
      dimLinear([-30, -15], [20, 20], 26, "46.1")
    );
  }

  function dimPointLine() {
    var a = [5, 20];
    var b = [5, -10];
    var x = X(5);
    var y = Y(-10);
    return (
      L([-30, -10], [30, -10]) + P(a) +
      dimLinear(a, b, 26, "30.0", { labelN: 8, anchor: "start" }) +
      path("M " + f(x) + " " + f(y) + " L " + f(x - 7) + " " + f(y) +
        " L " + f(x - 7) + " " + f(y - 7), "con-mark")
    );
  }

  function dimAngleCard() {
    return (
      L([0, 0], [35, 0]) +
      L([0, 0], [25, 25]) +
      dimAngle([0, 0], [35, 0], [25, 25], 40, "45.0°")
    );
  }

  function dimRadius() {
    return (
      circle(X(0), Y(0), 24 * S) +
      dimRadial([0, 0], 24, 35, "R 24.0")
    );
  }

  function dimDiameter() {
    return (
      circle(X(0), Y(0), 24 * S) +
      dimRadial([0, 0], 24, 0, "Ø 48.0", { diameter: true })
    );
  }

  function dimReference() {
    var a = [-30, -15];
    var b = [30, -15];
    var c = [30, 20];
    return (
      L(a, b) + L(b, c) + L(a, c) +
      dimLinear(a, b, 28, "60.0") +
      dimLinear(a, c, 24, "(67.1)", { ref: true })
    );
  }

  function dimEditing() {
    return (
      L([-30, 0], [30, 0]) +
      dimLinear([-30, 0], [30, 0], 30, "") +
      '<foreignObject x="22" y="118" width="216" height="34">' +
      '<div xmlns="http://www.w3.org/1999/xhtml" class="dim-editor is-selected" data-kind="driving">' +
      '<span class="dim-field"><input type="text" value="56.25" aria-label="Dimension value"/>' +
      '<span class="dim-unit">mm</span></span>' +
      '<span class="seg dim-kind" role="group" aria-label="Dimension kind">' +
      '<button type="button" class="is-selected" aria-pressed="true">driving</button>' +
      '<button type="button" aria-pressed="false">reference</button>' +
      "</span></div></foreignObject>"
    );
  }

  /* --------------------------------------------------------------------- */
  /* symmetric, in any direction                                            */
  /* --------------------------------------------------------------------- */

  function symmetricVerticalPoints() {
    var p1 = [-20, 0];
    var p2 = [20, 0];
    return (
      axis([0, -38], [0, 38]) +
      connectorMM(p1, p2) +
      P(p1) + P(p2) +
      chevron(X(-6), Y(0), 0) +
      chevron(X(6), Y(0), 180) +
      nameLabel(X(0), Y(12), "symmetric")
    );
  }

  function symmetricHorizontalPoints() {
    var p1 = [0, 20];
    var p2 = [0, -20];
    return (
      axis([-38, 0], [38, 0]) +
      connectorMM(p1, p2) +
      P(p1) + P(p2) +
      chevron(X(0), Y(6), 90) +
      chevron(X(0), Y(-6), 270) +
      nameLabel(X(18), Y(8), "symmetric")
    );
  }

  function symmetricVerticalLines() {
    var l1 = [[-30, -20], [-10, 16]];
    var l2 = [[30, -20], [10, 16]];
    var m1 = at(l1[0], l1[1], 0.5);
    var m2 = at(l2[0], l2[1], 0.5);
    return (
      axis([0, -38], [0, 38]) +
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      connector(m1, m2) +
      chevron(X(-6), m1[1], 0) +
      chevron(X(6), m2[1], 180)
    );
  }

  function symmetricHorizontalLines() {
    var l1 = [[-30, 0], [-10, 0]];
    var l2 = [[10, 0], [30, 0]];
    var m1 = at(l1[0], l1[1], 0.5);
    var m2 = at(l2[0], l2[1], 0.5);
    return (
      axis([0, -38], [0, 38]) +
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      connector(m1, m2) +
      chevron(X(-6), m1[1], 0) +
      chevron(X(6), m2[1], 180)
    );
  }

  function symmetricVerticalLinesHorizontalAxis() {
    var l1 = [[0, -30], [0, -10]];
    var l2 = [[0, 10], [0, 30]];
    var m1 = at(l1[0], l1[1], 0.5);
    var m2 = at(l2[0], l2[1], 0.5);
    return (
      axis([-38, 0], [38, 0]) +
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      connector(m1, m2) +
      chevron(m1[0], Y(6), 90) +
      chevron(m2[0], Y(-6), 270)
    );
  }

  function symmetricVerticalLinesVerticalAxis() {
    var l1 = [[-15, -20], [-15, 20]];
    var l2 = [[15, -20], [15, 20]];
    var m1 = at(l1[0], l1[1], 0.5);
    var m2 = at(l2[0], l2[1], 0.5);
    return (
      axis([0, -38], [0, 38]) +
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      connector(m1, m2) +
      chevron(X(-6), m1[1], 0) +
      chevron(X(6), m2[1], 180)
    );
  }

  function symmetricHorizontalLinesHorizontalAxis() {
    var l1 = [[-20, -15], [20, -15]];
    var l2 = [[-20, 15], [20, 15]];
    var m1 = at(l1[0], l1[1], 0.5);
    var m2 = at(l2[0], l2[1], 0.5);
    return (
      axis([-38, 0], [38, 0]) +
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      connector(m1, m2) +
      chevron(m1[0], Y(6), 90) +
      chevron(m2[0], Y(-6), 270)
    );
  }

  /* --------------------------------------------------------------------- */
  /* states                                                                 */
  /* --------------------------------------------------------------------- */

  function stateQuiet() {
    var l1 = [[-32, -16], [8, 16]];
    var l2 = [[-8, -16], [32, 16]];
    return (
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      badgeOn(l1[0], l1[1], 0.7, "∥", -11, 0) +
      badgeOn(l2[0], l2[1], 0.7, "∥", 11, 0)
    );
  }

  function stateHover() {
    var l1 = [[-32, -16], [8, 16]];
    var l2 = [[-8, -16], [32, 16]];
    return (
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      connector(at(l1[0], l1[1], 0.5), at(l2[0], l2[1], 0.5), "con-connector is-strong") +
      badgeOn(l1[0], l1[1], 0.7, "∥", -11, 0, "is-strong") +
      badgeOn(l2[0], l2[1], 0.7, "∥", 11, 0, "is-strong") +
      nameLabel(X(0), Y(-32), "parallel")
    );
  }

  function stateSelected() {
    var l1 = [[-32, -16], [8, 16]];
    var l2 = [[-8, -16], [32, 16]];
    return (
      wash(l1[0], l1[1]) + wash(l2[0], l2[1]) +
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      badgeOn(l1[0], l1[1], 0.7, "∥", -11, 0) +
      badgeOn(l2[0], l2[1], 0.7, "∥", 11, 0) +
      nameLabel(X(0), Y(-32), "parallel")
    );
  }

  function stateSelectedLine() {
    var a = [-30, 0];
    var b = [30, 0];
    return (
      wash(a, b) +
      L(a, b) +
      badge(X(0), Y(0), "H") +
      tick(a, b, 0.3, 1)
    );
  }

  function stateConflict() {
    var l1 = [[-32, -16], [8, 16]];
    var l2 = [[-8, -16], [32, 16]];
    return (
      L(l1[0], l1[1]) + L(l2[0], l2[1]) +
      badgeOn(l1[0], l1[1], 0.7, "∥", -11, 0, "is-preview") +
      badgeOn(l2[0], l2[1], 0.7, "∥", 11, 0, "is-preview") +
      badge(X(0), Y(-32), "!", "is-preview")
    );
  }

  /* --------------------------------------------------------------------- */
  /* the finder: hover companions, choose, delete                           */
  /* --------------------------------------------------------------------- */

  function washLine(x1, y1, x2, y2, id) {
    return (
      '<line x1="' + f(x1) + '" y1="' + f(y1) + '" x2="' + f(x2) +
      '" y2="' + f(y2) + '" class="con-link-wash" data-wash="' + id + '"/>'
    );
  }

  function washCircle(cx, cy, r, id) {
    return (
      '<circle cx="' + f(cx) + '" cy="' + f(cy) + '" r="' + f(r) +
      '" class="con-link-wash" data-wash="' + id + '"/>'
    );
  }

  function finderMark(id, hx, hy, label, content) {
    return (
      '<g data-constraint="' + id + '" role="button" aria-label="' + esc(label) + '">' +
      '<circle class="con-hit" cx="' + f(hx) + '" cy="' + f(hy) + '" r="14"/>' +
      content +
      "</g>"
    );
  }

  function finderSvg() {
    var s = "";

    // relation washes, under the geometry
    s += washLine(90, 270, 420, 270, "bottom");
    s += washLine(90, 120, 420, 120, "top");
    s += washLine(90, 120, 90, 270, "left");
    s += washLine(420, 120, 420, 270, "right");
    s += washCircle(200, 270, 7, "p1");
    s += washCircle(255, 120, 7, "p2");
    s += washCircle(160, 160, 7, "p3");
    s += washCircle(350, 160, 7, "p4");
    s += washCircle(590, 310, 7, "p5");
    s += washLine(255, 75, 255, 310, "axis");

    // the sketch
    s += line(90, 270, 420, 270, "sketch-line");
    s += line(90, 120, 420, 120, "sketch-line");
    s += line(90, 120, 90, 270, "sketch-line");
    s += line(420, 120, 420, 270, "sketch-line");
    s += circle(510, 195, 55, "sketch-line");
    s += circle(200, 270, 3.2, "sketch-point");
    s += circle(255, 120, 3.2, "sketch-point");
    s += circle(160, 160, 3.2, "sketch-point");
    s += circle(350, 160, 3.2, "sketch-point");
    s += circle(590, 310, 3.2, "sketch-point");
    s += line(255, 75, 255, 310, "con-axis");

    // the constraint marks
    s += finderMark("h1", 255, 270, "horizontal", badge(255, 270, "H"));
    s += finderMark("v1", 420, 195, "vertical", badge(420, 195, "V"));
    s += finderMark("par1", 321, 284, "parallel", badge(321, 284, "∥"));
    s += finderMark("par1", 321, 106, "parallel", badge(321, 106, "∥"));
    s += finderMark("eq1", 90, 225, "equal", line(86, 225, 94, 225, "con-mark"));
    s += finderMark("eq1", 420, 225, "equal", line(416, 225, 424, 225, "con-mark"));
    s += finderMark("pol1", 200, 270, "point on line",
      ring(200, 270, 5.4) + line(200, 262, 200, 278, "con-mark"));
    s += finderMark("mid1", 255, 120, "midpoint",
      line(255, 114, 255, 126, "con-mark") + halfFill(255, 120));
    s += finderMark("sym1", 255, 160, "symmetric",
      line(160, 160, 350, 160, "con-connector") +
      chevron(249, 160, 0) +
      chevron(261, 160, 180));
    s += finderMark("fix1", 590, 300, "fix", pin(590, 293));

    return (
      '<svg viewBox="0 0 640 380" role="img" aria-label="A sample sketch with eight constraints. Hover a mark to preview the constraint; click to select it; Backspace deletes it.">' +
      s +
      "</svg>"
    );
  }

  function buildFinder() {
    var finder = document.getElementById("con-finder");
    var host = document.getElementById("con-finder-body");
    if (!finder || !host) return;
    var tooltip = document.getElementById("con-tooltip");
    var pop = document.getElementById("con-constraint-pop");
    var status = document.getElementById("con-finder-status");
    if (!tooltip || !pop || !status) return;

    var INFO = {
      h1: { title: "horizontal", tip: "horizontal", rows: "bottom line" },
      v1: { title: "vertical", tip: "vertical", rows: "right line" },
      par1: { title: "parallel", tip: "parallel · 2 lines", rows: "bottom line · top line" },
      eq1: { title: "equal", tip: "equal · 2 lines", rows: "left line · right line" },
      pol1: { title: "point on line", tip: "point on line · 2 objects", rows: "P1 · bottom line" },
      mid1: { title: "midpoint", tip: "midpoint · 2 objects", rows: "P2 · top line" },
      sym1: { title: "symmetric", tip: "symmetric · 3 objects", rows: "P3 · P4 · axis" },
      fix1: { title: "fix", tip: "fix", rows: "P5" },
    };
    var GEO = {
      h1: ["bottom"],
      v1: ["right"],
      par1: ["bottom", "top"],
      eq1: ["left", "right"],
      pol1: ["p1", "bottom"],
      mid1: ["p2", "top"],
      sym1: ["p3", "p4", "axis"],
      fix1: ["p5"],
    };
    var INITIAL = "hover a mark · click to select · Backspace deletes";
    var state = { hover: null, selected: null, anchor: null };
    var tipTimer = 0;

    function hideTooltip() {
      if (tipTimer) {
        window.clearTimeout(tipTimer);
        tipTimer = 0;
      }
      tooltip.hidden = true;
    }

    function overlayPosition(el, anchor) {
      var fr = finder.getBoundingClientRect();
      var ar = anchor.getBoundingClientRect();
      var x = ar.left + ar.width / 2 - fr.left;
      var y = ar.top - fr.top - 10;
      el.hidden = false;
      el.classList.remove("is-below");
      if (y < 10) {
        y = ar.bottom - fr.top + 10;
        el.classList.add("is-below");
      }
      var w = el.offsetWidth || 0;
      if (w) {
        x = Math.max(8 + w / 2, Math.min(fr.width - 8 - w / 2, x));
      }
      el.style.left = x + "px";
      el.style.top = y + "px";
    }

    function setRelated(id, className) {
      var geo = GEO[id] || [];
      finder.querySelectorAll("[data-wash]").forEach(function (el) {
        var on = geo.indexOf(el.getAttribute("data-wash")) !== -1;
        el.classList.toggle(className, on);
      });
    }

    function setHover(id, anchor) {
      state.hover = id;
      finder.querySelectorAll("[data-constraint]").forEach(function (el) {
        el.classList.toggle(
          "is-hover",
          el.getAttribute("data-constraint") === id,
        );
      });
      finder.querySelectorAll("[data-wash]").forEach(function (el) {
        el.classList.remove("is-related");
      });
      if (id) setRelated(id, "is-related");

      hideTooltip();
      if (!id || id === state.selected) return;
      var info = INFO[id];
      var hit = anchor || finder.querySelector('[data-constraint="' + id + '"] .con-hit');
      if (!info || !hit) return;
      tipTimer = window.setTimeout(function () {
        if (state.hover !== id || state.selected === id) return;
        tooltip.textContent = info.tip || info.title;
        overlayPosition(tooltip, hit);
      }, 120);
    }

    function renderPop(id) {
      var info = INFO[id];
      if (!info) return;
      pop.innerHTML =
        '<div class="con-pop-kicker">constraint</div>' +
        '<div class="con-pop-title">' + esc(info.title) + "</div>" +
        '<div class="con-pop-rows">' + esc(info.rows) + "</div>" +
        '<div class="con-pop-foot"><span>Backspace deletes</span>' +
        '<button type="button" class="text-action is-quiet" data-finder-delete="' +
        id + '">delete</button></div>';
    }

    function setSelected(id, anchor) {
      state.selected = id;
      state.anchor = anchor || null;
      hideTooltip();
      finder.querySelectorAll("[data-constraint]").forEach(function (el) {
        el.classList.toggle(
          "is-selected",
          el.getAttribute("data-constraint") === id,
        );
      });
      finder.querySelectorAll("[data-wash]").forEach(function (el) {
        el.classList.remove("is-selected");
      });

      if (!id) {
        pop.hidden = true;
        status.textContent = INITIAL;
        return;
      }
      setRelated(id, "is-selected");
      var info = INFO[id];
      var hit = anchor || finder.querySelector('[data-constraint="' + id + '"] .con-hit');
      if (!info || !hit) return;
      renderPop(id);
      overlayPosition(pop, hit);
      status.textContent = info.title + " selected · Backspace deletes";
    }

    function deleteConstraint(id) {
      var info = INFO[id];
      finder.querySelectorAll('[data-constraint="' + id + '"]').forEach(function (el) {
        el.remove();
      });
      setSelected(null);
      setHover(null);
      status.textContent = (info ? info.title : "constraint") + " removed";
    }

    function resetFinder() {
      host.innerHTML = finderSvg();
      state.hover = null;
      state.selected = null;
      state.anchor = null;
      hideTooltip();
      pop.hidden = true;
      status.textContent = INITIAL;
    }

    finder.addEventListener("pointerover", function (event) {
      var g = event.target.closest ? event.target.closest("[data-constraint]") : null;
      if (!g || !finder.contains(g)) return;
      setHover(
        g.getAttribute("data-constraint"),
        g.querySelector(".con-hit"),
      );
    });

    finder.addEventListener("pointerout", function (event) {
      var g = event.target.closest ? event.target.closest("[data-constraint]") : null;
      if (!g) return;
      var to =
        event.relatedTarget && event.relatedTarget.closest
          ? event.relatedTarget.closest("[data-constraint]")
          : null;
      if (
        to &&
        to.getAttribute("data-constraint") === g.getAttribute("data-constraint")
      ) {
        return;
      }
      setHover(null);
    });

    finder.addEventListener("click", function (event) {
      var del = event.target.closest
        ? event.target.closest("[data-finder-delete]")
        : null;
      if (del) {
        event.stopPropagation();
        deleteConstraint(del.getAttribute("data-finder-delete"));
        return;
      }
      var g = event.target.closest ? event.target.closest("[data-constraint]") : null;
      if (g) {
        event.preventDefault();
        setSelected(
          g.getAttribute("data-constraint"),
          g.querySelector(".con-hit"),
        );
        return;
      }
      if (
        event.target.closest(".con-finder-head") ||
        event.target.closest(".con-constraint-pop")
      ) {
        return;
      }
      setSelected(null);
    });

    var reset = finder.querySelector("[data-finder-reset]");
    if (reset) {
      reset.addEventListener("click", function (event) {
        event.stopPropagation();
        resetFinder();
      });
    }

    document.addEventListener("pointerdown", function (event) {
      if (!finder.contains(event.target)) setSelected(null);
    });

    window.addEventListener("keydown", function (event) {
      if (!state.selected) return;
      var target = event.target;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSelected(null);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        deleteConstraint(state.selected);
      }
    });

    resetFinder();
  }

  /* --------------------------------------------------------------------- */
  /* collision examples                                                     */
  /* --------------------------------------------------------------------- */

  function clusterDot(x, y, count) {
    return (
      circle(x, y, 7, "con-cluster-dot") +
      text(x, y + 2.4, String(count), "con-cluster-count")
    );
  }

  function collisionCluster() {
    var a = [-26, 0];
    var b = [26, 0];
    var x = X(0);
    var y = Y(0) - 10;
    return L(a, b) + clusterDot(x, y, 3);
  }

  function collisionFan() {
    var a = [-26, 0];
    var b = [26, 0];
    var cx = X(0);
    var cy = Y(0) - 10;
    var p1 = [X(-13), Y(20)];
    var p2 = [X(0), Y(27)];
    var p3 = [X(13), Y(20)];
    return (
      L(a, b) +
      line(cx, cy, p1[0], p1[1], "con-leader") +
      line(cx, cy, p2[0], p2[1], "con-leader") +
      line(cx, cy, p3[0], p3[1], "con-leader") +
      badge(p1[0], p1[1], "H") +
      badge(p2[0], p2[1], "=") +
      badge(p3[0], p3[1], "M") +
      clusterDot(cx, cy, 3)
    );
  }

  function collisionChooser() {
    var x = X(0);
    var y = Y(0);
    return (
      L([-30, 0], [30, 0]) +
      P([0, 0]) +
      ring(x, y) +
      filledDot(x, y) +
      '<g transform="translate(158 56)">' +
      '<rect x="0" y="0" width="86" height="34" class="con-badge-box"/>' +
      '<text x="6" y="13" class="con-badge-text" text-anchor="start">point on line</text>' +
      '<text x="6" y="27" class="con-badge-text" text-anchor="start">horizontal</text>' +
      "</g>"
    );
  }

  function collisionPinned() {
    var x = X(0);
    var y = Y(0);
    var px = X(16);
    var py = Y(22);
    return (
      L([-26, 0], [26, 0]) +
      line(x, y, px, py, "con-leader") +
      badge(px, py, "H") +
      circle(x, y, 2.2, "con-fill")
    );
  }

  function collisionObscured() {
    return (
      '<rect x="58" y="62" width="144" height="82" fill="var(--marker-fill)" stroke="none"/>' +
      line(40, 103, 220, 103, "sketch-line") +
      badge(130, 103, "H") +
      line(96, 150, 164, 150, "dim-line") +
      text(130, 145, "60.0", "dim-text")
    );
  }

  function buildCollisions() {
    var cards = [
      card("Cluster", "three marks share one slot", collisionCluster()),
      card("Fan", "hover expands the cluster", collisionFan()),
      card("Chooser", "overlapping hits are a choice", collisionChooser()),
      card("Pinned", "a dragged mark keeps a leader", collisionPinned()),
      card("Obscured", "labels are above; marks keep a halo", collisionObscured()),
    ];
    setHTML("con-collision-grid", cards.join(""));
  }



  function build() {
    var constraints = [
      card("Horizontal", "H on the line, upright", horizontal(), { toggle: true }),
      card("Vertical", "V on the line, upright", vertical(), { toggle: true }),
      card("Parallel", "a badge on each line; the tie is the pair", parallel(), { toggle: true }),
      card("Perpendicular", "one square at the corner", perpendicular(), { toggle: true }),
      card("Perpendicular, apart", "badges + a tie when they do not touch", perpendicularNoTouch(), { toggle: true }),
      card("Collinear", "a tie across the gap, one ≡", collinear(), { toggle: true }),
      card("Equal", "one tick per equal group", equalOne(), { toggle: true }),
      card("Equal groups", "a second group gets a second tick", equalTwo(), { toggle: true }),
      card("Equal radii", "a radial tick on each circle", equalRadii(), { toggle: true }),
      card("Point on line", "a ring + a normal tick", pointOnLine(), { toggle: true }),
      card("Point on circle", "a ring + a radial tick", pointOnCircle(), { toggle: true }),
      card("Tangent", "a diamond at the contact", tangent(), { toggle: true }),
      card("Midpoint", "a tick + a half-filled dot", midpoint(), { toggle: true }),
      card("Coincident", "the point is the mark; a ring only for two ids", coincident(), { toggle: true }),
      card("Fix", "a pin, not an F", fix(), { toggle: true }),
      card("Symmetric", "chevrons turn with the axis", symmetricSmall(), { toggle: true }),
    ];

    var measurements = [
      card("Linear", "slashes, an offset, an upright value", dimHorizontal(), { toggle: true }),
      card("Vertical", "the value stays upright beside the line", dimVertical(), { toggle: true }),
      card("Aligned", "the line is parallel to the measured span", dimAligned(), { toggle: true }),
      card("Point to line", "a perpendicular with a right-angle foot", dimPointLine(), { toggle: true }),
      card("Angle", "an arc, open arrows, the smaller angle", dimAngleCard(), { toggle: true }),
      card("Radius", "a leader from the centre, R", dimRadius(), { toggle: true }),
      card("Diameter", "through the centre, Ø", dimDiameter(), { toggle: true }),
      card("Reference", "parentheses + italic; it only reads", dimReference(), { toggle: true }),
      card("Editing", "the label becomes the inline editor", dimEditing()),
    ];

    var states = [
      card("Quiet", "ink-3, no fill", stateQuiet(), { toggle: true }),
      card("Hover", "ink-2 + the name", stateHover(), { toggle: true }),
      card("Selected", "ink + paper badge + marker underline", stateSelected(), { mods: "is-selected", toggle: true }),
      card("Selected line", "the wash goes under the marks", stateSelectedLine(), { mods: "is-selected", toggle: true }),
      card("Conflict", "dashed ghost + ! + a checked chip", stateConflict(), {
        toggle: true,
        chip: '<span class="con-chip is-preview">parallel</span>' +
          '<span class="con-chip is-on">preview</span>',
      }),
    ];

    var symmetric = [
      card("Vertical axis · points", "the chevrons point left / right", symmetricVerticalPoints(), { wide: true, toggle: true }),
      card("Horizontal axis · points", "the chevrons point up / down", symmetricHorizontalPoints(), { wide: true, toggle: true }),
      card("Vertical axis · vertical lines", "parallel lines, left / right chevrons", symmetricVerticalLinesVerticalAxis(), { wide: true, toggle: true }),
      card("Horizontal axis · horizontal lines", "parallel lines, up / down chevrons", symmetricHorizontalLinesHorizontalAxis(), { wide: true, toggle: true }),
      card("Vertical axis · horizontal lines", "collinear lines; the connector is the gap", symmetricHorizontalLines(), { wide: true, toggle: true }),
      card("Horizontal axis · vertical lines", "collinear lines; the connector is the gap", symmetricVerticalLinesHorizontalAxis(), { wide: true, toggle: true }),
      card("Vertical axis · slanted lines", "one connector between the midpoints", symmetricVerticalLines(), { wide: true, toggle: true }),
    ];

    setHTML("con-grid", constraints.join(""));
    setHTML("con-measure-grid", measurements.join(""));
    setHTML("con-states", states.join(""));
    setHTML("con-symmetric", symmetric.join(""));

    document.querySelectorAll("[data-toggle]").forEach(function (el) {
      el.addEventListener("click", function (event) {
        if (event.target.closest("input, button, textarea, select")) return;
        el.classList.toggle("is-selected");
      });
    });
  }

  function setHTML(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function init() {
    build();
    buildFinder();
    buildCollisions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
