import { expect, test, type Locator, type Page } from "@playwright/test";

/** Set a range input the way a user would, through React's onChange. */
async function setSlider(locator: Locator, value: number): Promise<void> {
  await locator.evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

/** Click a point given in sketch millimetres, independent of pan/zoom. */
async function clickSketch(page: Page, x: number, y: number): Promise<void> {
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

async function dblclickSketch(page: Page, x: number, y: number): Promise<void> {
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

async function dragSketch(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
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

/** Bounds of the extruded outer loop, in sketch millimetres. */
async function readProfileRect(page: Page) {
  return page.evaluate(() => {
    const polygon = document.querySelector("svg.sketch-canvas polygon");
    const raw = polygon?.getAttribute("points");
    if (!raw) throw new Error("No profile polygon");
    const points = raw
      .trim()
      .split(/\s+/)
      .map((pair) => pair.split(",").map(Number));
    const xs = points.map((point) => point[0]!);
    const ys = points.map((point) => point[1]!);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
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

test("the dimensioned example drives an exact solid", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");

  const stats = page.getByTestId("mesh-stats");
  await expect(stats).toBeVisible();

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

  // Extrude height is a feature parameter.
  await setSlider(page.getByTestId("height-slider"), 30);
  const taller = 60 * 40 * 30 - Math.PI * 8 * 8 * 30;
  await expect.poll(() => volume(page)).toBeCloseTo(taller, -1);

  // Drawing appends to the sketch instead of replacing it. A circle inside the
  // plate becomes another hole.
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 10, 20);
  await clickSketch(page, 15, 20);

  const withSecondHole = taller - Math.PI * 5 * 5 * 30;
  await expect.poll(() => volume(page)).toBeCloseTo(withSecondHole, -1);

  await page.keyboard.press("Control+z");
  await expect.poll(() => volume(page)).toBeCloseTo(taller, -1);

  expect(errors).toEqual([]);
});

test("selects, multi-selects, and deletes sketch geometry", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");

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

test("extrudes a lone circle as a cylinder", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");
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

  expect(errors).toEqual([]);
});

test("uses a drawn inner rectangle as a hole", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");
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

  expect(errors).toEqual([]);
});

test("creates, edits and deletes parametric dimensions", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");
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

  await page.getByTestId("tool-dimension").click();
  await clickSketch(page, (before.minX + before.maxX) / 2, before.minY);
  await clickSketch(page, (before.minX + before.maxX) / 2, before.minY + 14);

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
  await page.getByTestId("reference-toggle").check();
  const resized = await readProfileRect(page);
  await clickSketch(page, resized.maxX, (resized.minY + resized.maxY) / 2);
  await clickSketch(page, resized.maxX + 14, (resized.minY + resized.maxY) / 2);
  await expect(page.getByTestId("dof")).toContainText("3 DOF");
  await expect(page.locator("[data-dimension-id]")).toHaveCount(2);

  // Deleting the driving dimension frees the width again.
  await page.locator("[data-dimension-id]").filter({ hasText: "100" }).dblclick();
  await page.getByTestId("dimension-delete").click();
  await expect(page.getByTestId("dof")).toContainText("4 DOF");
  await expect(page.locator("[data-dimension-id]")).toHaveCount(1);

  expect(errors).toEqual([]);
});

test("applies constraints and construction from the floating bar", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");
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

test("drags a line as a whole", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");
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

test("draws a three-point arc and drags it", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-arc").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 40, 0);
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

test("rounds a rectangle corner with a parametric fillet", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");
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

  await page.getByTestId("fillet-radius").fill("10");
  await page.getByTestId("constraint-fillet").click();

  await expect(page.locator("[data-geometry-id]")).toHaveCount(5);
  await expect(page.locator('[data-constraint-type="tangent"]')).toHaveCount(4);

  await page.getByTestId("timeline-extrude").click();
  const cut = 10 * 10 - Math.PI * 10 * 10 / 4;
  await expect.poll(() => volume(page)).toBeCloseTo((80 * 60 - cut) * 12, -1);

  expect(errors).toEqual([]);
});

test("drives an angle dimension and a radius dimension", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-line").click();
  await clickSketch(page, 0, 0);
  await dblclickSketch(page, 60, 0);
  await clickSketch(page, 0, 0);
  await dblclickSketch(page, 50, 30);
  await page.keyboard.press("Escape");

  await page.getByTestId("tool-dimension").click();
  await page.getByTestId("dimension-angle").click();
  await clickSketch(page, 30, 0);
  await clickSketch(page, 25, 15);
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

  await page.getByTestId("tool-dimension").click();
  await page.getByTestId("dimension-radius").click();
  await clickSketch(page, 20, 0);
  await clickSketch(page, 40, 0);
  const radiusLabel = page.locator("[data-dimension-id]").filter({ hasText: "R" });
  await expect(radiusLabel).toHaveCount(1);
  await radiusLabel.dblclick();
  await page.getByTestId("dimension-input").fill("25");
  await page.getByTestId("dimension-input").press("Enter");
  await expect(page.locator("[data-dimension-id]").filter({ hasText: "R 25" })).toHaveCount(1);

  await page.getByTestId("timeline-extrude").click();
  await expect.poll(() => volume(page)).toBeCloseTo(Math.PI * 25 * 25 * 12, -1);

  expect(errors).toEqual([]);
});
