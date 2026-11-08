import { expect } from "@playwright/test";
import { collectErrors, resetExample, test } from "./support/app";
import {
  clickSketch,
  dragSketch,
  enterSketch,
  readProfileRect,
} from "./support/sketch";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

test("collinear joins two lines' supporting line", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-line").click();
  await clickSketch(page, -40, -10);
  await clickSketch(page, 0, 0);
  await page.keyboard.press("Enter");
  await clickSketch(page, 10, 10);
  await clickSketch(page, 50, 20);
  await page.keyboard.press("Enter");
  await page.getByTestId("tool-select").click();

  await clickSketch(page, -20, -5);
  await page.keyboard.down("Shift");
  await clickSketch(page, 30, 15);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection-panel")).toHaveAttribute(
    "data-count",
    "2",
  );
  await page.getByTestId("constraint-collinear").click();

  // One document constraint, one mark group (badge plus tie).
  await expect(
    page.locator('[data-constraint-type="collinear"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("constraint-collinear")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The mark is the handle: hover links the pair, click selects the
  // constraint, Backspace removes it.
  const mark = page.locator(
    '[data-constraint-type="collinear"] [data-mark-hit]',
  ).last();
  const group = page.locator('[data-constraint-type="collinear"]');
  await mark.hover();
  await expect(group).toHaveAttribute("data-hovered", "true");
  await expect(page.getByTestId("constraint-tooltip")).toHaveText(
    "Collinear · 2 curves",
  );
  await mark.click();
  await expect(group).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("selection-panel")).toContainText("Collinear");
  await page.keyboard.press("Backspace");
  await expect(
    page.locator('[data-constraint-type="collinear"]'),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("draws an axis-aligned rectangle from its centre", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await expect(page.getByTestId("rect-variant-center")).toBeVisible();
  await page.getByTestId("rect-variant-center").click();

  await dragSketch(page, [0, 0], [20, 10]);
  const box = await readProfileRect(page);
  expect(box.minX).toBeCloseTo(-20, 3);
  expect(box.maxX).toBeCloseTo(20, 3);
  expect(box.minY).toBeCloseTo(-10, 3);
  expect(box.maxY).toBeCloseTo(10, 3);
  expect(errors).toEqual([]);
});

test("draws a three-point rectangle at an arbitrary angle", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await page.getByTestId("rect-variant-3-point").click();

  await clickSketch(page, 0, 0);
  await clickSketch(page, 20, 0);
  await clickSketch(page, 0, 10);
  const box = await readProfileRect(page);
  expect(box.minX).toBeCloseTo(0, 3);
  expect(box.maxX).toBeCloseTo(20, 3);
  expect(box.minY).toBeCloseTo(0, 3);
  expect(box.maxY).toBeCloseTo(10, 3);
  await expect(page.locator("[data-geometry-id]")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("draws a two-point diameter circle", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-circle").click();
  await page.getByTestId("circle-variant-2-point").click();

  await clickSketch(page, -10, 0);
  await clickSketch(page, 10, 0);
  await expect(
    page.locator("[data-dimension-id]").filter({ hasText: "20.0" }),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("draws a three-point circle", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-circle").click();
  await page.getByTestId("circle-variant-3-point").click();

  await clickSketch(page, 0, 0);
  await clickSketch(page, 10, 0);
  await clickSketch(page, 0, 10);
  // The circumcircle of the right triangle has centre (5,5), r = sqrt(50).
  await expect(
    page.locator("[data-dimension-id]").filter({ hasText: "14.1" }),
  ).toHaveCount(1);
  const box = await readProfileRect(page);
  expect(box.minX).toBeCloseTo(5 - Math.hypot(5, 5), 1);
  expect(box.maxX).toBeCloseTo(5 + Math.hypot(5, 5), 1);
  expect(errors).toEqual([]);
});

test("draws a centre-point arc", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-arc").click();
  await page.getByTestId("arc-variant-center").click();

  await clickSketch(page, 0, 0);
  await clickSketch(page, 10, 0);
  await clickSketch(page, 0, 10);
  await expect(page.locator("[data-geometry-id]")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("draws a tangent arc from a line endpoint", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-line").click();
  await clickSketch(page, -10, 0);
  await clickSketch(page, 10, 0);
  await page.keyboard.press("Enter");
  await page.getByTestId("tool-arc").click();
  await page.getByTestId("arc-variant-tangent").click();

  // Start on the line's endpoint, then let the arc leave along the line.
  await clickSketch(page, -10, 0);
  await clickSketch(page, 0, 10);
  await expect(page.locator("[data-geometry-id]")).toHaveCount(2);
  await expect(
    page.locator('[data-constraint-type="tangent"]'),
  ).toHaveCount(1);
  expect(errors).toEqual([]);
});
