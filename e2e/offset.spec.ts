import { expect } from "@playwright/test";
import {
  collectErrors,
  resetExample,
  test,
  volume,
} from "./support/app";
import {
  fitView,
  pickCylindricalFace,
  pickRightFace,
  pickTopFace,
} from "./support/model";
import { clickSketch, dragSketch } from "./support/sketch";
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
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-offset-ghost", "on");

  await page.getByTestId("offset-face-distance").fill("5");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume(17), -1);
  await expect(canvas).toHaveAttribute("data-offset-diff", "added");
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-offset-diff-added")),
    )
    .toBeGreaterThan(0);

  await page.getByTestId("offset-face-apply").click();
  const step = page.locator('[data-feature-type="offset"]');
  await expect(step).toHaveCount(1);
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect(step.locator(".tree-meta")).toContainText("5 mm · out");
  await expect(page.getByTestId("offset-face-popover")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-offset-ghost", "");
  await expect(canvas).toHaveAttribute("data-offset-diff", "");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume(17), -1);

  // The same-domain merge keeps the plate's face count unchanged: the four
  // side walls and the hole wall continue, there is no ring of extra faces.
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "7",
  );
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


test("keeps the offset preview colour when the highlighter changes", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("5");
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-offset-diff", "added");

  // Draft: out uses the current highlighter; in uses cut red + ghost.
  await page.getByTestId("highlight-pink").click();
  await expect(canvas).toHaveAttribute("data-highlight-color", "#ff5cbc");
  await expect(canvas).toHaveAttribute(
    "data-offset-diff-colors",
    "#ff5cbc",
  );
  // The appearance change also re-materialises the preview.
  await page.getByTestId("theme-night").click();
  await expect(canvas).toHaveAttribute("data-highlight-color", "#ff79c9");
  await expect(canvas).toHaveAttribute(
    "data-offset-diff-colors",
    "#ff79c9",
  );
  await page.getByTestId("theme-day").click();
  await expect(canvas).toHaveAttribute("data-highlight-color", "#ff5cbc");
  await page.getByTestId("offset-face-in").click();
  await expect(canvas).toHaveAttribute("data-offset-diff", "removed");
  await page.getByTestId("offset-face-out").click();
  await expect(canvas).toHaveAttribute(
    "data-offset-diff-colors",
    "#ff5cbc",
  );

  // Edit: the re-opened step must take the new colour too.
  await page.getByTestId("offset-face-apply").click();
  const step = page.locator('[data-feature-type="offset"]');
  await step.click();
  await expect(page.getByTestId("offset-face-popover")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-offset-diff", "added");
  await page.getByTestId("highlight-blue").click();
  await expect(canvas).toHaveAttribute("data-highlight-color", "#3ec8ff");
  await expect(canvas).toHaveAttribute(
    "data-offset-diff-colors",
    "#3ec8ff",
  );
  await page.getByTestId("offset-face-in").click();
  await expect(canvas).toHaveAttribute("data-offset-diff", "removed");
  await page.getByTestId("offset-face-out").click();
  await expect(canvas).toHaveAttribute(
    "data-offset-diff-colors",
    "#3ec8ff",
  );
  await page.getByTestId("offset-face-cancel").click();
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
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "7",
  );
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

test("offsets a through hole wall and shows the diameter change", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const plate = examplePlateVolume();
  await pickCylindricalFace(page, (ref) => ref.hint?.radius === 8);
  await expect(page.getByTestId("face-selection-popover")).toHaveAttribute(
    "data-count",
    "1",
  );

  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("2");
  await expect(page.getByTestId("offset-face-diameter")).toContainText(
    "Ø 16.0 → 12.0 mm",
  );
  const shrunk = plate + Math.PI * (64 - 36) * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(shrunk, -1);
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-offset-diff", "added");
  await page.getByTestId("offset-face-apply").click();

  const step = page.locator('[data-feature-type="offset"]');
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(shrunk, -1);
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "7",
  );
  await expect(page.getByTestId("body-health")).toHaveAttribute(
    "data-valid",
    "true",
  );

  // The same step reopens: in grows the hole to Ø20.
  await step.click();
  await expect(page.getByTestId("offset-face-popover")).toBeVisible();
  await page.getByTestId("offset-face-in").click();
  await expect(page.getByTestId("offset-face-diameter")).toContainText(
    "Ø 16.0 → 20.0 mm",
  );
  await expect(page.locator("canvas.viewport-canvas")).toHaveAttribute(
    "data-offset-diff",
    "removed",
  );
  const grown = plate - Math.PI * (100 - 64) * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(grown, -1);
  await page.getByTestId("offset-face-cancel").click();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(shrunk, -1);
  expect(errors).toEqual([]);
});


