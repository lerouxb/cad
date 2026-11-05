import { expect } from "@playwright/test";
import { resetExample, test } from "./support/app";
import {
  volume,
  activeStepMeta,
  collectErrors,
} from "./support/app";
import {
  sketchPoint,
  clickSketch,
  dblclickSketch,
  dragSketch,
  lassoSketch,
  enterSketch,
  readProfileRect,
} from "./support/sketch";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});


test("the sketch filter row limits what select can pick", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await expect(page.getByTestId("sketch-filter-all")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const filters = page
    .locator(".tool-options")
    .filter({ has: page.getByTestId("sketch-filter-all") });
  await expect(filters.locator(".tool-kicker")).toHaveAttribute(
    "title",
    "Everything can be picked",
  );
  await expect(filters).not.toContainText("picked");
  const selection = page.getByTestId("selection-panel");

  // Curves: a line midpoint selects the line.
  await page.getByTestId("sketch-filter-curves").click();
  await clickSketch(page, 0, -20);
  await expect(selection).toHaveAttribute("data-count", "1");
  await expect(selection).toContainText("Line");

  // Points: the same click is ignored, then a point selects.
  await page.getByTestId("sketch-filter-points").click();
  await clickSketch(page, 0, -20);
  await expect(selection).toHaveCount(0);
  await clickSketch(page, 30, -20);
  await expect(selection).toHaveAttribute("data-count", "1");
  await expect(selection).toContainText("Point");

  // Dimensions: the label is editable; other filters leave it inert.
  await page.getByTestId("sketch-filter-dimensions").click();
  await page.locator("[data-dimension-id]").first().dblclick();
  await expect(page.getByTestId("dimension-input")).toBeVisible();
  await page.keyboard.press("Escape");

  // The row is contextual: a tool without options collapses it.
  await page.getByTestId("tool-line").click();
  await expect(page.getByTestId("sketch-filter-all")).toHaveCount(0);
  await page.getByTestId("tool-select").click();
  await expect(page.getByTestId("sketch-filter-all")).toBeVisible();
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

  // The demo's bottom edge runs from (-30, -20) to (30, -20).
  await clickSketch(page, 0, -20);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Line");
  await expect(panel).toContainText("60 mm");

  await page.keyboard.press("Delete");
  await expect(panel).toHaveCount(0);
  // The hole circle is still a closed region, so deleting the plate's edges
  // leaves only the circle as a profile.
  await expect(page.locator("[data-region-id]")).toHaveCount(1);

  await page.keyboard.press("Control+z");
  await expect(page.locator("[data-region-id]")).toHaveCount(2);

  // Shift-click adds the right edge to the selection.
  await clickSketch(page, 0, -20);
  await page.keyboard.down("Shift");
  await clickSketch(page, 30, 0);
  await page.keyboard.up("Shift");
  await expect(panel).toHaveAttribute("data-count", "2");
  await expect(panel).toContainText("2 selected");

  await page.getByTestId("delete-selection").click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator("[data-region-id]")).toHaveCount(1);

  await page.keyboard.press("Control+z");
  await expect(page.locator("[data-region-id]")).toHaveCount(2);
  await page.getByTestId("timeline-extrude").click();
  await expect.poll(() => volume(page)).toBeCloseTo(initialVolume, -1);

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
  expect(width * height * 12).toBeGreaterThan(0);
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

  const resized = await readProfileRect(page);
  expect(resized.maxX - resized.minX).toBeCloseTo(100, 0);
  expect(resized.maxY - resized.minY).toBeCloseTo(height, 0);

  // A reference dimension measures without constraining.
  await clickSketch(page, resized.maxX, (resized.minY + resized.maxY) / 2);
  await page.getByTestId("tool-dimension").click();
  await expect(page.getByTestId("reference-toggle")).toBeVisible();
  await page.getByTestId("reference-toggle").click();
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


test("commits a dimension kind change on blur and locks reference values", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  const width = page
    .locator("[data-dimension-id]")
    .filter({ hasText: /^60$/ })
    .first();
  await expect(width).toBeVisible();
  await width.dblclick();
  await expect(page.getByTestId("dimension-kind-driving")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("dimension-kind-reference").click();
  await expect(page.getByTestId("dimension-kind-reference")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // There is no apply button: clicking outside commits the kind.
  await page.mouse.click(200, 200);
  const reference = page
    .locator("[data-dimension-id]")
    .filter({ hasText: "(60)" });
  await expect(reference).toHaveCount(1);
  await expect(page.getByTestId("dof")).toContainText("1 DOF");

  // A reference value is a measurement, not an editable field.
  await reference.dblclick();
  await expect(page.getByTestId("dimension-kind-reference")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("dimension-readout")).toHaveText("(60)");
  await expect(page.getByTestId("dimension-input")).toHaveCount(0);
  await page.getByTestId("dimension-kind-driving").click();
  await page.mouse.click(200, 200);
  await expect(
    page.locator("[data-dimension-id]").filter({ hasText: /^60$/ }),
  ).toHaveCount(1);
  await expect(page.getByTestId("dof")).toContainText("Fully constrained");

  expect(errors).toEqual([]);
});


test("a reference readout formats the same measurement as its label", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  // A length just under a display boundary: 56.2499 reads 56.2, while rounding
  // it to "56.25" first and then to one decimal would read 56.3.
  await page.getByTestId("tool-line").click();
  await clickSketch(page, -28, 0);
  await clickSketch(page, 0, 0);
  await page.keyboard.press("Enter");
  await page.getByTestId("tool-select").click();
  await clickSketch(page, -14, 0);
  await page.getByTestId("tool-dimension").click();
  await clickSketch(page, -14, 14);

  const label = page.locator("[data-dimension-id]").first();
  await expect(label).toBeVisible();
  await label.dblclick();
  await page.getByTestId("dimension-input").fill("56.2499");
  await page.getByTestId("dimension-input").press("Enter");
  const driving = page
    .locator("[data-dimension-id]")
    .filter({ hasText: /^56\.2$/ });
  await expect(driving).toHaveCount(1);

  // The editor seeds its driving field at two decimals, but the reference
  // readout is a display of the measurement and must match the label exactly.
  // It used to re-round the seeded "56.25" and show (56.3) next to a 56.2
  // label.
  await driving.dblclick();
  await expect(page.getByTestId("dimension-input")).toHaveValue("56.25");
  await page.getByTestId("dimension-kind-reference").click();
  await expect(page.getByTestId("dimension-readout")).toHaveText("(56.2)");
  await expect(page.getByTestId("dimension-input")).toHaveCount(0);

  // Escape leaves the driving dimension (and the geometry) untouched.
  await page.keyboard.press("Escape");
  await expect(driving).toHaveCount(1);
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

  await expect(page.getByTestId("fillet-radius-slider")).toBeVisible();
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


test("snaps a line to existing sketch edges, not just the grid", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // Start just inside the plate's left edge and finish just inside the right
  // edge. The Y positions are deliberately off the 5 mm grid.
  await page.getByTestId("tool-line").click();
  await clickSketch(page, -29.5, -6.7);
  await clickSketch(page, 29.5, 6.7);
  await page.keyboard.press("Enter");

  const read = () =>
    page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("cad.doc")!);
    const sketch = doc.features[0].sketch;
    const points = sketch.points.filter(
      (point: { y: number }) =>
        Math.abs(point.y + 6.7) < 0.6 || Math.abs(point.y - 6.7) < 0.6,
    );
    const constraints = sketch.constraints.filter(
      (constraint: { type: string; point?: string }) =>
        constraint.type === "pointOnLine" &&
        points.some((point: { id: string }) => point.id === constraint.point),
    );
    return {
      points: points.map((point: { x: number; y: number }) => ({
        x: point.x,
        y: point.y,
      })),
      constraints: constraints.length,
    };
    });

  await expect.poll(async () => (await read()).points.length).toBe(2);
  const result = await read();
  expect(result.constraints).toBe(2);
  const sorted = [...result.points].sort((a, b) => a.x - b.x);
  expect(sorted[0]!.x).toBeCloseTo(-30, 2);
  expect(sorted[0]!.y).toBeCloseTo(-6.7, 1);
  expect(sorted[1]!.x).toBeCloseTo(30, 2);
  expect(sorted[1]!.y).toBeCloseTo(6.7, 1);
  expect(errors).toEqual([]);
});


