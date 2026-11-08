import { expect } from "@playwright/test";
import { collectErrors, resetExample, test } from "./support/app";
import { clickSketch, dragSketch, enterSketch } from "./support/sketch";
import { fitView, pickTopFace } from "./support/model";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

test("a filled region selects the profile; extrude is the feature chip", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -30], [40, 30]);
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-select").click();

  await clickSketch(page, 20, 10);
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-draft-popover")).toHaveCount(0);
  await expect(page.getByTestId("profile-extrude")).toBeVisible();

  await page.getByTestId("profile-extrude").click();
  await expect(page.getByTestId("profile-popover")).toHaveCount(0);
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("profile helpers switch material/void and Shift cannot mix families", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // The example plate has a material profile and a central void.
  await clickSketch(page, -20, 10);
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  await expect(page.getByTestId("profile-voids")).toBeVisible();
  await page.getByTestId("profile-voids").click();
  await expect(page.getByTestId("profile-popover")).toContainText("void");

  // Shift-clicking geometry while a profile is selected is blocked: the
  // profile stays selected and the geometry popover does not open.
  await page.keyboard.down("Shift");
  await clickSketch(page, -20, 20);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  await expect(page.getByTestId("selection-panel")).toHaveCount(0);

  await page.getByTestId("profile-clear").click();
  await expect(page.getByTestId("profile-popover")).toHaveCount(0);
  await expect(page.getByTestId("selection-panel")).toHaveCount(0);
  expect(errors).toEqual([]);
});


test("a selected line leaves constraints quiet; a selected mark highlights its badge", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -30], [40, 30]);
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-select").click();

  // The bottom edge is selected away from its midpoint H badge.
  await clickSketch(page, -20, -30);
  await expect(page.getByTestId("selection-panel")).toHaveAttribute(
    "data-count",
    "1",
  );
  const horizontal = page
    .locator('[data-constraint-type="horizontal"]')
    .first();
  await expect(horizontal).toHaveAttribute("data-mark-style", "quiet");

  // Clicking the mark selects the constraint and highlights its badge.
  await horizontal.locator("[data-mark-hit]").last().click();
  await expect(horizontal).toHaveAttribute("data-mark-style", "active");
  await expect(page.getByTestId("selection-panel")).toContainText("Horizontal");
  expect(errors).toEqual([]);
});


test("changing the highlighter recolours an active selection", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await expect(page.getByTestId("face-selection-popover")).toHaveAttribute(
    "data-count",
    "1",
  );
  const canvas = page.locator("canvas.viewport-canvas");
  const before = await canvas.getAttribute("data-highlight-color");
  expect(before).toBeTruthy();

  await page.getByTestId("highlight-pink").click();
  const after = await canvas.getAttribute("data-highlight-color");
  expect(after).toBeTruthy();
  expect(after).not.toBe(before);
  await expect(page.getByTestId("face-selection-popover")).toHaveAttribute(
    "data-count",
    "1",
  );
  expect(errors).toEqual([]);
});


test("a projected face line can toggle construction and pick its source face", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await page.getByTestId("face-new-sketch").click();
  await page.getByTestId("new-sketch").click();
  await expect(page.getByTestId("tool-select")).toBeVisible();

  await expect
    .poll(() => page.locator("[data-projection-line-id]").count())
    .toBeGreaterThan(0);
  const point = await page
    .locator("[data-projection-line-id]")
    .first()
    .evaluate((element) => {
      const line = element as SVGLineElement;
      const svg = line.ownerSVGElement;
      if (!svg) throw new Error("Projected line has no SVG");
      const matrix = svg.getScreenCTM();
      if (!matrix) throw new Error("Projected line has no CTM");
      const x =
        (Number(line.getAttribute("x1")) + Number(line.getAttribute("x2"))) / 2;
      const y =
        (Number(line.getAttribute("y1")) + Number(line.getAttribute("y2"))) / 2;
      const screen = new DOMPoint(x, y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("selection-panel")).toBeVisible();
  const construction = page.getByTestId("toggle-construction");
  await expect(construction).toHaveText("Make normal");
  await construction.click();
  await expect(page.getByTestId("toggle-construction")).toHaveText(
    "Construction",
  );

  await page.getByTestId("projection-source-face").click();
  const face = page.getByTestId("face-selection-popover");
  await expect(face).toBeVisible();
  await expect(face).toHaveAttribute("data-count", "1");
  expect(errors).toEqual([]);
});


test("a sketch marquee follows the filter and Backspace deletes the set", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -20], [-10, 20]);
  await dragSketch(page, [10, -20], [40, 20]);
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-select").click();

  // The curves filter gates the marquee, exactly like clicks.
  await page.getByTestId("sketch-filter-curves").click();
  await page.getByTestId("tool-box").click();
  await dragSketch(page, [-50, -30], [50, 30]);
  await expect(page.getByTestId("selection-panel")).toHaveAttribute(
    "data-count",
    "8",
  );
  await expect(page.getByTestId("profile-popover")).toHaveCount(0);

  // One Backspace deletes every selected curve; their points are pruned with
  // them, so no empty marquee or orphan geometry remains.
  await page.keyboard.press("Backspace");
  await expect(page.locator("[data-geometry-id]")).toHaveCount(0);
  await expect(page.locator("[data-point-id]")).toHaveCount(0);
  await expect(page.getByTestId("selection-panel")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("geometry and a dimension mix, and Backspace removes both", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-line").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 60, 0);
  await page.keyboard.press("Enter");
  await page.getByTestId("tool-select").click();

  // Select the line away from its H badge and place a length dimension.
  await clickSketch(page, 45, 0);
  await page.getByTestId("tool-dimension").click();
  await clickSketch(page, 30, 15);
  await page.getByTestId("tool-select").click();

  const label = page.locator("[data-dimension-id]").first();
  await label.click();
  await expect(page.getByTestId("selection-panel")).toHaveAttribute(
    "data-count",
    "1",
  );
  await expect(page.getByTestId("edit-dimension")).toBeVisible();

  await clickSketch(page, 45, 0);
  await label.click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("selection-panel")).toHaveAttribute(
    "data-count",
    "2",
  );
  await expect(page.getByTestId("selection-panel")).toContainText(
    "driving dimension",
  );

  // A single dimension row can open its inline editor from the popover.
  await page.getByTestId("edit-dimension").click();
  await expect(page.getByTestId("dimension-input")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("dimension-input")).toHaveCount(0);

  await page.keyboard.press("Backspace");
  await expect(page.locator("[data-dimension-id]")).toHaveCount(0);
  await expect(page.locator("[data-geometry-id]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a face offers new sketch and shell, never extrude", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await fitView(page);
  await page.mouse.click(700, 330);

  const face = page.getByTestId("face-selection-popover");
  await expect(face).toBeVisible();
  await expect(face.getByTestId("face-new-sketch")).toBeVisible();
  await expect(face.getByTestId("start-shell")).toBeVisible();
  await expect(face).not.toContainText("extrude");

  await face.getByTestId("face-new-sketch").click();
  await expect(page.getByTestId("support-popover")).toBeVisible();
  await expect(page.getByTestId("support-popover")).toContainText(
    "planar face",
  );
  expect(errors).toEqual([]);
});
