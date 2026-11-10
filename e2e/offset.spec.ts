import { expect, type Page } from "@playwright/test";
import {
  collectErrors,
  resetExample,
  test,
  volume,
} from "./support/app";
import {
  addVisibleEdges,
  fitView,
  pickCylindricalFace,
  pickRightFace,
  pickTopFace,
} from "./support/model";
import { clickSketch, dragSketch } from "./support/sketch";
import { createSketch } from "./support/workflow";
import {
  exampleBounds,
  examplePlateVolume,
} from "../src/core/doc/exampleMetrics";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

/**
 * Plug the lower 7 mm of the example's central through hole, leaving a blind
 * Ø16 × 5 hole with a planar bottom cap. The wall is large enough to pick
 * reliably with the shared face scan.
 */
async function createBlindCentralHole(page: Page): Promise<void> {
  await createSketch(page);
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 8.1, 0);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();
  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 0, 0);
  await page.getByTestId("extrude-height").fill("7");
  await page.getByTestId("extrude-apply").click();
}

/** A D-shaped boss: a Ø20 half-cylinder with a flat radial back wall. */
async function createDHalfBoss(page: Page): Promise<void> {
  await page.getByTestId("clear-document").click();
  await page.getByTestId("insert-gap-start").click();
  await page.getByTestId("insert-sketch").click();
  await expect(page.getByTestId("support-popover")).toBeVisible();
  await page.getByTestId("new-sketch").click();
  await page.getByTestId("tool-arc").click();
  await clickSketch(page, 10, 0);
  await clickSketch(page, -10, 0);
  await clickSketch(page, 0, 10);
  await page.getByTestId("tool-line").click();
  await clickSketch(page, -10, 0);
  await clickSketch(page, 10, 0);
  await page.keyboard.press("Enter");
  await page.getByTestId("finish-sketch").click();
  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 0, 5);
  await page.getByTestId("extrude-height").fill("10");
  await page.getByTestId("extrude-apply").click();
}

test("offsets the top face out and in as a history step", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await page.getByTestId("start-offset-face").click();
  await expect(page.getByTestId("offset-face-popover")).toBeVisible();
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-offset-ghost", "on");
  await expect(canvas).toHaveAttribute("data-offset-hint-arrows", "1");
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-offset-hint-segments")),
    )
    .toBeGreaterThan(0);

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
  await expect(canvas).toHaveAttribute("data-offset-hint-arrows", "");
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


test("offsets a blind hole with a planar bottom cap", async ({ app: page }) => {
  const errors = collectErrors(page);
  await createBlindCentralHole(page);
  const blind = examplePlateVolume() + Math.PI * 64 * 7;
  await expect.poll(() => volume(page)).toBeCloseTo(blind, -1);

  await pickCylindricalFace(page, (ref) => ref.hint?.radius === 8);
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("1");
  await expect(page.getByTestId("offset-face-diameter")).toContainText(
    "Ø 16.0 → 14.0 mm",
  );
  // `out` shrinks a hole: the annular tube ends at the blind bottom.
  const shrunk = blind + Math.PI * (64 - 49) * 5;
  await expect.poll(() => volume(page)).toBeCloseTo(shrunk, -1);
  await page.getByTestId("offset-face-apply").click();
  const step = page.locator('[data-feature-type="offset"]').last();
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect.poll(() => volume(page)).toBeCloseTo(shrunk, -1);

  // `in` grows the blind hole with a larger cut; the bottom stays at z=7.
  await step.click();
  await expect(page.getByTestId("offset-face-popover")).toBeVisible();
  await page.getByTestId("offset-face-in").click();
  const grown = blind - Math.PI * (81 - 64) * 5;
  await expect(page.getByTestId("offset-face-diameter")).toContainText(
    "Ø 16.0 → 18.0 mm",
  );
  await expect.poll(() => volume(page)).toBeCloseTo(grown, -1);
  await page.getByTestId("offset-face-cancel").click();
  await expect.poll(() => volume(page)).toBeCloseTo(shrunk, -1);
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-bbox",
    exampleBounds(),
  );
  expect(errors).toEqual([]);
});