test("dragging a snapped line leaves its support box alone", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-20, -10], [20, 10]);
  await page.keyboard.press("Escape");

  // A line snapped from the top edge to the right edge.
  await page.getByTestId("tool-line").click();
  await clickSketch(page, -5, 10.5);
  await clickSketch(page, 19.5, 3);
  await page.keyboard.press("Enter");
  await page.getByTestId("tool-select").click();

  const read = () =>
    page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem("cad.doc")!);
      const sketch = doc.features[0].sketch;
      return sketch.points.map((point: { id: string; x: number; y: number }) => ({
        id: point.id,
        x: point.x,
        y: point.y,
      }));
    });

  type Point = { id: string; x: number; y: number };
  await expect.poll(async () => (await read()).length).toBe(6);
  const before = (await read()) as Point[];
  // The rectangle creates its four corners first; the snapped line follows.
  const box = before.slice(0, 4);
  const line = before.slice(4);
  expect(line).toHaveLength(2);
  const midX = (line[0]!.x + line[1]!.x) / 2;
  const midY = (line[0]!.y + line[1]!.y) / 2;

  await dragSketch(page, [midX, midY], [midX + 5, midY]);

  await expect
    .poll(async () => {
      const after = (await read()) as Point[];
      return box.every((corner) => {
        const moved = after.find((point) => point.id === corner.id);
        return (
          moved !== undefined &&
          Math.hypot(moved.x - corner.x, moved.y - corner.y) < 0.02
        );
      });
    })
    .toBe(true);

  const lineAfter = ((await read()) as Point[]).filter((point) =>
    line.some((end) => end.id === point.id),
  );
  // The snapped endpoints slid along the box edges instead of resizing it.
  expect(lineAfter.some((point) => Math.abs(point.y - 10) < 0.05)).toBe(true);
  expect(lineAfter.some((point) => Math.abs(point.x - 20) < 0.05)).toBe(true);
  const slope = (points: Point[]) =>
    (points[1]!.y - points[0]!.y) / (points[1]!.x - points[0]!.x);
  expect(slope(lineAfter)).toBeCloseTo(slope(line), 1);

  // The same support-freeze rule applies to a single endpoint drag.
  const top = lineAfter.find((point) => Math.abs(point.y - 10) < 0.05)!;
  await dragSketch(page, [top.x, top.y], [top.x + 3, top.y]);
  await expect
    .poll(async () => {
      const after = (await read()) as Point[];
      return box.every((corner) => {
        const moved = after.find((point) => point.id === corner.id);
        return (
          moved !== undefined &&
          Math.hypot(moved.x - corner.x, moved.y - corner.y) < 0.02
        );
      });
    })
    .toBe(true);
  await expect
    .poll(async () => {
      const endpoint = ((await read()) as Point[]).find(
        (point) => point.id === top.id,
      );
      return endpoint?.x ?? Number.NEGATIVE_INFINITY;
    })
    .toBeGreaterThan(top.x + 1);
  const draggedEndpoint = ((await read()) as Point[]).find(
    (point) => point.id === top.id,
  )!;
  expect(draggedEndpoint.y).toBeCloseTo(10, 1);
  expect(errors).toEqual([]);
});


