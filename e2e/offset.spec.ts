import { expect } from "@playwright/test";
import {
  collectErrors,
  resetExample,
  test,
  volume,
} from "./support/app";
import {
  addFacePick,
  fitView,
  pickRightFace,
  pickTopFace,
} from "./support/model";
import {
  exampleBounds,
  examplePlateVolume,
} from "../src/core/doc/exampleMetrics";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

test("offsets the top face out and in as a history step", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await page.getByTestId("start-offset-face").click();
  await expect(page.getByTestId("offset-face-popover")).toBeVisible();

  await page.getByTestId("offset-face-distance").fill("5");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume(17), -1);

  await page.getByTestId("offset-face-apply").click();
  const step = page.locator('[data-feature-type="offset"]');
  await expect(step).toHaveCount(1);
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect(step.locator(".tree-meta")).toContainText("5 mm · out");
  await expect(page.getByTestId("offset-face-popover")).toHaveCount(0);
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume(17), -1);

  const health = page.getByTestId("body-health");
  await expect(health).toHaveAttribute("data-bodies", "1");
  await expect(health).toHaveAttribute("data-valid", "true");

  // Re-open the step; the form edits live and cancel restores the baseline.
  await step.click();
  await expect(page.getByTestId("offset-face-popover")).toBeVisible();
  await page.getByTestId("offset-face-distance").fill("8");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume(20), -1);

  await page.getByTestId("offset-face-in").click();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume(4), -1);
  await page.getByTestId("offset-face-cancel").click();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume(17), -1);
  expect(errors).toEqual([]);
});


test("offsets a side wall and grows the plate", async ({ app: page }) => {
  const errors = collectErrors(page);
  await pickRightFace(page);
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("5");
  const plate = examplePlateVolume();
  await expect.poll(() => volume(page)).toBeCloseTo(plate + 40 * 12 * 5, -1);
  await page.getByTestId("offset-face-apply").click();

  const step = page.locator('[data-feature-type="offset"]');
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(plate + 40 * 12 * 5, -1);
  await fitView(page);
  const bounds = await page
    .getByTestId("mesh-stats")
    .getAttribute("data-bbox");
  expect(bounds?.split(",").map((value) => Math.round(Number(value)))).toEqual([
    -30, -20, 0, 35, 20, 12,
  ]);
  expect(exampleBounds()).toBe("-30,-20,0,30,20,12");
  expect(errors).toEqual([]);
});

test("rejects a curved face in the draft preview", async ({ app: page }) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  const topId = await page.getByTestId("body-pick").getAttribute("data-id");
  expect(topId).toBeTruthy();
  await addFacePick(page, new Set([topId!]));
  await expect(page.getByTestId("face-selection-popover")).toHaveAttribute(
    "data-count",
    "2",
  );

  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("5");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "error",
  );
  await expect(page.getByTestId("offset-face-error")).toContainText(
    "planar faces only",
  );
  await expect(page.getByTestId("offset-face-apply")).toBeDisabled();
  await page.getByTestId("offset-face-cancel").click();
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});

test("rejects an inward offset that removes the whole body", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-in").click();
  await page.getByTestId("offset-face-distance").fill("20");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "error",
  );
  await expect(page.getByTestId("offset-face-error")).toContainText(
    "did not produce a single body",
  );
  await expect(page.getByTestId("offset-face-apply")).toBeDisabled();
  await page.getByTestId("offset-face-cancel").click();
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});

test("Escape cancels the offset draft without a history step", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const plate = examplePlateVolume();
  await pickTopFace(page);
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("5");
  await expect.poll(() => volume(page)).toBeCloseTo(examplePlateVolume(17), -1);

  // R7: the focused number field owns Escape; click the popover head first.
  await page.locator(".stage-popover-head").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("offset-face-popover")).toHaveCount(0);
  await expect(page.locator('[data-feature-type="offset"]')).toHaveCount(0);
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);
  await expect(page.getByTestId("face-selection-popover")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("offsets the top face of a vertically filleted plate", async ({
  app: page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  const fillet = page
    .locator('[data-feature-type="fillet"]')
    .filter({ hasText: "Rounded plate" });
  await fillet.click();
  await page.getByTestId("feature-suppress").click();
  await expect(fillet).toHaveAttribute("data-status", "ok");
  // The step stays selected after the inline suppress action; close its editor
  // so the canvas is a pick surface.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("fillet-popover")).toHaveCount(0);
  const plate = examplePlateVolume();
  const removed = 4 * (4 * 4 - (Math.PI * 4 * 4) / 4) * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate - removed, -1);

  const before = await volume(page);
  await pickTopFace(page);
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("5");
  // A vertical fillet is prismatic along Z, so the sweep continues the same
  // planes and cylinders: the volume scales with the height.
  await expect
    .poll(() => volume(page))
    .toBeCloseTo((before * 17) / 12, -1);
  await page.getByTestId("offset-face-apply").click();
  await expect(
    page.locator('[data-feature-type="offset"]'),
  ).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo((before * 17) / 12, -1);
  expect(errors).toEqual([]);
});
