import { expect, type Page } from "@playwright/test";
import { collectErrors, resetExample, test } from "./support/app";
import { fitView, scanVisibleEdges } from "./support/model";
import { clickSketch, dragSketch } from "./support/sketch";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

async function projectionIds(page: Page): Promise<string[]> {
  return page
    .locator("[data-projection-id]")
    .evaluateAll((elements) =>
      [
        ...new Set(
          elements
            .map((element) => element.getAttribute("data-projection-id"))
            .filter((id): id is string => Boolean(id)),
        ),
      ].sort(),
    );
}

async function clickEmptyStage(page: Page): Promise<void> {
  const canvas = page.locator("canvas.viewport-canvas");
  const box = (await canvas.boundingBox())!;
  const popover = await page.getByTestId("project-popover").boundingBox();
  for (let y = box.y + 40; y < box.y + box.height - 40; y += 30) {
    for (let x = box.x + 40; x < box.x + box.width - 40; x += 30) {
      if (
        popover &&
        x >= popover.x &&
        x <= popover.x + popover.width &&
        y >= popover.y &&
        y <= popover.y + popover.height
      ) {
        continue;
      }
      await page.mouse.move(x, y);
      if (!(await canvas.getAttribute("data-hover-kind"))) {
        await page.mouse.click(x, y);
        return;
      }
    }
  }
  throw new Error("No empty stage point was found");
}

async function clickAFace(page: Page): Promise<void> {
  const canvas = page.locator("canvas.viewport-canvas");
  await fitView(page);
  for (let y = 200; y <= 500; y += 25) {
    for (let x = 260; x <= 1050; x += 25) {
      await page.mouse.move(x, y);
      if ((await canvas.getAttribute("data-hover-kind")) === "face") {
        await page.mouse.click(x, y);
        return;
      }
    }
  }
  throw new Error("No face was found");
}

test("projects a picked face into the active sketch and returns to it", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Mounting holes" })
    .click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await expect
    .poll(async () => (await projectionIds(page)).length)
    .toBeGreaterThan(0);
  const before = await projectionIds(page);

  await page.getByTestId("tool-project").click();
  await expect(page.getByTestId("project-popover")).toBeVisible();
  await expect(page.getByTestId("project-apply")).toBeDisabled();
  await expect(page.getByTestId("model-filter-all")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await clickAFace(page);
  await expect(page.getByTestId("project-popover")).toContainText("1 selected");
  await expect(page.getByTestId("project-apply")).toBeEnabled();
  await page.getByTestId("project-apply").click();

  await expect(page.getByTestId("project-popover")).toHaveCount(0);
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await expect
    .poll(async () => (await projectionIds(page)).length)
    .toBeGreaterThan(before.length);
  expect(errors).toEqual([]);
});

test("projects a picked body edge as an open reference line", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Mounting holes" })
    .click();
  await expect
    .poll(async () => (await projectionIds(page)).length)
    .toBeGreaterThan(0);
  const before = await projectionIds(page);

  await page.getByTestId("tool-project").click();
  await expect(page.getByTestId("project-popover")).toBeVisible();
  await fitView(page);
  const edges = await scanVisibleEdges(page);
  expect(edges.length).toBeGreaterThan(0);
  const [edge] = edges;
  await page.mouse.click(edge!.x, edge!.y);
  await expect(page.getByTestId("project-popover")).toContainText("Edge 1");
  await page.getByTestId("project-apply").click();

  await expect(page.getByTestId("project-popover")).toHaveCount(0);
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await expect
    .poll(async () => (await projectionIds(page)).length)
    .toBeGreaterThan(before.length);
  const added = (await projectionIds(page)).find(
    (id) => !before.includes(id),
  )!;
  const projected = page.locator(`[data-projection-id="${added}"]`);
  await expect(projected.first()).toBeAttached();
  // A picked straight edge is materialized as one open reference line, not a
  // closed loop with a doubled-back segment.
  expect(await projected.count()).toBe(1);
  expect(await projected.first().evaluate((element) => element.tagName)).toBe(
    "line",
  );
  expect(errors).toEqual([]);
});

test("a projected circular boundary accepts a point-on-circle constraint", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Mounting holes" })
    .click();

  // The support face's central hole projects as an analytic reference circle,
  // not a sampled polygon: point-on-circle can target it.
  const referenceCircle = page.locator("circle[data-projection-id]");
  await expect
    .poll(async () => referenceCircle.count())
    .toBeGreaterThan(0);
  const radius = Number(
    await referenceCircle.first().getAttribute("r"),
  );
  expect(radius).toBeGreaterThan(7);
  expect(radius).toBeLessThan(9);

  await page.getByTestId("tool-point").click();
  await clickSketch(page, 0, 14);
  await page.getByTestId("tool-select").click();
  const point = page
    .locator('circle[data-point-id]:not([data-point-id="origin"])')
    .last();
  await expect(point).toHaveCount(1);

  // Pick the circle off-axis so the X/Y reference lines cannot steal the hit,
  // then Shift-add the point. The popover then offers point-on-circle.
  const onCircle = 8 / Math.SQRT2;
  await clickSketch(page, onCircle, onCircle);
  await expect(page.getByTestId("selection-panel")).toContainText(
    "⌀ 16 mm",
  );
  const box = await point.boundingBox();
  if (!box) throw new Error("Point has no screen box");
  await page.keyboard.down("Shift");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up("Shift");
  await page.getByTestId("constraint-pointOnCircle").click();

  await expect
    .poll(async () => {
      const cx = Number(await point.getAttribute("cx"));
      const cy = Number(await point.getAttribute("cy"));
      return Math.hypot(cx, cy);
    })
    .toBeCloseTo(radius, 1);
  expect(errors).toEqual([]);
});