test("snaps to a line crossing and constrains both lines", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  // Two crossing lines, then a third line starting at their intersection.
  await page.getByTestId("tool-line").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 20, 20);
  await page.keyboard.press("Enter");
  await clickSketch(page, 0, 20);
  await clickSketch(page, 20, 0);
  await page.keyboard.press("Enter");
  await clickSketch(page, 10, 10);
  await clickSketch(page, 30, 10);
  await page.keyboard.press("Enter");

  const read = () =>
    page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem("cad.doc")!);
      const sketch = doc.features[0].sketch;
      const start = sketch.points.find(
        (point: { x: number; y: number }) =>
          Math.hypot(point.x - 10, point.y - 10) < 0.2,
      );
      if (!start) return null;
      const constraints = sketch.constraints.filter(
        (constraint: { type: string; point?: string }) =>
          constraint.type === "pointOnLine" && constraint.point === start.id,
      );
      return {
        start: { x: start.x, y: start.y },
        lines: [...new Set(constraints.map((c: { line: string }) => c.line))],
      };
    });

  await expect.poll(async () => (await read())?.lines.length ?? 0).toBe(2);
  const result = await read();
  expect(result).not.toBeNull();
  expect(result!.start.x).toBeCloseTo(10, 1);
  expect(result!.start.y).toBeCloseTo(10, 1);
  expect(result!.lines).toHaveLength(2);
  expect(errors).toEqual([]);
});


