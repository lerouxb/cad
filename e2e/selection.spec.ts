import { expect } from "@playwright/test";
import { collectErrors, resetExample, test } from "./support/app";
import { clickSketch, dragSketch, enterSketch } from "./support/sketch";
import { fitView } from "./support/model";

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
