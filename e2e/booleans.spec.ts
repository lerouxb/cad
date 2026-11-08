import { expect } from "@playwright/test";
import { collectErrors, resetExample, test, volume } from "./support/app";
import { clickSketch, dragSketch } from "./support/sketch";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

test("join previews added material", async ({ app: page }) => {
  const errors = collectErrors(page);
  const pin = page
    .locator('[data-feature-type="extrude"]')
    .filter({ hasText: "Center pin" });
  await pin.click();
  await page.getByTestId("feature-suppress").click();
  await expect(pin).toHaveAttribute("data-status", "ok");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);

  await pin.click();
  await expect(page.getByTestId("feature-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-operation-new")).toBeVisible();
  await expect(page.getByTestId("extrude-operation-join")).toBeVisible();
  await expect(page.getByTestId("extrude-operation-cut")).toBeVisible();
  await expect(page.getByTestId("extrude-operation-intersect")).toBeVisible();
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-offset-diff", "added");
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-offset-diff-added")),
    )
    .toBeGreaterThan(0);
  await page.getByTestId("feature-popover-cancel").click();
  expect(errors).toEqual([]);
});

test("intersect previews ghosted material and keeps only the overlap", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page.getByTestId("insert-gap").last().click();
  await page.getByTestId("insert-sketch").click();
  await page.getByTestId("new-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [10, -10], [20, 10]);
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-select").click();
  await clickSketch(page, 15, 5);
  await page.getByTestId("profile-extrude").click();
  await page.getByTestId("extrude-height").fill("12");
  await page.getByTestId("extrude-operation-intersect").click();

  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-offset-diff", "ghost");
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-offset-diff-ghost")),
    )
    .toBeGreaterThan(0);
  const overlap = 200 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(overlap, -1);
  await page.getByTestId("extrude-apply").click();
  await expect(
    page.locator('[data-feature-type="extrude"]').last(),
  ).toHaveAttribute("data-status", "ok");
  await expect.poll(() => volume(page)).toBeCloseTo(overlap, -1);
  expect(errors).toEqual([]);
});

test("cut previews removed material in red with a ghost cutter", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const cut = page
    .locator('[data-feature-type="extrude"]')
    .filter({ hasText: "Mounting holes cut" });
  await cut.click();
  await page.getByTestId("feature-suppress").click();
  await expect(cut).toHaveAttribute("data-status", "ok");
  await page.keyboard.press("Escape");
  await cut.click();

  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-offset-diff", "removed,ghost");
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-offset-diff-removed")),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-offset-diff-ghost")),
    )
    .toBeGreaterThan(0);
  await page.getByTestId("feature-popover-cancel").click();
  expect(errors).toEqual([]);
});

test("a first feature disables cut and intersect", async ({ app: page }) => {
  const errors = collectErrors(page);
  await page.getByTestId("clear-document").click();
  await page.getByTestId("insert-gap-start").click();
  await page.getByTestId("insert-sketch").click();
  await page.getByTestId("new-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [10, -10], [20, 10]);
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-select").click();
  await clickSketch(page, 15, 5);
  await page.getByTestId("profile-extrude").click();
  await expect(page.getByTestId("extrude-operation-new")).toBeEnabled();
  await expect(page.getByTestId("extrude-operation-join")).toBeEnabled();
  await expect(page.getByTestId("extrude-operation-cut")).toBeDisabled();
  await expect(page.getByTestId("extrude-operation-intersect")).toBeDisabled();
  await page.getByTestId("extrude-cancel").click();
  expect(errors).toEqual([]);
});