test("offsets a cylindrical wall of a revolve and keeps its preview colours", async ({
  app: page,
}) => {
  test.setTimeout(120_000);
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
  await page.getByTestId("profile-revolve").click();
  await page.getByTestId("revolve-axis-pick").click();
  await clickSketch(page, 0, 5);
  await page.getByTestId("revolve-apply").click();
  await expect(
    page.locator('[data-feature-type="revolve"]'),
  ).toHaveAttribute("data-status", "ok");
  const tube = Math.PI * (20 * 20 - 10 * 10) * 20;
  await expect.poll(() => volume(page)).toBeCloseTo(tube, -1);

  // The outer wall is a full cylindrical boss on the revolve.
  await pickCylindricalFace(page, (ref) => ref.hint?.radius === 20);
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("2");
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-offset-diff", "added");
  await page.getByTestId("highlight-pink").click();
  await expect(canvas).toHaveAttribute(
    "data-offset-diff-colors",
    "#ff5cbc",
  );
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(tube + Math.PI * (22 * 22 - 20 * 20) * 20, -1);

  // The same form's inward direction is removed material in cut red.
  await page.getByTestId("offset-face-in").click();
  await expect(canvas).toHaveAttribute("data-offset-diff", "removed");
  await expect(canvas).toHaveAttribute("data-offset-diff-colors", "#b83b3b");
  await page.getByTestId("offset-face-apply").click();

  // Re-open the history step and change the highlighter again.
  const step = page.locator('[data-feature-type="offset"]');
  await expect(step).toHaveAttribute("data-status", "ok");
  await step.click();
  await expect(page.getByTestId("offset-face-popover")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-offset-diff", "removed");
  await page.getByTestId("highlight-blue").click();
  await expect(canvas).toHaveAttribute(
    "data-offset-diff-colors",
    "#b83b3b",
  );
  await page.getByTestId("offset-face-out").click();
  await expect(canvas).toHaveAttribute(
    "data-offset-diff-colors",
    "#3ec8ff",
  );
  await page.getByTestId("offset-face-cancel").click();
  expect(errors).toEqual([]);
});

test("offsets the exposed wall of a cylindrical boss", async ({ app: page }) => {
  const errors = collectErrors(page);
  const pin = page
    .locator('[data-feature-type="extrude"]')
    .filter({ hasText: "Center pin" });
  await pin.click();
  await page.getByTestId("feature-suppress").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);

  const base = examplePlateVolume() + Math.PI * 64 * 20;
  await expect.poll(() => volume(page)).toBeCloseTo(base, -1);

  await pickCylindricalFace(
    page,
    (ref) => ref.hint?.radius === 8 && (ref.hint?.centroid?.[2] ?? 0) > 12,
  );
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("2");
  await expect(page.getByTestId("offset-face-diameter")).toContainText(
    "Ø 16.0 → 20.0 mm",
  );
  // The exposed boss wall is the pin above the 12 mm plate.
  const grown = base + Math.PI * (100 - 64) * 8;
  await expect.poll(() => volume(page)).toBeCloseTo(grown, -1);
  await page.getByTestId("offset-face-apply").click();
  const step = page.locator('[data-feature-type="offset"]');
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(grown, -1);
  expect(errors).toEqual([]);
});


test("rejects a partial cylindrical face in the draft preview", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const fillet = page
    .locator('[data-feature-type="fillet"]')
    .filter({ hasText: "Rounded plate" });
  await fillet.click();
  await page.getByTestId("feature-suppress").click();
  await expect(fillet).toHaveAttribute("data-status", "ok");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("fillet-popover")).toHaveCount(0);

  await pickCylindricalFace(
    page,
    (ref) => Math.abs((ref.hint?.radius ?? 0) - 4) < 0.1,
  );
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("1");
  await expect(page.getByTestId("offset-face-error")).toContainText(
    "full cylindrical holes and bosses only",
  );
  await expect(page.getByTestId("offset-face-apply")).toBeDisabled();
  await page.getByTestId("offset-face-cancel").click();
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
  await expect(page.locator("canvas.viewport-canvas")).toHaveAttribute(
    "data-offset-ghost",
    "",
  );
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
  // The four rounds continue through the new height; no straight cap ring.
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "12",
  );
  expect(errors).toEqual([]);
});
