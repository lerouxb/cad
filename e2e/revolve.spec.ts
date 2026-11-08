import { expect } from "@playwright/test";
import { collectErrors, resetExample, test, volume } from "./support/app";
import { clickSketch, dragSketch } from "./support/sketch";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

async function newSketch(page: Parameters<typeof clickSketch>[0]) {
  await page.getByTestId("clear-document").click();
  await page.getByTestId("insert-gap-start").click();
  await page.getByTestId("insert-sketch").click();
  await page.getByTestId("new-sketch").click();
}

test("revolves a rectangle around Y into a tube", async ({ app: page }) => {
  const errors = collectErrors(page);
  await newSketch(page);
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [10, -10], [20, 10]);
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-select").click();

  await clickSketch(page, 15, 5);
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  await page.getByTestId("profile-revolve").click();
  await expect(page.getByTestId("revolve-popover")).toBeVisible();
  await expect(page.getByTestId("revolve-axis")).toContainText("pick one");
  await expect(page.getByTestId("revolve-apply")).toBeDisabled();

  // The axis row enters a candidate pick; clicking the Y reference sets it
  // without stacking a selection popover over the revolve form.
  await page.getByTestId("revolve-axis-pick").click();
  await clickSketch(page, 0, 5);
  await expect(page.getByTestId("revolve-axis")).toContainText("Y axis");
  await expect(page.getByTestId("selection-panel")).toHaveCount(0);
  const full = 6000 * Math.PI;
  await expect.poll(() => volume(page)).toBeCloseTo(full, -1);

  await page.getByTestId("revolve-apply").click();
  const step = page.locator('[data-feature-type="revolve"]');
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect(step.locator(".tree-meta")).toContainText("1 profile · 360°");
  await expect.poll(() => volume(page)).toBeCloseTo(full, -1);

  await step.click();
  await expect(page.getByTestId("revolve-popover")).toBeVisible();
  await page.getByTestId("revolve-angle").fill("180");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(full / 2, -1);
  await expect(page.getByTestId("revolve-ccw")).toBeVisible();
  await page.getByTestId("revolve-cancel").click();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(full, -1);
  expect(errors).toEqual([]);
});

test("rejects a profile that crosses the axis", async ({ app: page }) => {
  const errors = collectErrors(page);
  await newSketch(page);
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-10, -10], [10, 10]);
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-select").click();

  await clickSketch(page, 5, 5);
  await page.getByTestId("profile-revolve").click();
  await page.getByTestId("revolve-axis-pick").click();
  await clickSketch(page, 0, 5);
  await expect(page.getByTestId("revolve-error")).toContainText(
    "crosses the axis",
  );
  await expect(page.getByTestId("revolve-apply")).toBeDisabled();
  await page.getByTestId("revolve-cancel").click();
  await expect(page.getByTestId("revolve-popover")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("uses a sketch line as the axis", async ({ app: page }) => {
  const errors = collectErrors(page);
  await newSketch(page);
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [10, -10], [20, 10]);
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-select").click();

  await clickSketch(page, 15, 5);
  await page.getByTestId("profile-revolve").click();
  await page.getByTestId("revolve-axis-pick").click();
  await clickSketch(page, 10, 5);
  await expect(page.getByTestId("revolve-axis")).toContainText("line 4");
  const full = 2000 * Math.PI;
  await expect.poll(() => volume(page)).toBeCloseTo(full, -1);
  await page.getByTestId("revolve-apply").click();
  await expect(page.locator('[data-feature-type="revolve"]')).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});