test("a new point snaps onto a projected circle", async ({ app: page }) => {
  const errors = collectErrors(page);
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Mounting holes" })
    .click();
  const referenceCircle = page.locator("circle[data-projection-id]");
  await expect
    .poll(async () => referenceCircle.count())
    .toBeGreaterThan(0);
  const radius = Number(
    await referenceCircle.first().getAttribute("r"),
  );

  await page.getByTestId("tool-point").click();
  // Drop the point just outside the circle, off-axis: circle snapping must win
  // over the grid and attach it with pointOnCircle.
  const angle = Math.PI / 3;
  await clickSketch(
    page,
    (radius + 0.6) * Math.cos(angle),
    (radius + 0.6) * Math.sin(angle),
  );
  await page.getByTestId("tool-select").click();
  const point = page
    .locator('circle[data-point-id]:not([data-point-id="origin"])')
    .last();
  await expect
    .poll(async () => {
      const cx = Number(await point.getAttribute("cx"));
      const cy = Number(await point.getAttribute("cy"));
      return Math.hypot(cx, cy);
    })
    .toBeCloseTo(radius, 1);

  // The snap also attached pointOnCircle, so dragging the point away must slide
  // it around the circumference instead of leaving the circle.
  const box = await point.boundingBox();
  if (!box) throw new Error("Point has no screen box");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 120, center.y + 120, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const cx = Number(await point.getAttribute("cx"));
      const cy = Number(await point.getAttribute("cy"));
      return Math.hypot(cx, cy);
    })
    .toBeCloseTo(radius, 1);
  expect(errors).toEqual([]);
});

test("projected circles marquee and dimension like sketch geometry", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Mounting holes" })
    .click();
  const referenceCircle = page.locator("circle[data-projection-id]");
  await expect
    .poll(async () => referenceCircle.count())
    .toBeGreaterThan(0);
  const radius = Number(
    await referenceCircle.first().getAttribute("r"),
  );

  await page.getByTestId("tool-box").click();
  await dragSketch(page, [-10, -10], [10, 10]);
  await expect(page.getByTestId("selection-panel")).toContainText("⌀ 16 mm");

  await page.getByTestId("tool-select").click();
  await clickSketch(page, radius / Math.SQRT2, radius / Math.SQRT2);
  await expect(page.getByTestId("selection-panel")).toContainText("⌀ 16 mm");
  const before = await page.locator("[data-dimension-id]").count();
  await page.getByTestId("tool-dimension").click();
  await clickSketch(page, 12, 12);
  await expect
    .poll(async () => page.locator("[data-dimension-id]").count())
    .toBe(before + 1);
  await expect(page.locator("[data-dimension-id]").last()).toContainText(
    "(⌀ 16)",
  );
  expect(errors).toEqual([]);
});

test("an empty model click cancels the project picker", async ({ app: page }) => {
  const errors = collectErrors(page);
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Mounting holes" })
    .click();
  await expect
    .poll(async () => (await projectionIds(page)).length)
    .toBeGreaterThan(0);
  const before = await projectionIds(page);

  await page.getByTestId("tool-project").click();
  await expect(page.getByTestId("project-popover")).toBeVisible();
  await clickAFace(page);
  await expect(page.getByTestId("project-popover")).toContainText("1 selected");
  // PICKS O1 / MODES D8: a model form with no valid pick surface left to
  // click cancels rather than keeping an empty form open.
  await clickEmptyStage(page);

  await expect(page.getByTestId("project-popover")).toHaveCount(0);
  await expect(page.getByTestId("tool-select")).toBeVisible();
  expect(await projectionIds(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("cancelling the project picker leaves the sketch untouched", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Mounting holes" })
    .click();
  await expect
    .poll(async () => (await projectionIds(page)).length)
    .toBeGreaterThan(0);
  const before = await projectionIds(page);

  await page.getByTestId("tool-project").click();
  await expect(page.getByTestId("project-popover")).toBeVisible();
  await clickAFace(page);
  await expect(page.getByTestId("project-popover")).toContainText("1 selected");
  await page.getByTestId("project-cancel").click();

  await expect(page.getByTestId("project-popover")).toHaveCount(0);
  await expect(page.getByTestId("tool-select")).toBeVisible();
  expect(await projectionIds(page)).toEqual(before);
  expect(errors).toEqual([]);
});
