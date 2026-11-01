#!/usr/bin/env node
/*
 * Typography audit for docs/mockups.
 *
 * Raw font/leading/tracking values are only allowed inside the typography
 * token block in mockup.css. Every component must reference a token.
 *
 * Run from the repo root:
 *   node docs/mockups/check-typography.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const PROPERTIES = [
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
];
const propertyPattern = new RegExp(`(${PROPERTIES.join("|")})\\s*:\\s*([^;]+);`);
const tokenValuePattern =
  /^var\(--(?:font|type|weight|leading|tracking)-[a-z0-9-]+\)$/;
const EXPECTED_FONTS = ["--font-sans", "--font-serif", "--font-mono"];
const EXPECTED_WEIGHTS = ["--weight-regular", "--weight-medium", "--weight-strong"];
const EXPECTED_TYPES = [
  "--type-display",
  "--type-name",
  "--type-row",
  "--type-prose",
  "--type-control",
  "--type-value",
  "--type-label",
  "--type-micro",
  "--type-editorial-display",
  "--type-editorial-title",
  "--type-editorial-lede",
];

const violations = [];

function auditCss(file, { requireEditorial = true } = {}) {
  const lines = readFileSync(file, "utf8").split("\n");
  let insideTokens = false;
  let sawStart = false;
  let sawEnd = false;
  const fonts = new Set();
  const types = new Set();
  const weights = new Set();
  const defined = new Set();
  const expectedTypes = requireEditorial
    ? EXPECTED_TYPES
    : EXPECTED_TYPES.filter((type) => !type.startsWith("--type-editorial-"));

  lines.forEach((line, index) => {
    if (line.includes("typography tokens: start")) {
      insideTokens = true;
      sawStart = true;
      return;
    }
    if (line.includes("typography tokens: end")) {
      insideTokens = false;
      sawEnd = true;
      return;
    }
    if (insideTokens) {
      const font = /^\s*(--font-[a-z0-9-]+)\s*:/.exec(line);
      if (font) fonts.add(font[1]);
      const type = /^\s*(--type-[a-z0-9-]+)\s*:/.exec(line);
      if (type) types.add(type[1]);
      const weight = /^\s*(--weight-[a-z0-9-]+)\s*:/.exec(line);
      if (weight) weights.add(weight[1]);
      const token = /^\s*(--(?:font|type|weight|leading|tracking)-[a-z0-9-]+)\s*:/.exec(line);
      if (token) defined.add(token[1]);
      return;
    }

    const match = propertyPattern.exec(line);
    if (!match) return;
    const value = match[2].trim();
    if (!tokenValuePattern.test(value)) {
      violations.push({
        file,
        line: index + 1,
        property: match[1],
        value,
        text: line.trim(),
      });
      return;
    }
    const token = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (!token || !defined.has(token[1])) {
      violations.push({
        file,
        line: index + 1,
        property: match[1],
        value,
        text: "unknown typography token",
      });
    }
  });

  if (!sawStart || !sawEnd) {
    violations.push({
      file,
      line: 0,
      property: "token block",
      value: "",
      text: "missing /* typography tokens: start|end */ markers",
    });
  }

  for (const font of EXPECTED_FONTS) {
    if (!fonts.has(font)) {
      violations.push({
        file,
        line: 0,
        property: "font token",
        value: font,
        text: "missing expected family token",
      });
    }
  }
  for (const font of fonts) {
    if (!EXPECTED_FONTS.includes(font)) {
      violations.push({
        file,
        line: 0,
        property: "font token",
        value: font,
        text: "unexpected family token",
      });
    }
  }
  for (const type of expectedTypes) {
    if (!types.has(type)) {
      violations.push({
        file,
        line: 0,
        property: "type token",
        value: type,
        text: "missing expected role token",
      });
    }
  }
  for (const type of types) {
    if (!EXPECTED_TYPES.includes(type)) {
      violations.push({
        file,
        line: 0,
        property: "type token",
        value: type,
        text: "unexpected role token",
      });
    }
  }
  for (const weight of EXPECTED_WEIGHTS) {
    if (!weights.has(weight)) {
      violations.push({
        file,
        line: 0,
        property: "weight token",
        value: weight,
        text: "missing expected weight token",
      });
    }
  }
  for (const weight of weights) {
    if (!EXPECTED_WEIGHTS.includes(weight)) {
      violations.push({
        file,
        line: 0,
        property: "weight token",
        value: weight,
        text: "unexpected weight token",
      });
    }
  }

  return lines.length;
}

function auditHtml(file) {
  const source = readFileSync(file, "utf8");
  const stylePattern = /style\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = stylePattern.exec(source))) {
    const style = match[1];
    for (const property of PROPERTIES) {
      if (style.includes(`${property}:`)) {
        violations.push({
          file,
          line: 0,
          property,
          value: "",
          text: `inline style: ${style}`,
        });
      }
    }
  }
}

let cssLines = 0;
for (const name of readdirSync(here)) {
  if (name.endsWith(".css")) cssLines += auditCss(join(here, name));
  if (name.endsWith(".html")) auditHtml(join(here, name));
}
// The React app shares the same token contract. It does not use the editorial
// layer, so only the eight app roles are required there.
cssLines += auditCss(join(here, "..", "..", "src", "app", "app.css"), {
  requireEditorial: false,
});

if (violations.length > 0) {
  console.error(`Typography audit failed: ${violations.length} raw declaration(s).\n`);
  for (const violation of violations) {
    const location = violation.line
      ? `${violation.file}:${violation.line}`
      : violation.file;
    console.error(`  ${location}  ${violation.property}: ${violation.value || violation.text}`);
  }
  console.error(
    "\nUse var(--type-*), var(--font-*), var(--weight-*), var(--leading-*) or var(--tracking-*) tokens.",
  );
  process.exit(1);
}

console.log(
  `Typography audit passed: ${cssLines} CSS lines checked, no raw font/leading/tracking values outside the token block.`,
);
