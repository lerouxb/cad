import { readFileSync } from "node:fs";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { createDocument } from "../src/core/doc/create";
import { createExampleDocument } from "../src/core/doc/example";
import { addSketchFeature } from "../src/core/doc/selectors";
import type { ExtrudeFeature, SketchFeature } from "../src/core/doc/types";
import { addCircle, addPolyline, emptySketch } from "../src/core/sketch/create";

/** Set a range input the way a user would, through React's onChange. */
async function setSlider(locator: Locator, value: number): Promise<void> {
  await locator.evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** Screen point for a sketch-space coordinate (after the view settles). */
async function sketchPoint(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  await settleSketch(page);
  return page.evaluate(
    ([sx, sy]) => {
      const svg = document.querySelector<SVGSVGElement>("svg.sketch-canvas");
      const matrix = svg?.getScreenCTM();
      if (!matrix) throw new Error("Sketch canvas is not visible");
      const point = new DOMPoint(sx, sy).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    },
    [x, y],
  );
}

/** Click a point given in sketch millimetres, independent of pan/zoom. */
async function clickSketch(page: Page, x: number, y: number): Promise<void> {
  await settleSketch(page);
  const screen = await page.evaluate(
    ([sx, sy]) => {
      const svg = document.querySelector<SVGSVGElement>("svg.sketch-canvas");
      const matrix = svg?.getScreenCTM();
      if (!matrix) throw new Error("Sketch canvas is not visible");
      const point = new DOMPoint(sx, sy).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    },
    [x, y],
  );
  await page.mouse.click(screen.x, screen.y);
}

async function enterSketch(page: Page): Promise<void> {
  await page.getByTestId("timeline-sketch").click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
}

/** Fit the model and pick the top face of the demo plate. */
async function pickTopFace(page: Page): Promise<void> {
  const canvas = page.locator("canvas.viewport-canvas");
  await page.getByRole("button", { name: "Fit view" }).click();
  await page.waitForTimeout(200);
  await page.mouse.move(700, 330);
  await expect(canvas).toHaveAttribute("data-hover-kind", "face");
  await page.mouse.click(700, 330);
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-kind",
    "face",
  );
}

/** Fit the model and pick the front side face of the demo plate. */
async function pickSideFace(page: Page): Promise<void> {
  const canvas = page.locator("canvas.viewport-canvas");
  await page.getByRole("button", { name: "Fit view" }).click();
  await page.waitForTimeout(200);
  await page.mouse.move(520, 340);
  await expect(canvas).toHaveAttribute("data-hover-kind", "face");
  await page.mouse.click(520, 340);
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-kind",
    "face",
  );
}

/** Fit the model and pick the right side face of the demo plate. */
async function pickRightFace(page: Page): Promise<void> {
  const canvas = page.locator("canvas.viewport-canvas");
  await page.getByRole("button", { name: "Fit view" }).click();
  await page.waitForTimeout(200);
  await page.mouse.move(800, 340);
  await expect(canvas).toHaveAttribute("data-hover-kind", "face");
  await page.mouse.click(800, 340);
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-kind",
    "face",
  );
}

/** Find a screen point over a rendered datum plane after Fit view. */
async function findDatumHover(page: Page): Promise<{ x: number; y: number }> {
  const canvas = page.locator("canvas.viewport-canvas");
  for (let y = 120; y <= 600; y += 30) {
    for (let x = 120; x <= 900; x += 30) {
      await page.mouse.move(x, y);
      if ((await canvas.getAttribute("data-hover-kind")) === "datum") {
        return { x, y };
      }
    }
  }
  throw new Error("No datum plane hover target found");
}

async function sketchOnPickedFace(page: Page): Promise<void> {
  await page.getByTestId("add-sketch").click();
  await expect(page.getByTestId("support-popover")).toContainText(
    "selected face",
  );
  await expect(page.getByTestId("support-popover")).toContainText(
    "planar face",
  );
  await expect(page.getByTestId("new-sketch")).toBeEnabled();
  await page.getByTestId("new-sketch").click();

  await expect(page.getByTestId("timeline-detail")).toContainText("Face ·");
  await expect(page.getByTestId("tool-select")).toBeVisible();
  // Horizontal SVG lines have a zero-height box, so `toBeVisible` is a false
  // negative here; the projected reference is present and dashed.
  await expect(page.locator("[data-projection-id]").first()).toBeAttached();
  await expect(page.locator("[data-projection-id]").first()).toHaveAttribute(
    "stroke-dasharray",
    "4 3",
  );
  await expect(page.locator("[data-projection-point-id]").first()).toBeAttached();
}

/** Create the demo face sketch and its 5 mm boss on the picked top face. */
async function sketchBossOnPickedFace(page: Page): Promise<void> {
  await sketchOnPickedFace(page);

  // The sketch is plane-local at the face centroid; the projected outline is
  // fixed reference geometry. Draw a 5 mm circle inside the central hole.
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 5, 0);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();

  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 0, 0);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-height").fill("5");
  await page.getByTestId("extrude-apply").click();
}

/** Create a sketch through the explicit support popover. */
async function createSketch(page: Page): Promise<void> {
  await page.getByTestId("add-sketch").click();
  await expect(page.getByTestId("support-popover")).toBeVisible();
  await page.getByTestId("new-sketch").click();
}

async function dblclickSketch(page: Page, x: number, y: number): Promise<void> {
  await settleSketch(page);
  const screen = await page.evaluate(
    ([sx, sy]) => {
      const svg = document.querySelector<SVGSVGElement>("svg.sketch-canvas");
      const matrix = svg?.getScreenCTM();
      if (!matrix) throw new Error("Sketch canvas is not visible");
      const point = new DOMPoint(sx, sy).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    },
    [x, y],
  );
  await page.mouse.dblclick(screen.x, screen.y);
}

async function settleSketch(page: Page): Promise<void> {
  // Drawing auto-fits the view. Wait for the fit's effect/paint to land and the
  // viewBox to stop changing before reading the CTM, otherwise the next gesture
  // is mapped against the old view. The minimum-frame window also gives React
  // time to flush the effects under parallel-worker load.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = "";
        let stable = 0;
        let frames = 0;
        const tick = () => {
          const current =
            document
              .querySelector<SVGSVGElement>("svg.sketch-canvas")
              ?.getAttribute("viewBox") ?? "";
          frames += 1;
          if (frames >= 6) {
            if (current === last) stable += 1;
            else stable = 0;
            last = current;
            if (stable >= 3) {
              resolve();
              return;
            }
          }
          if (frames >= 30) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

async function dragSketch(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await settleSketch(page);
  // Map both ends with the same CTM: an auto-fit between two lookups would
  // skew the drag.
  const points = await page.evaluate(
    ([ax, ay, bx, by]) => {
      const svg = document.querySelector<SVGSVGElement>("svg.sketch-canvas");
      const matrix = svg?.getScreenCTM();
      if (!matrix) throw new Error("Sketch canvas is not visible");
      const a = new DOMPoint(ax!, ay!).matrixTransform(matrix);
      const b = new DOMPoint(bx!, by!).matrixTransform(matrix);
      return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
    },
    [from[0], from[1], to[0], to[1]],
  );
  await dragScreen(page, points.a.x, points.a.y, points.b.x, points.b.y);
}

async function lassoSketch(
  page: Page,
  points: [number, number][],
): Promise<void> {
  await settleSketch(page);
  const screen = await page.evaluate((world) => {
    const svg = document.querySelector<SVGSVGElement>("svg.sketch-canvas");
    const matrix = svg?.getScreenCTM();
    if (!matrix) throw new Error("Sketch canvas is not visible");
    return world.map(([x, y]) => {
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
  }, points);
  const first = screen[0]!;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of screen.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 5 });
  }
  await page.mouse.move(first.x, first.y, { steps: 5 });
  await page.mouse.up();
}

async function dragScreen(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
}

async function volume(page: Page): Promise<number> {
  return Number(await page.getByTestId("mesh-stats").getAttribute("data-volume"));
}

/** A saved three-feature part: new plate, cut hole, join extension. */
function multiFeatureDoc() {
  const plate = addPolyline(
    emptySketch(),
    [
      { point: [0, 0] },
      { point: [60, 0] },
      { point: [60, 40] },
      { point: [0, 40] },
    ],
    true,
  );
  const hole = addCircle(emptySketch(), { point: [30, 20] }, 8);
  const extension = addPolyline(
    emptySketch(),
    [
      { point: [40, 0] },
      { point: [80, 0] },
      { point: [80, 40] },
      { point: [40, 40] },
    ],
    true,
  );
  const doc = createDocument(plate, {
    id: "doc-multi",
    sketchId: "sketch-1",
    extrudeId: "extrude-1",
    name: "Multi-feature",
    height: 12,
  });
  const base = doc.features[1];
  if (base?.type !== "extrude") throw new Error("Expected the base extrude");

  const sketch2: SketchFeature = {
    id: "sketch-2",
    type: "sketch",
    name: "Hole sketch",
    support: { kind: "world", plane: "XY" },
    sketch: hole,
  };
  const sketch3: SketchFeature = {
    id: "sketch-3",
    type: "sketch",
    name: "Extension sketch",
    support: { kind: "world", plane: "XY" },
    sketch: extension,
  };
  const cut: ExtrudeFeature = {
    ...base,
    id: "extrude-2",
    name: "Cut 1",
    sketchId: "sketch-2",
    operation: "cut",
    regions: [],
  };
  const join: ExtrudeFeature = {
    ...base,
    id: "extrude-3",
    name: "Join 1",
    sketchId: "sketch-3",
    operation: "join",
    regions: [],
  };
  return {
    ...doc,
    features: [doc.features[0]!, base, sketch2, cut, sketch3, join],
  };
}

/** Bounds of the extruded outer loop, in sketch millimetres. */
/** Rounded mesh bounds as a compact string, tolerating tessellation error. */
async function meshBounds(page: Page): Promise<string> {
  const raw = await page.getByTestId("mesh-stats").getAttribute("data-bbox");
  if (!raw) throw new Error("No mesh bounds");
  return raw
    .split(",")
    .map((value) => Number(Number(value).toFixed(1)))
    .join(",");
}

async function readProfileRect(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector("[data-region-bounds]");
    const raw = element?.getAttribute("data-region-bounds");
    if (!raw) throw new Error("No region bounds");
    const [minX, minY, maxX, maxY] = raw.split(",").map(Number);
    return { minX: minX!, minY: minY!, maxX: maxX!, maxY: maxY! };
  });
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}


/**
 * Reuse one app page per worker. A fresh page per test re-downloads and
 * re-instantiates the solver and OCCT WASM, which dominates the suite.
 */