test("makes two opposite edges symmetric about a centreline", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  // An off-centre rectangle and an anchored centreline through the origin.
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-20, -10], [10, 10]);
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-line").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 0, 20);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-select").click();

  // Two opposite vertical edges, then the centreline last.
  await clickSketch(page, -20, 5);
  await page.keyboard.down("Shift");
  await clickSketch(page, 10, 5);
  await clickSketch(page, 0, 15);
  await page.keyboard.up("Shift");

  const chip = page.getByTestId("constraint-symmetric");
  await expect(chip).toBeVisible();
  await chip.click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const doc = JSON.parse(localStorage.getItem("cad.doc")!);
        const sketch = doc.features.find(
          (feature: { type: string }) => feature.type === "sketch",
        );
        return sketch.sketch.constraints.filter(
          (constraint: { type: string }) => constraint.type === "symmetric",
        ).length;
      }),
    )
    .toBe(2);

  const midpoints = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("cad.doc")!);
    const sketch = doc.features.find(
      (feature: { type: string }) => feature.type === "sketch",
    );
    const points = new Map(
      sketch.sketch.points.map((point: { id: string }) => [point.id, point]),
    );
    return sketch.sketch.constraints
      .filter((constraint: { type: string }) => constraint.type === "symmetric")
      .map((constraint: { a: string; b: string }) => {
        const a = points.get(constraint.a) as { x: number; y: number };
        const b = points.get(constraint.b) as { x: number; y: number };
        return { midX: (a.x + b.x) / 2, dy: a.y - b.y };
      });
  });
  expect(midpoints).toHaveLength(2);
  for (const pair of midpoints) {
    expect(pair.midX).toBeCloseTo(0, 2);
    expect(pair.dy).toBeCloseTo(0, 2);
  }
  expect(errors).toEqual([]);
});


test("removes an applied constraint from the line selection", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // A free line, clear of the demo geometry and the axes.
  await page.getByTestId("tool-line").click();
  await clickSketch(page, 2, -10);
  await clickSketch(page, 27, -15);
  await page.keyboard.press("Enter");
  await page.getByTestId("tool-select").click();
  await clickSketch(page, 14.5, -12.5);

  const chip = page.getByTestId("constraint-horizontal");
  await expect(chip).not.toHaveClass(/is-on/);
  await chip.click();
  await expect(chip).toHaveClass(/is-on/);
  await chip.click();
  await expect(chip).not.toHaveClass(/is-on/);
  expect(errors).toEqual([]);
});