test("offsets a partial cylindrical boss with planar radial caps", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await createDHalfBoss(page);
  const before = (Math.PI * 100) / 2 * 10;
  await expect.poll(() => volume(page)).toBeCloseTo(before, -1);

  await pickCylindricalFace(
    page,
    (ref) => Math.abs((ref.hint?.radius ?? 0) - 10) < 0.1,
  );
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("1");
  await expect(page.getByTestId("offset-face-diameter")).toContainText(
    "Ø 20.0 → 22.0 mm",
  );
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(((Math.PI * 121) / 2) * 10, -1);
  await page.getByTestId("offset-face-apply").click();
  const step = page.locator('[data-feature-type="offset"]').last();
  await expect(step).toHaveAttribute("data-status", "ok");
  const bounds = (
    (await page.getByTestId("mesh-stats").getAttribute("data-bbox")) ?? ""
  )
    .split(",")
    .map(Number);
  // The arc tessellates just inside the true radius; compare it loosely.
  expect(bounds[0]).toBeCloseTo(-11, 1);
  expect(bounds[1]).toBeCloseTo(0, 1);
  expect(bounds[2]).toBeCloseTo(0, 1);
  expect(bounds[3]).toBeCloseTo(11, 1);
  expect(bounds[4]).toBeCloseTo(11, 1);
  expect(bounds[5]).toBeCloseTo(10, 1);

  // `in` shrinks the half-cylinder; the radial back wall stays put.
  await step.click();
  await expect(page.getByTestId("offset-face-popover")).toBeVisible();
  await page.getByTestId("offset-face-in").click();
  await expect(page.getByTestId("offset-face-diameter")).toContainText(
    "Ø 20.0 → 18.0 mm",
  );
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(((Math.PI * 81) / 2) * 10, -1);
  await page.getByTestId("offset-face-cancel").click();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(((Math.PI * 121) / 2) * 10, -1);
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


test("rejects a partial cylinder with tangent walls in the draft preview", async ({
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
    "not bounded by two straight radial caps",
  );
  await expect(page.getByTestId("offset-face-error")).toContainText(
    "partial cylinders with planar radial caps only",
  );
  await expect(page.getByTestId("offset-face-error")).toContainText(
    "before the fillet",
  );
  await expect(page.getByTestId("offset-face-apply")).toBeDisabled();
  await page.getByTestId("offset-face-cancel").click();
  expect(errors).toEqual([]);
});


test("names a top-edge fillet when the offset would undercut it", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await fitView(page);
  // Filleting a long top edge makes the top face tangent to a horizontal
  // cylinder; moving the top face along Z would leave that round behind.
  const selected = await addVisibleEdges(
    page,
    (ref) =>
      Math.abs((ref.hint?.length ?? 0) - 60) < 0.6 &&
      (ref.hint?.midpoint?.[2] ?? 0) > 10,
  );
  expect(selected.length).toBeGreaterThan(0);
  await page.getByTestId("start-fillet").click();
  await expect(page.getByTestId("fillet-feature-popover")).toBeVisible();
  await page.getByTestId("fillet-feature-radius").fill("2");
  await page.getByTestId("fillet-feature-apply").click();
  await page.keyboard.press("Escape");

  await pickTopFace(page);
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("1");
  await expect(page.getByTestId("offset-face-error")).toContainText(
    "top-edge fillet",
  );
  await expect(page.getByTestId("offset-face-error")).toContainText(
    "Move this offset before the fillet",
  );
  await expect(page.getByTestId("offset-face-apply")).toBeDisabled();
  await page.getByTestId("offset-face-cancel").click();
  expect(errors).toEqual([]);
});

test("follows a slanted wall by rebuilding the moved face", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await fitView(page);
  // Chamfer two long top edges, then move the top face up. The chamfer planes
  // stay put, so the new top face shrinks and the chamfers grow taller.
  const selected = await addVisibleEdges(
    page,
    (ref) =>
      Math.abs((ref.hint?.length ?? 0) - 60) < 0.6 &&
      (ref.hint?.midpoint?.[2] ?? 0) > 10,
  );
  expect(selected.length).toBeGreaterThan(0);
  await page.getByTestId("start-chamfer").click();
  await expect(page.getByTestId("chamfer-feature-popover")).toBeVisible();
  await page.getByTestId("chamfer-feature-distance").fill("2");
  await page.getByTestId("chamfer-feature-apply").click();
  await page.keyboard.press("Escape");

  const before = await volume(page);
  await pickTopFace(page);
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("1");
  await expect(page.getByTestId("offset-face-error")).toHaveCount(0);
  await expect(page.getByTestId("offset-face-apply")).toBeEnabled();
  const topArea = 60 * (40 - 2 * selected.length) - Math.PI * 8 * 8;
  const expected = before + topArea - 30 * selected.length;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);

  await page.getByTestId("offset-face-apply").click();
  const step = page.locator('[data-feature-type="offset"]').last();
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(expected, -1);
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-bbox",
    exampleBounds(13),
  );

  // Inward uses the same moved outline as a cut. Moving the plane down grows
  // the top face, so the removed volume is larger than the outward addition.
  await step.click();
  await expect(page.getByTestId("offset-face-popover")).toBeVisible();
  await page.getByTestId("offset-face-in").click();
  await page.getByTestId("offset-face-distance").fill("1");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(before - (topArea + 30 * selected.length), -1);
  await page.getByTestId("offset-face-cancel").click();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(expected, -1);
  expect(errors).toEqual([]);
});

test("follows a slanted vertical wall on a side face", async ({ app: page }) => {
  const errors = collectErrors(page);
  // The example's suppressed chamfer runs along the four vertical edges, so
  // the +X face is bounded by two slanted planar chamfers.
  const chamfer = page
    .locator('[data-feature-type="chamfer"]')
    .filter({ hasText: "Beveled plate" });
  await chamfer.click();
  await page.getByTestId("feature-suppress").click();
  await expect(chamfer).toHaveAttribute("data-status", "ok");
  await page.keyboard.press("Escape");
  // Wait for the unsuppressed chamfer's rebuild before reading the baseline.
  const plate = examplePlateVolume() - 4 * ((4 * 4) / 2) * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);
  const before = await volume(page);
  await pickRightFace(page);
  await page.getByTestId("start-offset-face").click();
  await page.getByTestId("offset-face-distance").fill("1");
  await expect(page.getByTestId("offset-face-error")).toHaveCount(0);
  // The chamfer planes stay put: the 4 mm bevel makes the face 32 mm wide at
  // x=30 and 30 mm wide at x=31, so the added volume is 12 × 31 = 372 mm³.
  const expected = before + 12 * 31;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await page.getByTestId("offset-face-apply").click();
  const step = page.locator('[data-feature-type="offset"]').last();
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(expected, -1);
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-bbox",
    "-30,-20,0,31,20,12",
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
    "11",
  );
  expect(errors).toEqual([]);
});