const test = base.extend<Record<never, never>, { app: Page }>({
  app: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        baseURL: "http://127.0.0.1:4173",
        viewport: { width: 1280, height: 720 },
      });
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByTestId("solver-status")).toContainText("ready", {
        timeout: 60_000,
      });
      await expect(page.getByTestId("kernel-status")).toContainText("ready", {
        timeout: 60_000,
      });
      await use(page);
      await context.close();
    },
    { scope: "worker" },
  ],
});

test.beforeEach(async ({ app: page }) => {
  // Reset UI modes that are not part of the document, then reload the demo and
  // wait for a known mesh. No page reload, so the WASM stays warm.
  await page.getByTestId("theme-day").click();
  await page.getByTestId("highlight-yellow").click();
  await page.getByTestId("timeline-sketch").click();
  await page.getByTestId("tool-select").click();
  const snap = page.getByTestId("snap-toggle");
  if (((await snap.textContent()) ?? "").includes("off")) await snap.click();
  await page.getByTestId("grid-auto").click();
  await page.getByTestId("zoom-select").selectOption("fit");
  if (await page.getByTestId("file-menu-popover").count()) {
    await page.getByTestId("file-menu").click();
  }
  const rollForward = page.getByTestId("roll-forward");
  if (await rollForward.count()) await rollForward.click();
  await page.evaluate(() => localStorage.removeItem("cad.files"));
  await page.getByTestId("load-example").click();
  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("edit-feature").click();
  await setSlider(page.getByTestId("height-slider"), 12);
  await page.getByTestId("feature-popover-apply").click();
  const plate = 60 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);
});

test("the dimensioned example drives an exact solid", async ({ app: page }) => {
  const errors = collectErrors(page);

  const stats = page.getByTestId("mesh-stats");
  await expect(stats).toBeVisible();
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,60,40,12");
  await expect(stats).toHaveAttribute("data-faces", "7");

  const plate = 60 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);

  await enterSketch(page);
  await expect(page.getByTestId("dof")).toContainText("Fully constrained");

  // A fully constrained sketch refuses to move.
  const corner = page.locator('[data-point-id="p1"]');
  const box = await corner.boundingBox();
  if (!box) throw new Error("Could not locate the sketch corner");
  await dragScreen(
    page,
    box.x + box.width / 2,
    box.y + box.height / 2,
    box.x + box.width / 2 + 45,
    box.y + box.height / 2 + 20,
  );
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);

  // Extrude height is an extrude-feature parameter, edited in the feature popover.
  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("edit-feature").click();
  await setSlider(page.getByTestId("height-slider"), 30);
  await page.getByTestId("feature-popover-apply").click();
  const taller = 60 * 40 * 30 - Math.PI * 8 * 8 * 30;
  await expect.poll(() => volume(page)).toBeCloseTo(taller, -1);

  // Drawing appends to the sketch instead of replacing it. A circle inside the
  // plate becomes another hole.
  await page.getByTestId("timeline-sketch").click();
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 10, 20);
  await clickSketch(page, 15, 20);

  const withSecondHole = taller - Math.PI * 5 * 5 * 30;
  await expect.poll(() => volume(page)).toBeCloseTo(withSecondHole, -1);

  await page.keyboard.press("Control+z");
  await expect.poll(() => volume(page)).toBeCloseTo(taller, -1);

  expect(errors).toEqual([]);
});

test("shows only the selected extrude's profiles on the model overlay", async ({
  app: page,
}) => {
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");
  // Extrude 1 uses the plate plus its central hole; construction and unused
  // curves are hidden until profile selection. The selected profile is shaded,
  // with the hole left open.
  await expect(canvas).toHaveAttribute("data-sketch-curves", "2");
  await expect(canvas).toHaveAttribute("data-sketch-fills", "1");

  await page.getByTestId("timeline-sketch").click();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "off");
  await expect(page.locator("[data-region-id]")).toHaveCount(2);

  await page.getByTestId("timeline-extrude").click();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");
  await expect(canvas).toHaveAttribute("data-sketch-curves", "2");
  await expect(canvas).toHaveAttribute("data-sketch-fills", "1");
});

test("creates a sketch on a planar face and extrudes from it", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await sketchOnPickedFace(page);

  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 5, 0);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();

  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 0, 0);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-height").fill("5");
  await page.getByTestId("extrude-apply").click();

  const expected =
    60 * 40 * 12 - Math.PI * 8 * 8 * 12 + Math.PI * 5 * 5 * 5;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,60,40,17");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});

test("creates a sketch on the XZ world plane and joins an extrude", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page.getByTestId("add-sketch").click();
  await expect(page.getByTestId("support-popover")).toBeVisible();
  const viewport = page.locator("canvas.viewport-canvas");
  await expect(viewport).toHaveAttribute("data-support-preview", "on");
  await expect(viewport).toHaveAttribute("data-body-dimmed", "on");
  await page.getByTestId("support-xz").click();
  await expect(page.getByTestId("support-popover")).toContainText(
    "world plane · XZ",
  );
  await page.getByTestId("new-sketch").click();
  await expect(page.getByTestId("timeline-detail")).toContainText("XZ");
  await expect(viewport).toHaveAttribute("data-support-preview", "off");
  await expect(viewport).toHaveAttribute("data-body-dimmed", "off");

  // Local X/Y on XZ are world X/Z; extrude along local +Z maps to world -Y.
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 30, 6);
  await clickSketch(page, 35, 6);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();

  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 30, 6);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-height").fill("5");
  await page.getByTestId("extrude-apply").click();

  const plate = 60 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate + Math.PI * 5 * 5 * 5, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,-5,0,60,40,12");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});

test("creates an offset datum plane and sketches on it", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page.getByTestId("add-plane").click();
  await expect(page.getByTestId("datum-draft-popover")).toBeVisible();
  await page.getByTestId("datum-distance").fill("10");
  await page.getByTestId("datum-apply").click();

  const datum = page.locator('[data-feature-type="datum"]');
  await expect(datum).toHaveCount(1);
  await expect(datum).toContainText("offset 10 mm · from XY");
  await expect(page.locator("canvas.viewport-canvas")).toHaveAttribute(
    "data-datum-planes",
    "1",
  );

  await page.getByTestId("add-sketch").click();
  await page.getByTestId("support-datum").selectOption({ label: "Plane 1" });
  await expect(page.getByTestId("support-popover")).toContainText(
    "datum plane · Plane 1",
  );
  await page.getByTestId("new-sketch").click();
  await expect(page.getByTestId("timeline-detail")).toContainText(
    "Datum · Plane 1",
  );

  // Plane-local (10, 10) is world (10, 10); the plane sits at z = 10.
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 10, 10);
  await clickSketch(page, 15, 10);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();
  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 10, 10);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-height").fill("5");
  await page.getByTestId("extrude-apply").click();

  const plate = 60 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(plate + Math.PI * 5 * 5 * 3, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,60,40,15");

  // Move the datum plane down: the boss follows, so two more millimetres of
  // the 5 mm cylinder are outside the 12 mm plate.
  await datum.click();
  await page.getByTestId("edit-feature").click();
  await expect(page.getByTestId("datum-popover")).toBeVisible();
  await page.getByTestId("datum-distance").fill("8");
  await page.getByTestId("datum-popover-apply").click();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(plate + Math.PI * 5 * 5 * 1, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,60,40,13");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});

test("picks a datum plane and starts a sketch on it", async ({ app: page }) => {
  const errors = collectErrors(page);
  await page.getByTestId("add-plane").click();
  await page.getByTestId("datum-distance").fill("10");
  await page.getByTestId("datum-apply").click();
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-datum-planes", "1");
  await page.getByRole("button", { name: "Fit view" }).click();
  await page.waitForTimeout(200);

  const hover = await findDatumHover(page);
  await expect(canvas).toHaveAttribute("data-hover-kind", "datum");
  await page.mouse.click(hover.x, hover.y);
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-kind",
    "datum",
  );
  const datumId = await page.getByTestId("body-pick").getAttribute("data-datum-id");
  expect(datumId).toBeTruthy();

  await page.getByTestId("add-sketch").click();
  await expect(page.getByTestId("support-popover")).toContainText(
    "datum plane · Plane 1",
  );
  await page.getByTestId("new-sketch").click();
  await expect(page.getByTestId("timeline-detail")).toContainText(
    "Datum · Plane 1",
  );
  expect(errors).toEqual([]);
});

test("creates a midplane between two offset planes", async ({ app: page }) => {
  const errors = collectErrors(page);
  await page.getByTestId("add-plane").click();
  await page.getByTestId("datum-distance").fill("2");
  await page.getByTestId("datum-apply").click();

  await page.getByTestId("add-plane").click();
  await page.getByTestId("datum-base").selectOption({ label: "Plane 1" });
  await page.getByTestId("datum-distance").fill("8");
  await page.getByTestId("datum-apply").click();

  await page.getByTestId("add-plane").click();
  await page.getByTestId("datum-kind-midplane").click();
  await page.getByTestId("datum-base").selectOption({ label: "Plane 1" });
  await page.getByTestId("datum-second").selectOption({ label: "Plane 2" });
  await page.getByTestId("datum-apply").click();

  const planes = page.locator('[data-feature-type="datum"]');
  await expect(planes).toHaveCount(3);
  await planes.nth(2).click();
  await expect(page.getByTestId("timeline-detail")).toContainText("midplane");
  await expect(page.getByTestId("timeline-detail")).toContainText("0, 0, 6 mm");
  expect(errors).toEqual([]);
});

test("datum planes based on a face follow source body edits", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  const role = await page
    .getByTestId("body-pick")
    .getAttribute("data-ref-role");
  expect(role).toBeTruthy();

  await page.getByTestId("add-plane").click();
  await page.getByTestId("datum-base").selectOption({
    label: `Face · ${role}`,
  });
  await page.getByTestId("datum-distance").fill("0");
  await page.getByTestId("datum-apply").click();

  await page.getByTestId("add-sketch").click();
  await page.getByTestId("support-datum").selectOption({ label: "Plane 1" });
  await page.getByTestId("new-sketch").click();
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 10, 10);
  await clickSketch(page, 15, 10);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();
  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 10, 10);
  await page.getByTestId("extrude-height").fill("5");
  await page.getByTestId("extrude-apply").click();

  const boss = Math.PI * 5 * 5 * 5;
  const plate12 = 60 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate12 + boss, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,60,40,17");

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("edit-feature").click();
  await page.getByTestId("extrude-height").fill("30");
  await page.getByTestId("feature-popover-apply").click();

  const plate30 = 60 * 40 * 30 - Math.PI * 8 * 8 * 30;
  await expect.poll(() => volume(page)).toBeCloseTo(plate30 + boss, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,60,40,35");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const doc = JSON.parse(localStorage.getItem("cad.doc")!);
        const datum = doc.features.find(
          (feature: { type: string }) => feature.type === "datum",
        );
        return datum?.frame?.origin ?? null;
      }),
    )
    .toEqual([30, 20, 30]);
  expect(errors).toEqual([]);
});