test("clears a conflict when a conflicting constraint is released", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("tool-select").click();
  // The right edge, clear of the X axis and the corner points.
  await clickSketch(page, 30, -10);

  const horizontal = page.getByTestId("constraint-horizontal");
  await horizontal.click();
  await expect(page.getByTestId("dof")).toContainText("Conflicting constraints");
  await expect(horizontal).toHaveClass(/is-on/);
  await horizontal.click();
  await expect(page.getByTestId("dof")).not.toContainText("Conflicting constraints");
  await expect(horizontal).not.toHaveClass(/is-on/);
  expect(errors).toEqual([]);
});


test("clicking outside a selection clears it before starting a draft", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("tool-select").click();

  await clickSketch(page, 0, 20);
  await expect(page.getByTestId("selection-panel")).toHaveCount(1);

  // A filled region is outside the selected line: the first click deselects.
  await clickSketch(page, 20, -10);
  await expect(page.getByTestId("selection-panel")).toHaveCount(0);
  await expect(page.getByTestId("extrude-draft-popover")).toHaveCount(0);

  // With nothing selected, the same click starts an explicit extrude draft.
  await clickSketch(page, 20, -10);
  await expect(page.getByTestId("extrude-draft-popover")).toHaveCount(1);

  // Clicking the empty grid cancels the draft and leaves the sketch open.
  await clickSketch(page, 40, 10);
  await expect(page.getByTestId("extrude-draft-popover")).toHaveCount(0);
  await expect(page.getByTestId("tool-select")).toBeVisible();

  expect(errors).toEqual([]);
});


test("filleting the demo's diagonal corner keeps the diagonal and symmetry anchors", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // The demo is centred on the origin. Filleting its bottom-left corner is the
  // interesting case: the construction diagonal and two symmetry anchors use
  // that point.
  await clickSketch(page, 0, -20);
  await page.keyboard.down("Shift");
  await clickSketch(page, -30, 0);
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
    ends.some(
      ([x, y]) =>
        Math.abs(x! + 30) < 1e-6 && Math.abs(y! + 20) < 1e-6,
    ),
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
  await expect(page.getByTestId("grid-scale")).not.toContainText("mm");

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


test("reports live zoom and has no dead view labels", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  const zoom = page.getByTestId("zoom-select");
  await expect(page.getByText("front ortho")).toHaveCount(0);

  await page.mouse.move(720, 420);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(async () => Number(await zoom.inputValue()))
    .toBeLessThan(100);
  await expect(zoom).not.toHaveValue("fit");

  await zoom.selectOption("200");
  await expect(zoom).toHaveValue("200");
  await zoom.selectOption("fit");
  await expect(zoom).toHaveValue("100");
  expect(errors).toEqual([]);
});


test("finishes the active sketch with Enter", async ({ app: page }) => {
  await enterSketch(page);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tool-select")).toBeHidden();
  await expect(activeStepMeta(page)).toContainText("12 mm");
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


test("box-selects profile regions", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -20], [-10, 20]);
  await dragSketch(page, [10, -20], [40, 20]);
  await page.keyboard.press("Escape");

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("popover-select-profiles").click();
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
  await page.getByTestId("popover-select-profiles").click();
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
  await page.getByTestId("popover-select-profiles").click();
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
  await page.getByTestId("popover-select-profiles").click();
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
  await page.getByTestId("popover-select-profiles").click();
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
  // The snapped centreline adds point-on-line constraints, so the solver's
  // sub-hundredth-of-a-mm convergence shows up in the joined volume.
  await expect.poll(() => volume(page)).toBeCloseTo(80 * 40 * 12, -2);

  await page.keyboard.press("Control+z");
  await expect.poll(() => volume(page)).toBeCloseTo(40 * 40 * 12, -1);

  expect(errors).toEqual([]);
});