test("flips a face sketch support and keeps that side stable", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await page.getByTestId("add-sketch").click();
  await page.getByTestId("flip-face").click();
  await expect(page.getByTestId("support-popover")).toContainText(
    "planar face · flipped",
  );
  await page.getByTestId("new-sketch").click();

  const support = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("cad.doc");
      if (!raw) return null;
      const doc = JSON.parse(raw);
      const sketch = [...doc.features]
        .reverse()
        .find(
          (feature: { type: string; support?: { kind: string } }) =>
            feature.type === "sketch" && feature.support?.kind === "face",
        );
      return sketch?.support?.frame ?? null;
    });
  await expect
    .poll(async () => (await support())?.normal ?? null)
    .toEqual([0, 0, -1]);

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("edit-feature").click();
  await page.getByTestId("extrude-height").fill("30");
  await page.getByTestId("feature-popover-apply").click();

  await expect
    .poll(support)
    .toMatchObject({
      origin: [30, 20, 30],
      normal: [0, 0, -1],
      xAxis: [1, 0, 0],
      yAxis: [0, -1, 0],
    });
  expect(errors).toEqual([]);
});

test("shows and clears a lost face support", async ({ app: page }) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await sketchOnPickedFace(page);

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("feature-suppress").click();
  await expect(page.getByTestId("timeline")).toHaveAttribute(
    "data-lost-supports",
    "1",
  );
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Sketch 3" })
    .click();
  await expect(page.getByTestId("timeline-detail")).toContainText(
    "lost · cached frame",
  );
  await expect(page.getByTestId("reselect-support")).toBeVisible();
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "error",
  );

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("feature-suppress").click();
  await expect
    .poll(() => page.getByTestId("rebuild-status").getAttribute("data-status"))
    .toBe("ok");
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Sketch 3" })
    .click();
  await expect(page.getByTestId("timeline-detail")).not.toContainText(
    "lost · cached frame",
  );
  expect(errors).toEqual([]);
});

test("resolves a stale face role by geometric fallback", async ({ browser }) => {
  const doc = createExampleDocument();
  const extrude = doc.features.find(
    (feature): feature is ExtrudeFeature => feature.type === "extrude",
  );
  if (!extrude) throw new Error("Example has no extrude");
  const withFace = addSketchFeature(doc, {
    name: "Recovered face sketch",
    support: {
      kind: "face",
      ref: {
        source: extrude.id,
        kind: "face",
        role: "extrude:missing-role",
        hint: {
          entityType: "face",
          surfaceType: "PLANE",
          normal: [0, 0, 1],
          centroid: [30, 20, 12],
          area: 2400 - Math.PI * 8 * 8,
        },
      },
      frame: {
        origin: [30, 20, 12],
        normal: [0, 0, 1],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
      },
    },
  });

  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(withFace.doc));
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Recovered face sketch" })
    .click();
  await expect(page.locator("[data-projection-id]").first()).toBeAttached();
  await expect(page.getByTestId("timeline-detail")).not.toContainText(
    "lost · cached frame",
  );
  await expect(page.getByTestId("timeline")).toHaveAttribute(
    "data-lost-supports",
    "0",
  );
  await context.close();
});

test("previews a datum plane while creating it", async ({ app: page }) => {
  const errors = collectErrors(page);
  const canvas = page.locator("canvas.viewport-canvas");
  await page.getByTestId("add-plane").click();
  await expect(canvas).toHaveAttribute("data-support-preview", "on");
  await expect(canvas).toHaveAttribute("data-body-dimmed", "on");
  await expect(canvas).toHaveAttribute(
    "data-support-preview-origin",
    "0.000,0.000,10.000",
  );

  await page.getByTestId("datum-distance").fill("25");
  await expect(canvas).toHaveAttribute(
    "data-support-preview-origin",
    "0.000,0.000,25.000",
  );

  await page.getByTestId("datum-apply").click();
  await expect(canvas).toHaveAttribute("data-datum-planes", "1");
  await expect(canvas).toHaveAttribute("data-support-preview", "off");
  await expect(canvas).toHaveAttribute("data-body-dimmed", "off");
  expect(errors).toEqual([]);
});

test("new steps insert after the selected step without its overlay", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const canvas = page.locator("canvas.viewport-canvas");
  await page.getByTestId("timeline-extrude").click();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");

  await page.getByTestId("add-plane").click();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "off");
  await expect(canvas).toHaveAttribute("data-support-preview", "on");
  await page.getByTestId("datum-apply").click();

  const rows = page.locator("[data-feature-id]");
  await expect(rows.nth(1)).toContainText("Extrude 1");
  await expect(rows.nth(2)).toHaveAttribute("data-feature-type", "datum");
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "off");

  // A sketch chosen while Extrude 1 is selected inserts before that new datum.
  await page.getByTestId("timeline-extrude").click();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");
  await page.getByTestId("add-sketch").click();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "off");
  await page.getByTestId("new-sketch").click();
  await expect(rows.nth(2)).toHaveAttribute("data-feature-type", "sketch");
  await expect(rows.nth(3)).toHaveAttribute("data-feature-type", "datum");
  expect(errors).toEqual([]);
});

test("hides a datum plane without suppressing it", async ({ app: page }) => {
  const errors = collectErrors(page);
  await page.getByTestId("add-plane").click();
  await page.getByTestId("datum-distance").fill("10");
  await page.getByTestId("datum-apply").click();
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-datum-planes", "1");

  const datum = page.locator('[data-feature-type="datum"]');
  await datum.click();
  await page.getByTestId("toggle-datum-visibility").click();
  await expect(canvas).toHaveAttribute("data-datum-planes", "0");
  await expect(datum).toContainText("hidden");
  await expect(datum).toHaveAttribute("data-status", "ok");
  await expect(datum).toHaveClass(/is-hidden/);
  await expect(datum).toHaveAttribute("data-hidden", "true");

  // It is still a usable support while hidden.
  await page.getByTestId("add-sketch").click();
  await expect(page.getByTestId("support-datum")).toContainText("Plane 1");
  await page.getByTestId("support-cancel").click();

  await datum.click();
  await page.getByTestId("toggle-datum-visibility").click();
  await expect(canvas).toHaveAttribute("data-datum-planes", "1");
  await expect(datum).not.toContainText("hidden");
  await expect(datum).not.toHaveClass(/is-hidden/);
  expect(errors).toEqual([]);
});

test("snaps a drawn line to a projected face boundary", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await sketchOnPickedFace(page);

  // The projected plate outline is a 60×40 rectangle centred on the face. Start
  // the line 0.5 mm inside the right edge; it must snap onto x = 30 and gain a
  // point-on-line constraint instead of rounding to the 5 mm grid.
  await page.getByTestId("tool-line").click();
  await clickSketch(page, 29.5, 13.3);
  await clickSketch(page, 20, 13.3);
  await page.keyboard.press("Enter");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("cad.doc");
        if (!raw) return null;
        const doc = JSON.parse(raw);
        const sketch = [...doc.features]
          .reverse()
          .find(
            (feature: { type: string; support?: { kind: string } }) =>
              feature.type === "sketch" && feature.support?.kind === "face",
          );
        const point = sketch?.sketch.points.find(
          (candidate: { x: number }) => candidate.x > 29.9,
        );
        const linked = sketch?.sketch.constraints.some(
          (constraint: { type: string; line?: string }) =>
            constraint.type === "pointOnLine" &&
            constraint.line?.startsWith("proj-"),
        );
        return point && linked ? [point.x, point.y] : null;
      }),
    )
    .not.toBeNull();

  const snapped = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("cad.doc")!);
    const sketch = [...doc.features]
      .reverse()
      .find(
            (feature: { type: string; support?: { kind: string } }) =>
              feature.type === "sketch" && feature.support?.kind === "face",
          );
    return sketch.sketch.points.find(
      (candidate: { x: number }) => candidate.x > 29.9,
    ) as { x: number; y: number };
  });
  expect(snapped.x).toBeCloseTo(30, 3);
  // The auto horizontal constraint lets the solver settle a few hundredths of
  // a millimetre; the point is still off the 5 mm grid, proving edge snapping.
  expect(snapped.y).toBeCloseTo(13.3, 1);
  expect(errors).toEqual([]);
});

test("projects a side face as a closed rectangle", async ({ app: page }) => {
  const errors = collectErrors(page);
  await pickSideFace(page);
  await page.getByTestId("add-sketch").click();
  await page.getByTestId("new-sketch").click();

  // Every edge of the side face must be projected, not just the two that the
  // kernel happened to return first.
  await expect(page.locator("[data-projection-id]")).toHaveCount(4);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("cad.doc");
        if (!raw) return null;
        const doc = JSON.parse(raw);
        const sketch = [...doc.features]
          .reverse()
          .find(
            (feature: { type: string; support?: { kind: string } }) =>
              feature.type === "sketch" && feature.support?.kind === "face",
          );
        return sketch?.projections?.[0]?.loops?.[0]?.length ?? null;
      }),
    )
    .toBe(4);

  const corners = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("cad.doc")!);
    const sketch = [...doc.features]
      .reverse()
      .find(
            (feature: { type: string; support?: { kind: string } }) =>
              feature.type === "sketch" && feature.support?.kind === "face",
          );
    return (sketch.projections[0].loops[0] as [number, number][])
      .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`)
      .sort();
  });
  expect(corners).toEqual(["-30,-6", "-30,6", "30,-6", "30,6"]);
  expect(errors).toEqual([]);
});

test("dragging a projected edge point leaves the other endpoint fixed", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickRightFace(page);
  await page.getByTestId("add-sketch").click();
  await page.getByTestId("new-sketch").click();
  await expect(page.locator("[data-projection-id]")).toHaveCount(4);

  await page.getByTestId("tool-line").click();
  await clickSketch(page, -19, 1);
  await clickSketch(page, -2, -5);
  await page.keyboard.press("Enter");
  await page.getByTestId("tool-select").click();

  const points = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("cad.doc");
      if (!raw) return null;
      const doc = JSON.parse(raw);
      const sketch = [...doc.features]
        .reverse()
        .find(
            (feature: { type: string; support?: { kind: string } }) =>
              feature.type === "sketch" && feature.support?.kind === "face",
          );
      const found = sketch?.sketch.points as
        | { x: number; y: number }[]
        | undefined;
      if (!found || found.length < 2) return null;
      const left = found.reduce((a, b) => (a.x < b.x ? a : b));
      const right = found.reduce((a, b) => (a.x > b.x ? a : b));
      return { left: { x: left.x, y: left.y }, right: { x: right.x, y: right.y } };
    });
  await expect.poll(points).not.toBeNull();
  const before = (await points())!;

  // Grab at the endpoint. The other endpoint is on a different projected edge
  // and must not drift with the solver's free variables.
  await dragSketch(page, [-2, -6], [-10, -6]);
  await expect.poll(async () => (await points())?.right.x ?? 0).toBeCloseTo(-10, 0);

  const after = (await points())!;
  expect(after.left.x).toBeCloseTo(before.left.x, 4);
  expect(after.left.y).toBeCloseTo(before.left.y, 4);
  expect(errors).toEqual([]);
});

test("keeps a face sketch attached when its source body changes", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await sketchBossOnPickedFace(page);

  const boss = Math.PI * 5 * 5 * 5;
  const plate12 = 60 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate12 + boss, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,60,40,17");

  // Make the source plate taller. The boss sketch has no own placement
  // dimensions: its frame comes from the live top face, so the boss must move
  // from z = 12 to z = 30 and keep its projected reference attached.
  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("edit-feature").click();
  await page.getByTestId("extrude-height").fill("30");
  const plate30 = 60 * 40 * 30 - Math.PI * 8 * 8 * 30;
  await expect.poll(() => volume(page)).toBeCloseTo(plate30 + boss, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,60,40,35");
  await page.getByTestId("feature-popover-apply").click();
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );

  // Re-open the face sketch: its projected dashed references survived the
  // source change and are still fixed geometry in the new plane.
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Sketch 3" })
    .click();
  await expect(page.getByTestId("timeline-detail")).toContainText("Face ·");
  await expect(page.locator("[data-projection-id]").first()).toBeAttached();
  expect(errors).toEqual([]);
});

test("picks faces and edges in the model view", async ({ app: page }) => {
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");
  await page.getByRole("button", { name: "Fit view" }).click();
  await page.waitForTimeout(200);

  // Hover and click a top face.
  await page.mouse.move(700, 330);
  await expect(canvas).toHaveAttribute("data-hover-kind", "face");
  await page.mouse.click(700, 330);
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-kind",
    "face",
  );
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-id",
    /^face-/,
  );
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-ref-role",
    /^extrude:/,
  );
  const ref = JSON.parse(
    (await page.getByTestId("body-pick").getAttribute("data-ref")) ?? "{}",
  );
  expect(ref).toMatchObject({
    kind: "face",
    hint: { entityType: "face" },
  });
  expect(typeof ref.source).toBe("string");

  // Face support is M4; + sketch acknowledges the picked face but still asks
  // for a world plane instead of silently ignoring it.
  await page.getByTestId("add-sketch").click();
  await expect(page.getByTestId("support-popover")).toContainText(
    "selected face",
  );
  await page.getByTestId("support-cancel").click();

  // A visible top edge wins over the face underneath it.
  await page.mouse.move(600, 356);
  await expect(canvas).toHaveAttribute("data-hover-kind", "edge");
  await page.mouse.click(600, 356);
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-kind",
    "edge",
  );
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-id",
    /^edge-/,
  );

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("body-pick")).toHaveCount(0);
});

test("the example reuses one sketch for independent extruded regions", async ({
  app: page,
}) => {
  const errors = collectErrors(page);

  // The example ships a suppressed "Center pin": a second extrude from Sketch 1
  // that uses the central hole's void region instead of the plate's material.
  const pin = page
    .locator('[data-feature-type="extrude"]')
    .filter({ hasText: "Center pin" });
  await expect(pin).toHaveCount(1);
  await expect(pin).toHaveAttribute("data-status", "skipped");

  await pin.click();
  await page.getByTestId("feature-suppress").click();

  const plate = 60 * 40 * 12 - Math.PI * 8 * 8 * 12;
  const pinVolume = Math.PI * 8 * 8 * 20;
  await expect.poll(() => volume(page)).toBeCloseTo(plate + pinVolume, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,60,40,20");

  const readExtrudes = () =>
    page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem("cad.doc") ?? "{}");
      return doc.features
        .filter((feature: { type: string }) => feature.type === "extrude")
        .map((feature: { name: string; regions: string[] }) => ({
          name: feature.name,
          regions: feature.regions,
        }));
    });
  const before: { name: string; regions: string[] }[] = await readExtrudes();
  expect(before.find((feature) => feature.name === "Extrude 1")?.regions).toEqual(
    [],
  );
  expect(before.find((feature) => feature.name === "Center pin")?.regions).toHaveLength(
    1,
  );

  // With two active extrudes consuming Sketch 1, region editing from the sketch
  // is ambiguous. It must not silently edit the first extrude.
  await page.getByTestId("timeline-sketch").click();
  await expect(page.getByTestId("timeline")).toHaveAttribute(
    "data-active-extrude",
    "",
  );
  await expect(page.getByTestId("region-panel")).toHaveCount(0);

  await page.getByTestId("tool-select").click();
  await clickSketch(page, 10, 10);
  await clickSketch(page, 30, 20);
  await expect(await readExtrudes()).toEqual(before);
  await expect.poll(() => volume(page)).toBeCloseTo(plate + pinVolume, -1);

  expect(errors).toEqual([]);
});

test("selects a hole as its own extrusion profile", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // The demo is a 60x40 plate with a centered Ø16 hole: both faces are profiles.
  await expect(page.locator("[data-region-id]")).toHaveCount(2);
  await expect(page.locator('[data-region-kind="void"]')).toHaveCount(1);

  await page.getByTestId("tool-select").click();

  // A new extrude starts empty: the profile must be chosen explicitly.
  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeDisabled();

  // Inside the hole but clear of its rim and the construction diagonal.
  await clickSketch(page, 30, 25);
  await expect(page.getByTestId("region-panel")).toContainText(
    "1 of 2 regions · void",
  );
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();

  await page.getByTestId("extrude-apply").click();
  // Join fills the existing Ø16 hole, so the plate becomes solid.
  await expect.poll(() => volume(page)).toBeCloseTo(60 * 40 * 12, -1);
  await expect(page.locator("[data-feature-id]")).toHaveCount(6);
  await expect(
    page.locator('[data-feature-type="extrude"]').last(),
  ).toContainText("Extrude 4");

  expect(errors).toEqual([]);
});

test("a polygon crossing the example keeps every profile selectable", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // A four-sided polygon crossing both the plate boundary and the central hole.
  await page.getByTestId("tool-line").click();
  for (const [x, y] of [
    [-10, 20],
    [32, 47],
    [69, 27.5],
    [46, -7],
    [-10, 20],
  ] as const) {
    await clickSketch(page, x, y);
  }
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-region-id]")).toHaveCount(10);
  await expect(page.locator('[data-region-kind="void"]')).toHaveCount(1);
  // Wait for the debounced rebuild of the polygon-split base before measuring.
  await expect.poll(() => volume(page)).toBeLessThan(24000);
  const before = await volume(page);

  // Starting the extrude can be as direct as clicking a profile in the sketch.
  await expect(page.getByTestId("extrude-apply")).toHaveCount(0);
  await clickSketch(page, -5, 20);
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await expect(page.getByTestId("region-panel")).toContainText("1 of 10 regions");

  // The central hole is still a selectable void profile through the arrangement.
  await clickSketch(page, 30, 20);
  await expect(page.getByTestId("region-panel")).toContainText(
    "1 of 10 regions · void",
  );
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-apply").click();

  // Join fills the Ø16 hole with the new cylinder; the base region itself
  // changes because the polygon splits it, so compare against the pre-extrude
  // volume rather than the original plate.
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(before + Math.PI * 8 * 8 * 12, -1);
  await expect(page.locator("[data-feature-id]")).toHaveCount(6);
  await expect(
    page.locator('[data-feature-type="extrude"]').last(),
  ).toContainText("Extrude 4");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});

test("selects narrow profile slivers when a diamond crosses the example", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // The diamond from the reported sketch: narrow slivers where a sketch-mode
  // click would otherwise hit a line's 12 px hit target first.
  await page.getByTestId("tool-line").click();
  for (const [x, y] of [
    [-10, 12.5],
    [24, 48],
    [72, 12.5],
    [22, -12],
    [-10, 12.5],
  ] as const) {
    await clickSketch(page, x, y);
  }
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-region-id]")).toHaveCount(10);
  await expect(page.locator('[data-region-kind="void"]')).toHaveCount(1);
  await expect.poll(() => volume(page)).toBeLessThan(24000);
  const before = await volume(page);

  // Profile mode raises the region hit layer above geometry, so the narrow
  // left sliver is selectable even though it lies next to a line.
  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await clickSketch(page, -5, 12.5);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 10 regions");

  await clickSketch(page, 30, 20);
  await expect(page.getByTestId("region-panel")).toContainText(
    "1 of 10 regions · void",
  );
  await page.getByTestId("extrude-apply").click();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(before + Math.PI * 8 * 8 * 12, -1);
  expect(errors).toEqual([]);
});

test("selects, multi-selects, and deletes sketch geometry", async ({ app: page }) => {
  const errors = collectErrors(page);

  const stats = page.getByTestId("mesh-stats");
  await expect(stats).toBeVisible();
  const initialVolume = await volume(page);
  expect(initialVolume).toBeGreaterThan(0);

  await enterSketch(page);
  const panel = page.getByTestId("selection-panel");

  // The demo's bottom edge runs from (0, 0) to (60, 0).
  await clickSketch(page, 30, 0);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Line");
  await expect(panel).toContainText("60 mm");

  await page.keyboard.press("Delete");
  await expect(panel).toHaveCount(0);
  // The hole circle is still a closed region, so deleting the plate's edges
  // turns the circle into the body.
  await expect.poll(() => volume(page)).toBeCloseTo(Math.PI * 8 * 8 * 12, -1);

  await page.keyboard.press("Control+z");
  await expect.poll(() => volume(page)).toBeCloseTo(initialVolume, -1);

  // Shift-click adds the right edge to the selection.
  await clickSketch(page, 30, 0);
  await page.keyboard.down("Shift");
  await clickSketch(page, 60, 20);
  await page.keyboard.up("Shift");
  await expect(panel).toHaveAttribute("data-count", "2");
  await expect(panel).toContainText("2 selected");

  await page.getByTestId("delete-selection").click();
  await expect(panel).toHaveCount(0);
  await expect.poll(() => volume(page)).toBeCloseTo(Math.PI * 8 * 8 * 12, -1);

  await page.keyboard.press("Control+z");
  await expect.poll(() => volume(page)).toBeCloseTo(initialVolume, -1);

  expect(errors).toEqual([]);
});

test("extrudes a lone circle as a cylinder", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-circle").click();

  await clickSketch(page, 0, 0);
  await clickSketch(page, 20, 0);

  await expect.poll(() => volume(page)).toBeGreaterThan(0);

  // The circle's automatic diameter dimension is the label source.
  const label = page.locator("[data-dimension-id]").filter({ hasText: "⌀" });
  const text = await label.textContent();
  const diameter = Number((text ?? "").replace(/[^\d.]/g, ""));
  expect(diameter).toBeGreaterThan(0);

  const expected = Math.PI * (diameter / 2) ** 2 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect.poll(() => meshBounds(page)).toBe("-20,-20,0,20,20,12");
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute("data-faces", "3");

  expect(errors).toEqual([]);
});

test("uses a drawn inner rectangle as a hole", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();

  await dragSketch(page, [-40, -30], [40, 30]);
  const outerRect = await readProfileRect(page);
  const outerVolume =
    (outerRect.maxX - outerRect.minX) * (outerRect.maxY - outerRect.minY) * 12;
  // Wait for the new mesh, not the previous one still on screen.
  await expect.poll(() => volume(page)).toBeCloseTo(outerVolume, -1);

  await dragSketch(page, [-20, -15], [20, 15]);

  await expect.poll(() => volume(page)).not.toBeCloseTo(outerVolume, 0);

  // The inner rectangle's points are in sketch millimetres; read them and
  // verify the extruded volume is the plate minus the inner area.
  await page.keyboard.press("Escape");
  const innerArea = await page.evaluate(() => {
    const handles = [...document.querySelectorAll("[data-point-id]")].slice(-4);
    const points = handles.map((handle) => [
      Number(handle.getAttribute("cx")),
      Number(handle.getAttribute("cy")),
    ]);
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      area += a[0]! * b[1]! - b[0]! * a[1]!;
    }
    return Math.abs(area / 2);
  });
  expect(innerArea).toBeGreaterThan(0);

  const expected = outerVolume - innerArea * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect.poll(() => meshBounds(page)).toBe("-40,-30,0,40,30,12");
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "10",
  );

  expect(errors).toEqual([]);
});

test("creates, edits and deletes parametric dimensions", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -30], [40, 30]);
  await page.keyboard.press("Escape");

  const before = await readProfileRect(page);
  const height = before.maxY - before.minY;
  const width = before.maxX - before.minX;
  await expect.poll(() => volume(page)).toBeCloseTo(width * height * 12, -1);
  const volumeBefore = await volume(page);
  expect(volumeBefore).toBeGreaterThan(0);
  await expect(page.getByTestId("dof")).toContainText("4 DOF");

  await page.getByTestId("tool-select").click();
  await clickSketch(page, (before.minX + before.maxX) / 2, before.minY);
  await page.getByTestId("tool-dimension").click();
  await expect(page.getByTestId("reference-toggle")).toBeVisible();
  await clickSketch(page, (before.minX + before.maxX) / 2 + 10, before.minY + 14);

  const widthLabel = page
    .locator("[data-dimension-id]")
    .filter({ hasText: String(Math.round(width)) });
  await expect(widthLabel).toBeVisible();
  await expect(page.getByTestId("dof")).toContainText("3 DOF");

  await widthLabel.dblclick();
  await page.getByTestId("dimension-input").fill("100");
  await page.getByTestId("dimension-input").press("Enter");

  await expect.poll(() => volume(page)).toBeCloseTo(100 * height * 12, -1);

  // A reference dimension measures without constraining.
  const resized = await readProfileRect(page);
  await clickSketch(page, resized.maxX, (resized.minY + resized.maxY) / 2);
  await page.getByTestId("tool-dimension").click();
  await expect(page.getByTestId("reference-toggle")).toBeVisible();
  await page.getByTestId("reference-toggle").check();
  await clickSketch(page, resized.maxX + 14, (resized.minY + resized.maxY) / 2 + 10);
  await expect(page.getByTestId("dof")).toContainText("3 DOF");
  await expect(page.locator("[data-dimension-id]")).toHaveCount(2);

  // Deleting the driving dimension frees the width again.
  await page.locator("[data-dimension-id]").filter({ hasText: "100" }).dblclick();
  await page.getByTestId("dimension-delete").click();
  await expect(page.getByTestId("dof")).toContainText("4 DOF");
  await expect(page.locator("[data-dimension-id]")).toHaveCount(1);

  expect(errors).toEqual([]);
});

test("applies constraints and construction from the floating bar", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-line").click();

  // Two separate, deliberately non-axis-aligned lines (8 DOF total).
  await clickSketch(page, -40, -25);
  await dblclickSketch(page, 40, -15);
  await clickSketch(page, -40, 20);
  await dblclickSketch(page, 40, 10);
  await page.keyboard.press("Escape");

  await clickSketch(page, 0, -20);
  await page.keyboard.down("Shift");
  await clickSketch(page, 0, 15);
  await page.keyboard.up("Shift");

  await expect(page.getByTestId("selection-panel")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("dof")).toContainText("8 DOF");

  await page.getByTestId("constraint-perpendicular").click();
  await expect(page.getByTestId("dof")).toContainText("7 DOF");
  await expect(page.locator('[data-constraint-type="perpendicular"]')).toHaveCount(2);

  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("dof")).toContainText("8 DOF");
  await expect(page.locator('[data-constraint-type="perpendicular"]')).toHaveCount(0);

  // Construction geometry: the same selection is still active.
  await page.getByTestId("toggle-construction").click();
  await expect(page.getByTestId("toggle-construction")).toContainText("Make normal");

  expect(errors).toEqual([]);
});

test("finishes an open line with Enter and cancels with Escape", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-line").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 30, 0);
  await page.keyboard.press("Enter");

  const lines = page.locator("line[data-geometry-id]");
  await expect(lines).toHaveCount(1);
  await expect(page.getByTestId("tool-line")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("Enter");
  await expect(lines).toHaveCount(1);

  // A lone draft point is cancelled, not committed.
  await clickSketch(page, 0, 10);
  await page.keyboard.press("Escape");
  await expect(lines).toHaveCount(1);

  expect(errors).toEqual([]);
});

test("drags a line as a whole", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-line").click();
  await clickSketch(page, -40, -20);
  await dblclickSketch(page, 40, 20);
  await page.keyboard.press("Escape");

  const readLine = () =>
    page.locator("[data-geometry-id]").evaluate((element) => ({
      x1: Number(element.getAttribute("x1")),
      y1: Number(element.getAttribute("y1")),
      x2: Number(element.getAttribute("x2")),
      y2: Number(element.getAttribute("y2")),
    }));

  const before = await readLine();
  await dragSketch(page, [0, 0], [20, 10]);
  const after = await readLine();

  expect(after.x1 - before.x1).toBeCloseTo(20, 0);
  expect(after.y1 - before.y1).toBeCloseTo(10, 0);
  expect(after.x2 - before.x2).toBeCloseTo(20, 0);
  expect(after.y2 - before.y2).toBeCloseTo(10, 0);

  expect(errors).toEqual([]);
});

test("draws a three-point arc and drags it", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-arc").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 40, 10);
  await clickSketch(page, 20, 20);
  await page.keyboard.press("Escape");

  const path = page.locator("[data-geometry-id]");
  await expect(path).toHaveCount(1);
  const before = await path.getAttribute("d");
  expect(before).toContain("A");

  await dragSketch(page, [20, 20], [30, 25]);
  const after = await page.locator("[data-geometry-id]").getAttribute("d");
  expect(after).not.toBe(before);

  expect(errors).toEqual([]);
});

test("rounds a rectangle corner with a parametric fillet", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -30], [40, 30]);
  await page.keyboard.press("Escape");

  // Select the left and bottom edges: they share the bottom-left corner.
  await clickSketch(page, -40, 0);
  await page.keyboard.down("Shift");
  await clickSketch(page, 0, -30);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection-panel")).toHaveAttribute("data-count", "2");

  await page.getByTestId("open-fillet").click();

  await page.getByTestId("fillet-radius").fill("10");
  await page.getByTestId("constraint-fillet").click();

  await expect(page.locator("[data-geometry-id]")).toHaveCount(5);
  await expect(page.locator('[data-constraint-type="tangent"]')).toHaveCount(4);

  await page.getByTestId("timeline-extrude").click();
  const cut = 10 * 10 - Math.PI * 10 * 10 / 4;
  await expect.poll(() => volume(page)).toBeCloseTo((80 * 60 - cut) * 12, -1);

  expect(errors).toEqual([]);
});

test("drives an angle dimension and a radius dimension", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-line").click();
  await clickSketch(page, 0, 0);
  await dblclickSketch(page, 60, 0);
  await clickSketch(page, 0, 0);
  await dblclickSketch(page, 50, 30);
  await page.keyboard.press("Escape");

  await page.getByTestId("tool-select").click();
  await clickSketch(page, 30, 0);
  await page.keyboard.down("Shift");
  await clickSketch(page, 25, 15);
  await page.keyboard.up("Shift");
  await page.getByTestId("tool-dimension").click();
  await expect(page.getByTestId("reference-toggle")).toBeVisible();
  await clickSketch(page, 20, 45);

  const angleLabel = page.locator("[data-dimension-id]").filter({ hasText: "°" });
  await expect(angleLabel).toHaveCount(1);
  await angleLabel.dblclick();
  await page.getByTestId("dimension-input").fill("45");
  await page.getByTestId("dimension-input").press("Enter");
  await expect(page.locator("[data-dimension-id]").filter({ hasText: "45°" })).toHaveCount(1);

  // Moving the label does not change the measurement.
  const box = await page.locator("[data-dimension-id]").first().boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2 + 30, {
      steps: 6,
    });
    await page.mouse.up();
  }
  const movedBox = await page.locator("[data-dimension-id]").first().boundingBox();
  expect(movedBox).not.toBeNull();
  if (box && movedBox) {
    expect(
      Math.hypot(movedBox.x - box.x, movedBox.y - box.y),
    ).toBeGreaterThan(5);
  }
  await expect(page.locator("[data-dimension-id]").filter({ hasText: "45°" })).toHaveCount(1);

  // Radius dimensions display and edit the radius, not the diameter.
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 20, 0);
  await page.keyboard.press("Escape");

  await page.getByTestId("tool-select").click();
  await clickSketch(page, 20, 0);
  await page.getByTestId("dimension-radius").click();
  await expect(page.getByTestId("reference-toggle")).toBeVisible();
  await clickSketch(page, 40, 10);
  const radiusLabel = page.locator("[data-dimension-id]").filter({ hasText: "R" });
  await expect(radiusLabel).toHaveCount(1);
  await radiusLabel.dblclick();
  await page.getByTestId("dimension-input").fill("25");
  await page.getByTestId("dimension-input").press("Enter");
  await expect(page.locator("[data-dimension-id]").filter({ hasText: "R 25" })).toHaveCount(1);

  // Radius/diameter labels are draggable without changing the measurement.
  const radiusBox = await radiusLabel.boundingBox();
  expect(radiusBox).not.toBeNull();
  if (radiusBox) {
    await page.mouse.move(
      radiusBox.x + radiusBox.width / 2,
      radiusBox.y + radiusBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      radiusBox.x + radiusBox.width / 2 - 30,
      radiusBox.y + radiusBox.height / 2 + 20,
      { steps: 6 },
    );
    await page.mouse.up();
  }
  const movedRadius = await radiusLabel.boundingBox();
  expect(movedRadius).not.toBeNull();
  if (radiusBox && movedRadius) {
    expect(
      Math.hypot(movedRadius.x - radiusBox.x, movedRadius.y - radiusBox.y),
    ).toBeGreaterThan(5);
  }
  await expect(page.locator("[data-dimension-id]").filter({ hasText: "R 25" })).toHaveCount(1);

  await page.getByTestId("timeline-extrude").click();
  await expect.poll(() => volume(page)).toBeCloseTo(Math.PI * 25 * 25 * 12, -1);

  expect(errors).toEqual([]);
});

test("drags dimension labels along a line and by radial distance", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  // A linear label can move toward either endpoint, not only sideways.
  await page.getByTestId("tool-line").click();
  await clickSketch(page, 0, 0);
  await dblclickSketch(page, 60, 0);
  await page.keyboard.press("Escape");

  await page.getByTestId("tool-select").click();
  await clickSketch(page, 30, 0);
  await page.getByTestId("tool-dimension").click();
  await expect(page.getByTestId("reference-toggle")).toBeVisible();
  await clickSketch(page, 30, 15);

  const lengthLabel = page
    .locator("[data-dimension-id]")
    .filter({ hasText: "60" });
  await expect(lengthLabel).toHaveCount(1);
  const before = await lengthLabel.boundingBox();
  if (!before) throw new Error("Could not locate the length label");
  await page.mouse.move(
    before.x + before.width / 2,
    before.y + before.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    before.x + before.width / 2 + 60,
    before.y + before.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  const after = await lengthLabel.boundingBox();
  if (!after) throw new Error("Could not locate the moved length label");
  expect(after.x).toBeGreaterThan(before.x + 10);
  await expect(lengthLabel).toHaveCount(1);

  // A radial label can move outward along its leader, not only around the arc.
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 20, 0);
  await page.keyboard.press("Escape");

  await page.getByTestId("tool-select").click();
  await clickSketch(page, 20, 0);
  await page.getByTestId("dimension-radius").click();
  await expect(page.getByTestId("reference-toggle")).toBeVisible();
  await clickSketch(page, 40, 10);

  const radiusLabel = page.locator("[data-dimension-id]").filter({ hasText: "R" });
  await expect(radiusLabel).toHaveCount(1);
  const center = await sketchPoint(page, 0, 0);
  const radiusBefore = await radiusLabel.boundingBox();
  if (!radiusBefore) throw new Error("Could not locate the radius label");
  const distanceBefore = Math.hypot(
    radiusBefore.x + radiusBefore.width / 2 - center.x,
    radiusBefore.y + radiusBefore.height / 2 - center.y,
  );
  await page.mouse.move(
    radiusBefore.x + radiusBefore.width / 2,
    radiusBefore.y + radiusBefore.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    radiusBefore.x + radiusBefore.width / 2 + 80,
    radiusBefore.y + radiusBefore.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  const radiusAfter = await radiusLabel.boundingBox();
  if (!radiusAfter) throw new Error("Could not locate the moved radius label");
  const distanceAfter = Math.hypot(
    radiusAfter.x + radiusAfter.width / 2 - center.x,
    radiusAfter.y + radiusAfter.height / 2 - center.y,
  );
  expect(distanceAfter).toBeGreaterThan(distanceBefore + 10);
  await expect(radiusLabel).toHaveCount(1);

  expect(errors).toEqual([]);
});

test("removes an applied constraint from the line selection", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  const horizontal = page.locator('[data-constraint-type="horizontal"]');
  await expect(horizontal).toHaveCount(2);

  await page.getByTestId("tool-select").click();
  await clickSketch(page, 30, 40);
  const chip = page.getByTestId("constraint-horizontal");
  await expect(chip).toHaveClass(/is-on/);
  await chip.click();
  await expect(horizontal).toHaveCount(1);

  await page.getByTestId("undo").click();
  await expect(horizontal).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("clears a conflict when a conflicting constraint is released", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("tool-select").click();
  await clickSketch(page, 60, 20);

  const horizontal = page.getByTestId("constraint-horizontal");
  const vertical = page.getByTestId("constraint-vertical");
  await expect(vertical).toHaveClass(/is-on/);
  await horizontal.click();
  await expect(page.getByTestId("dof")).toContainText("Conflicting constraints");
  await expect(horizontal).toHaveClass(/is-on/);
  await horizontal.click();
  await expect(page.getByTestId("dof")).not.toContainText("Conflicting constraints");
  await expect(page.locator('[data-constraint-type="horizontal"]')).toHaveCount(2);
  await expect(vertical).toHaveClass(/is-on/);
  expect(errors).toEqual([]);
});

test("clicking outside a selection clears it before starting a draft", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("tool-select").click();

  await clickSketch(page, 30, 40);
  await expect(page.getByTestId("selection-panel")).toHaveCount(1);

  // A filled region is outside the selected line: the first click deselects.
  await clickSketch(page, 10, 20);
  await expect(page.getByTestId("selection-panel")).toHaveCount(0);
  await expect(page.getByTestId("extrude-draft-popover")).toHaveCount(0);

  // With nothing selected, the same click starts an explicit extrude draft.
  await clickSketch(page, 10, 20);
  await expect(page.getByTestId("extrude-draft-popover")).toHaveCount(1);

  // Clicking the empty grid cancels the draft and leaves the sketch open.
  await clickSketch(page, 70, 20);
  await expect(page.getByTestId("extrude-draft-popover")).toHaveCount(0);
  await expect(page.getByTestId("tool-select")).toBeVisible();

  expect(errors).toEqual([]);
});

test("extrudes a filleted profile with a circular hole", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -30], [40, 30]);
  await page.keyboard.press("Escape");

  await clickSketch(page, -40, 0);
  await page.keyboard.down("Shift");
  await clickSketch(page, 0, -30);
  await page.keyboard.up("Shift");
  await page.getByTestId("open-fillet").click();
  await page.getByTestId("fillet-radius").fill("10");
  await page.getByTestId("constraint-fillet").click();

  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 20, 0);
  await page.keyboard.press("Escape");

  await page.getByTestId("timeline-extrude").click();
  const cut = 10 * 10 - Math.PI * 10 * 10 / 4;
  const hole = Math.PI * 20 * 20;
  await expect.poll(() => volume(page)).toBeCloseTo((80 * 60 - cut - hole) * 12, -1);

  expect(errors).toEqual([]);
});

test("filleting the demo's origin corner keeps the diagonal and anchor", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // The demo starts with the origin at its top-left corner. Filleting that
  // corner is the interesting case: the construction diagonal and the origin
  // coincidence both use that point.
  await clickSketch(page, 30, 0);
  await page.keyboard.down("Shift");
  await clickSketch(page, 0, 20);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection-panel")).toHaveAttribute("data-count", "2");

  await page.getByTestId("open-fillet").click();

  await page.getByTestId("fillet-radius").fill("5");
  await page.getByTestId("constraint-fillet").click();

  // The old corner stays as a construction intersection, so no re-anchor
  // prompt is needed and the demo remains fully constrained.
  await expect(page.getByTestId("dof")).toContainText("Fully constrained");

  const diagonal = page.locator('[data-geometry-id="diagonal"]');
  await expect(diagonal).toHaveCount(1);
  const ends = await diagonal.evaluate((element) => [
    [Number(element.getAttribute("x1")), Number(element.getAttribute("y1"))],
    [Number(element.getAttribute("x2")), Number(element.getAttribute("y2"))],
  ]);
  expect(
    ends.some(([x, y]) => Math.abs(x!) < 1e-6 && Math.abs(y!) < 1e-6),
  ).toBe(true);

  expect(errors).toEqual([]);
});

test("edits a point's x/y to exact values", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-line").click();
  await clickSketch(page, -40, -20);
  await dblclickSketch(page, 40, 20);
  await page.keyboard.press("Escape");

  await clickSketch(page, 40, 20);
  await expect(page.getByTestId("point-position")).toBeVisible();
  await page.getByTestId("point-x").fill("60");
  await page.getByTestId("point-y").fill("30");
  await page.getByTestId("point-y").press("Enter");

  const ends = await page.locator("[data-geometry-id]").evaluate((element) => [
    [
      Number(element.getAttribute("x1")),
      Number(element.getAttribute("y1")),
    ],
    [
      Number(element.getAttribute("x2")),
      Number(element.getAttribute("y2")),
    ],
  ]);
  expect(ends).toEqual(
    expect.arrayContaining([
      [60, 30],
      [-40, -20],
    ]),
  );
  expect(errors).toEqual([]);
});

test("places, selects and undoes standalone sketch points", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-point").click();
  await clickSketch(page, 10, 10);
  await clickSketch(page, 40, 30);
  await expect(page.locator('[data-standalone="true"]')).toHaveCount(2);

  await page.getByTestId("tool-select").click();
  await clickSketch(page, 10, 10);
  await expect(page.getByTestId("selection-panel")).toContainText("Point");
  await expect(page.getByTestId("point-position")).toBeVisible();

  await page.getByTestId("undo").click();
  await expect(page.locator('[data-standalone="true"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("uses an adaptive or free-form sketch grid", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await expect(page.locator("canvas.viewport-canvas")).toHaveAttribute(
    "data-sketch-overlay",
    "off",
  );

  const grid = page.getByTestId("grid-step");
  const autoStep = Number(await grid.inputValue());
  expect(autoStep).toBeGreaterThan(0);
  await expect(page.getByTestId("grid-scale")).toBeVisible();

  await grid.fill("5");
  await expect(grid).toHaveValue("5");
  await page.getByTestId("grid-auto").click();

  const snap = page.getByTestId("snap-toggle");
  await expect(snap).toContainText("snap on");
  await snap.click();
  await expect(snap).toContainText("snap off");

  // A large zoom-out resolves a new adaptive step and keeps the input valid.
  await page.mouse.move(720, 420);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(async () => Number(await grid.inputValue()))
    .toBeGreaterThan(0);

  const canvas = page.locator("svg.sketch-canvas");
  const fitted = await canvas.getAttribute("viewBox");
  await page.getByTestId("zoom-select").selectOption("200");
  await expect.poll(async () => canvas.getAttribute("viewBox")).not.toBe(fitted);
  await page.getByTestId("zoom-select").selectOption("fit");
  expect(errors).toEqual([]);
});

test("finishes the active sketch with Enter", async ({ app: page }) => {
  await enterSketch(page);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tool-select")).toBeHidden();
  await expect(page.getByTestId("edit-feature")).toBeVisible();
  await expect(page.getByTestId("timeline-detail")).toContainText("12 mm");
  await expect(page.getByTestId("timeline")).toHaveAttribute(
    "data-active-extrude",
    /.+/,
  );
});

test("uses the fixed origin and X axis as references", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-line").click();
  await clickSketch(page, 10, 10);
  await dblclickSketch(page, 50, 10);
  await page.keyboard.press("Escape");

  // Coincident with the origin.
  await clickSketch(page, 10, 10);
  await page.keyboard.down("Shift");
  await clickSketch(page, 0, 0);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection-panel")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("selection-panel")).toContainText("Origin");
  await page.getByTestId("constraint-coincident").click();

  const afterOrigin = await page.locator("[data-geometry-id]").evaluate((element) => [
    [Number(element.getAttribute("x1")), Number(element.getAttribute("y1"))],
    [Number(element.getAttribute("x2")), Number(element.getAttribute("y2"))],
  ]);
  expect(
    afterOrigin.some(([x, y]) => Math.abs(x!) < 1e-6 && Math.abs(y!) < 1e-6),
  ).toBe(true);

  // Constrain the other endpoint to the X axis. Start from a clean sketch:
  // undoing only the coincidence would leave the first line behind.
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-line").click();
  await clickSketch(page, 10, 10);
  await dblclickSketch(page, 50, 10);
  await page.keyboard.press("Escape");
  await clickSketch(page, 10, 10);
  await page.keyboard.down("Shift");
  await clickSketch(page, 30, 0);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection-panel")).toContainText("X axis");
  await page.getByTestId("constraint-pointOnLine").click();

  const afterAxis = await page.locator("[data-geometry-id]").evaluate((element) => [
    [Number(element.getAttribute("x1")), Number(element.getAttribute("y1"))],
    [Number(element.getAttribute("x2")), Number(element.getAttribute("y2"))],
  ]);
  expect(afterAxis.every(([, y]) => Math.abs(y!) < 1e-6)).toBe(true);

  expect(errors).toEqual([]);
});

test("selects and fuses multiple sketch regions", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -20], [-10, 20]);
  await dragSketch(page, [10, -20], [40, 20]);
  await page.keyboard.press("Escape");

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-profiles").click();
  await expect(page.getByTestId("region-panel")).toBeVisible();
  await clickSketch(page, -25, -10);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 2 regions");
  await expect.poll(() => volume(page)).toBeCloseTo(30 * 40 * 12, -1);

  await page.getByTestId("all-regions").click();
  await expect(page.getByTestId("region-panel")).toContainText("2 of 2 regions");
  await expect.poll(() => volume(page)).toBeCloseTo(2 * 30 * 40 * 12, -1);

  await page.getByTestId("auto-region").click();
  await expect(page.getByTestId("region-panel")).toContainText("auto");
  await expect.poll(() => volume(page)).toBeCloseTo(30 * 40 * 12, -1);
  await page.getByTestId("finish-sketch").click();

  expect(errors).toEqual([]);
});

test("box-selects profile regions", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -20], [-10, 20]);
  await dragSketch(page, [10, -20], [40, 20]);
  await page.keyboard.press("Escape");

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-profiles").click();
  await page.getByTestId("tool-box").click();
  await dragSketch(page, [-45, -25], [45, 25]);
  await expect(page.getByTestId("region-panel")).toContainText("2 of 2 regions");
  await expect.poll(() => volume(page)).toBeCloseTo(2 * 30 * 40 * 12, -1);

  // Replacing the selection with a box around one profile.
  await page.getByTestId("tool-box").click();
  await dragSketch(page, [-45, -25], [-9, 25]);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 2 regions");
  await expect.poll(() => volume(page)).toBeCloseTo(30 * 40 * 12, -1);
  expect(errors).toEqual([]);
});

test("lasso-selects profile regions", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -20], [-10, 20]);
  await dragSketch(page, [10, -20], [40, 20]);
  await page.keyboard.press("Escape");

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-profiles").click();
  await page.getByTestId("tool-lasso").click();
  await lassoSketch(page, [
    [-50, -30],
    [50, -30],
    [50, 30],
    [-50, 30],
  ]);
  await expect(page.getByTestId("region-panel")).toContainText("2 of 2 regions");
  await expect.poll(() => volume(page)).toBeCloseTo(2 * 30 * 40 * 12, -1);

  // A lasso that only touches the right profile's top-right corner selects it.
  await page.getByTestId("tool-lasso").click();
  await lassoSketch(page, [
    [35, 15],
    [45, 15],
    [45, 25],
    [35, 25],
  ]);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 2 regions");
  await expect.poll(() => volume(page)).toBeCloseTo(30 * 40 * 12, -1);

  // An empty lasso is a no-op; it must not fall back to the largest profile.
  await page.getByTestId("tool-lasso").click();
  await lassoSketch(page, [
    [-5, 30],
    [5, 30],
    [5, 40],
    [-5, 40],
  ]);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 2 regions");
  expect(errors).toEqual([]);
});

test("splits a circle crossed by a line into selectable halves", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 20, 0);
  await page.getByTestId("tool-line").click();
  await clickSketch(page, -30, 0);
  await clickSketch(page, 30, 0);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-region-id]")).toHaveCount(2);
  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-profiles").click();
  await page.getByTestId("tool-select").click();
  // Top half, clear of the axes and the chord.
  await clickSketch(page, 10, 10);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 2 regions");

  const halfCylinder = (Math.PI * 20 * 20 * 12) / 2;
  await expect.poll(() => volume(page)).toBeCloseTo(halfCylinder, -1);

  expect(errors).toEqual([]);
});

test("splits crossing diagonals into four selectable regions", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -20], [40, 20]);
  await page.keyboard.press("Escape");

  await page.getByTestId("tool-line").click();
  await clickSketch(page, -40, -20);
  await clickSketch(page, 40, 20);
  await page.keyboard.press("Enter");
  await clickSketch(page, -40, 20);
  await clickSketch(page, 40, -20);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-region-id]")).toHaveCount(4);

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-profiles").click();
  await page.getByTestId("tool-select").click();
  await clickSketch(page, 20, -15);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 4 regions");

  // Each triangle is half of an 80x40 half-rectangle.
  await expect.poll(() => volume(page)).toBeCloseTo((80 * 40 * 12) / 4, -1);

  expect(errors).toEqual([]);
});

test("trims a split segment and rebuilds the profile", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -20], [40, 20]);
  await page.keyboard.press("Escape");

  await page.getByTestId("tool-line").click();
  await clickSketch(page, 0, -20);
  await dblclickSketch(page, 0, 20);
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-region-id]")).toHaveCount(2);

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-profiles").click();
  await page.getByTestId("tool-select").click();
  await clickSketch(page, 20, 10);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 2 regions");
  await expect.poll(() => volume(page)).toBeCloseTo(40 * 40 * 12, -1);

  await page.getByTestId("timeline-sketch").click();
  await clickSketch(page, 0, 10);
  await page.getByTestId("tool-trim").click();
  await clickSketch(page, 0, 10);
  await expect(page.locator("[data-region-id]")).toHaveCount(1);

  await page.getByTestId("timeline-extrude").click();
  await expect.poll(() => volume(page)).toBeCloseTo(80 * 40 * 12, -1);

  await page.keyboard.press("Control+z");
  await expect.poll(() => volume(page)).toBeCloseTo(40 * 40 * 12, -1);

  expect(errors).toEqual([]);
});

test("autosaves the document and reopens it", async ({ app: page }) => {
  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("edit-feature").click();
  await setSlider(page.getByTestId("height-slider"), 20);
  await page.getByTestId("feature-popover-apply").click();
  const plate = 60 * 40 * 20 - Math.PI * 8 * 8 * 20;
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("cad.doc");
        if (!raw) return null;
        const doc = JSON.parse(raw);
        return doc.features.find(
          (feature: { type: string }) => feature.type === "extrude",
        )?.height;
      }),
    )
    .toBe(20);

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("cad.doc");
    return raw ? JSON.parse(raw) : null;
  });
  expect(stored?.schemaVersion).toBe(8);

  // A new document in the same context reads the saved part, migrates it, and
  // rebuilds the same solid.
  const second = await page.context().newPage();
  await second.goto("/");
  await expect(second.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(second.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(second.getByTestId("timeline-detail")).toContainText("20 mm");
  await expect.poll(() => volume(second)).toBeCloseTo(plate, -1);
  await second.close();

  await page.getByTestId("edit-feature").click();
  await setSlider(page.getByTestId("height-slider"), 12);
  await page.getByTestId("feature-popover-apply").click();
});

test("rebuilds the reported circle-through-hole part without an invalid profile", async ({
  browser,
}) => {
  const doc = readFileSync(
    new URL(
      "../src/core/sketch/__fixtures__/circle-through-hole.cad.json",
      import.meta.url,
    ),
    "utf8",
  );
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, doc);
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("mesh-stats")).toBeVisible();
  await expect.poll(() => volume(page)).toBeGreaterThan(0);
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  // The old region id is invalid, so the engine visibly falls back instead of
  // sending an invalid profile to the kernel.
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "title",
    /stored region selection no longer exists/,
  );
  await context.close();
});

test("creates a new sketch and a joining extrude", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [0, 0], [40, 20]);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();
  await expect.poll(() => volume(page)).toBeCloseTo(40 * 20 * 12, -1);

  await createSketch(page);
  await expect(page.locator("[data-feature-id]")).toHaveCount(6);
  await expect(
    page
      .locator('[data-feature-type="sketch"]')
      .filter({ hasText: "Sketch 3" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("tool-select")).toBeVisible();

  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [40, 0], [80, 20]);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();

  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeDisabled();
  await clickSketch(page, 60, 10);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-apply").click();
  await expect(page.locator("[data-feature-id]")).toHaveCount(7);
  await expect(
    page.locator('[data-feature-type="extrude"]').last(),
  ).toContainText("Extrude 4");
  await expect.poll(() => volume(page)).toBeCloseTo(80 * 20 * 12, -1);
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});

test("new extrude picks profiles from the selected sketch", async ({ app: page }) => {
  // Selection is explicit: choose the sketch first, then extrude it.
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Mounting holes" })
    .click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeDisabled();
  await expect(page.getByTestId("region-panel")).toContainText("select profiles");

  await clickSketch(page, 12, 20);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 2 regions");
  await page.keyboard.down("Shift");
  await clickSketch(page, 48, 20);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("region-panel")).toContainText("2 of 2 regions");
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();

  await page.getByTestId("extrude-operation").selectOption("cut");
  await page.getByTestId("extrude-end").selectOption("throughAll");
  await page.getByTestId("extrude-apply").click();

  const expected =
    60 * 40 * 12 - Math.PI * 8 * 8 * 12 - 2 * Math.PI * 3 * 3 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect(
    page.locator('[data-feature-type="extrude"]').last(),
  ).toContainText("Extrude 4");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
});

test("edits, suppresses and deletes an extrude", async ({ app: page }) => {
  const plate12 = 60 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate12, -1);

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("edit-feature").click();
  await page.getByTestId("extrude-height").fill("30");
  const plate30 = 60 * 40 * 30 - Math.PI * 8 * 8 * 30;
  await expect.poll(() => volume(page)).toBeCloseTo(plate30, -1);

  await page.getByTestId("extrude-symmetric").click();
  await expect(page.getByTestId("extrude-symmetric")).toContainText("symmetric");
  await expect.poll(() => meshBounds(page)).toBe("0,0,-15,60,40,15");

  await page.getByTestId("extrude-operation").selectOption("join");
  await expect.poll(() => volume(page)).toBeCloseTo(plate30, -1);
  await page.getByTestId("extrude-operation").selectOption("new");

  await page.getByTestId("feature-popover-apply").click();
  await page.getByTestId("feature-suppress").click();
  await expect(page.getByTestId("timeline-extrude")).toHaveAttribute(
    "data-status",
    "skipped",
  );
  await expect(page.getByTestId("mesh-stats")).toHaveCount(0);
  await page.getByTestId("feature-suppress").click();
  await expect.poll(() => volume(page)).toBeCloseTo(plate30, -1);

  await page.getByTestId("feature-delete").click();
  await expect(page.locator("[data-feature-id]")).toHaveCount(4);
  await expect(page.getByTestId("timeline-extrude")).toHaveAttribute(
    "data-status",
    "skipped",
  );
  await page.getByTestId("undo").click();
  await expect(page.locator("[data-feature-id]")).toHaveCount(5);
  await expect.poll(() => volume(page)).toBeCloseTo(plate30, -1);
});

test("cancel restores the previous extrude and discards a draft", async ({
  app: page,
}) => {
  const plate12 = 60 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate12, -1);

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("edit-feature").click();
  await page.getByTestId("extrude-height").fill("30");
  await page.getByTestId("extrude-symmetric").click();
  const plate30 = 60 * 40 * 30 - Math.PI * 8 * 8 * 30;
  await expect.poll(() => volume(page)).toBeCloseTo(plate30, -1);
  await expect(page.getByTestId("feature-popover")).toContainText(
    "30 mm · new · symmetric · 1 region",
  );

  await page.getByTestId("feature-popover-cancel").click();
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  await expect.poll(() => volume(page)).toBeCloseTo(plate12, -1);
  await expect(page.getByTestId("timeline-detail")).toContainText("12 mm");
  await expect(page.getByTestId("timeline-detail")).toContainText("one side");

  // Cancel also leaves profile-selection mode and returns to the model.
  await page.getByTestId("edit-feature").click();
  await page.getByTestId("popover-select-profiles").click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await page.getByTestId("feature-popover-cancel").click();
  await expect(page.getByTestId("tool-select")).toBeHidden();

  // Cancelling a draft never creates a feature.
  await page.getByTestId("timeline-sketch").click();
  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.locator("[data-feature-id]")).toHaveCount(5);
  await page.getByTestId("extrude-cancel").click();
  await expect(page.getByTestId("extrude-draft-popover")).toHaveCount(0);
  await expect(page.locator("[data-feature-id]")).toHaveCount(5);
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await expect.poll(() => volume(page)).toBeCloseTo(plate12, -1);
});

test("downloads, renames and opens a .cad document", async ({ app: page }) => {
  await page.getByTestId("file-menu").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-doc").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Example.cad");

  await page.getByTestId("file-menu").click();
  await page.getByTestId("rename-doc").click();
  await page.getByTestId("doc-rename-input").fill("Bracket");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("file-menu")).toContainText("Bracket.cad");

  await page.getByTestId("file-open-input").setInputFiles({
    name: "part.cad",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(multiFeatureDoc())),
  });
  await expect(page.locator("[data-feature-id]")).toHaveCount(6);
  const expected = 80 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
});

test("reloading the example reuses its local file entry", async ({ app: page }) => {
  // The built-in example has a stable id, so a reload updates its local file
  // instead of piling up identical Example.cad rows.
  await page.getByTestId("timeline-sketch").click();
  await page.getByTestId("load-example").click();
  await page.waitForTimeout(400);
  await page.getByTestId("load-example").click();
  await page.waitForTimeout(400);
  await page.getByTestId("file-menu").click();
  const rows = page.getByTestId("local-file-list").locator(".file-entry");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Example.cad");
});

test("lists, copies and reopens local files", async ({ app: page }) => {
  await page.getByTestId("file-menu").click();
  await expect(page.getByTestId("local-file-list")).toContainText("Example.cad");
  await page.getByTestId("copy-doc").click();
  await expect(page.getByTestId("file-menu")).toContainText("Example copy.cad");

  await page.getByTestId("file-menu").click();
  await expect(page.getByTestId("local-file-list")).toContainText(
    "Example copy.cad",
  );
  await expect(page.getByTestId("local-file-list")).toContainText("Example.cad");
  await page
    .getByTestId("local-file-list")
    .getByText("Example.cad", { exact: true })
    .click();
  await expect(page.getByTestId("file-menu")).toContainText("Example.cad");

  // A non-current local file can be removed with an explicit confirm.
  await page.getByTestId("file-menu").click();
  const copyRow = page
    .locator(".file-entry")
    .filter({ hasText: "Example copy.cad" });
  await copyRow.getByRole("button", { name: "delete" }).click();
  await copyRow.getByRole("button", { name: "confirm" }).click();
  await expect(page.getByTestId("local-file-list")).not.toContainText(
    "Example copy.cad",
  );
});

test("builds a cut and join from a saved multi-feature document", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(multiFeatureDoc()));
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });

  // Union of the 0..60 plate and 40..80 extension, minus the Ø16 hole.
  const expected = 80 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,80,40,12");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );

  // The history lists the whole document, not just the first sketch/extrude.
  const timeline = page.getByTestId("timeline");
  await expect(page.locator("[data-feature-id]")).toHaveCount(6);
  const holeSketch = page.locator('[data-feature-id="sketch-2"]');
  const cut = page.locator('[data-feature-id="extrude-2"]');
  await expect(holeSketch).toContainText("Hole sketch");
  await expect(cut).toContainText("Cut 1");
  await expect(timeline).toHaveAttribute("data-active-feature", "extrude-1");

  // Selecting a later sketch edits that sketch; it does not silently take over
  // its consuming extrude. Select the extrude step for profile editing.
  await holeSketch.click();
  await expect(timeline).toHaveAttribute("data-active-feature", "sketch-2");
  await expect(timeline).toHaveAttribute("data-active-extrude", "");
  await expect(page.getByTestId("tool-select")).toBeVisible();

  // Double-click rename is an undoable feature edit, not a document swap.
  await holeSketch.dblclick();
  await expect(page.getByTestId("feature-rename")).toBeVisible();
  await page.getByTestId("feature-rename").fill("Hole profile");
  await page.keyboard.press("Enter");
  await expect(holeSketch).toContainText("Hole profile");
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);

  // Reorder a downstream sketch before the base includes it; the order is valid.
  await page
    .locator('[data-feature-id="sketch-3"]')
    .dragTo(page.locator('[data-feature-id="sketch-1"]'));
  await expect(page.locator("[data-feature-id]").first()).toHaveAttribute(
    "data-feature-id",
    "sketch-3",
  );
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);

  await page.getByTestId("timeline-extrude").click();
  await expect(timeline).toHaveAttribute("data-active-feature", "extrude-1");
  await expect(page.getByTestId("edit-feature")).toBeVisible();

  // Rollback shows the model at the base extrude and pauses downstream steps.
  await page.getByTestId("roll-back").click();
  await expect.poll(() => volume(page)).toBeCloseTo(60 * 40 * 12, -1);
  await expect(page.locator('[data-feature-id="extrude-2"]')).toHaveAttribute(
    "data-status",
    "paused",
  );
  await page.getByTestId("roll-forward").click();
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect(page.locator('[data-feature-id="extrude-2"]')).toHaveAttribute(
    "data-status",
    "ok",
  );
  await context.close();
});

function symmetricDoc() {
  const plate = addPolyline(
    emptySketch(),
    [
      { point: [0, 0] },
      { point: [40, 0] },
      { point: [40, 20] },
      { point: [0, 20] },
    ],
    true,
  );
  const doc = createDocument(plate, {
    id: "doc-symmetric",
    sketchId: "sketch-sym",
    extrudeId: "extrude-sym",
    name: "Symmetric",
    height: 10,
  });
  const base = doc.features[1];
  if (base?.type !== "extrude") throw new Error("Expected the base extrude");
  return { ...doc, features: [doc.features[0]!, { ...base, symmetric: true }] };
}

function throughAllDoc() {
  const doc = multiFeatureDoc();
  return {
    ...doc,
    features: doc.features.map((feature) =>
      feature.id === "extrude-2" && feature.type === "extrude"
        ? { ...feature, height: 1, end: "throughAll" as const }
        : feature,
    ),
  };
}

test("builds a symmetric extrude around the sketch plane", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(symmetricDoc()));
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect.poll(() => volume(page)).toBeCloseTo(40 * 20 * 10, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,-5,40,20,5");
  await context.close();
});

test("cuts through the whole body from a through-all extrude", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(throughAllDoc()));
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  const expected = 80 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,80,40,12");
  await context.close();
});

test("rebuilds downstream features after editing the first sketch", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(multiFeatureDoc()));
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  const expected = 80 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);

  await page.getByTestId("timeline-sketch").click();
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 10, 10);
  await clickSketch(page, 15, 10);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();
  await expect.poll(() => volume(page)).not.toBeCloseTo(expected, -1);

  await page.getByTestId("undo").click();
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await context.close();
});

test("switches and persists the appearance theme", async ({ app: page }) => {
  await page.getByTestId("theme-night").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await expect(page.locator(".doc-head")).toHaveCSS(
    "background-color",
    "rgb(17, 17, 16)",
  );

  await page.getByTestId("highlight-pink").click();
  await expect(page.locator("html")).toHaveAttribute("data-highlight", "pink");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--marker")
          .trim(),
      ),
    )
    .toBe("#ff79c9");
  expect(
    await page.evaluate(() => ({
      mode: localStorage.getItem("cad.theme"),
      highlight: localStorage.getItem("cad.highlight"),
    })),
  ).toEqual({ mode: "night", highlight: "pink" });

  // Sketch ink follows the theme immediately.
  await enterSketch(page);
  await expect(page.locator("line[data-geometry-id]").first()).toHaveCSS(
    "stroke",
    "rgb(242, 239, 227)",
  );

  // A new document in the same context reads the saved appearance before React
  // paints, without reloading the warm worker page.
  const second = await page.context().newPage();
  await second.goto("/");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "night");
  await expect(second.locator("html")).toHaveAttribute("data-highlight", "pink");
  await second.close();

  await page.getByTestId("theme-day").click();
  await page.getByTestId("highlight-yellow").click();
  await expect(page.locator(".doc-head")).toHaveCSS(
    "background-color",
    "rgb(251, 251, 249)",
  );
});
