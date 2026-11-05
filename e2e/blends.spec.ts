import { expect, type Page } from "@playwright/test";
import { resetExample, test } from "./support/app";
import {
  setSlider,
  volume,
  collectErrors,
} from "./support/app";
import {
  addVisibleEdges,
  fitView,
  waitForCameraSettled,
} from "./support/model";
import type { EdgeRefLike } from "./support/model";
import { examplePlateVolume } from "../src/core/doc/exampleMetrics";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});


/** Cross-section area removed by a constant-radius fillet on one corner. */
function filletRemoved(radius: number, height: number): number {
  return 4 * (radius * radius - (Math.PI * radius * radius) / 4) * height;
}

/**
 * Select the plate's four vertical edges and create a constant-radius fillet
 * from the selection popover. No single perspective view exposes all four
 * edges, so select the visible ones, orbit, and add the rest (selection is by
 * stable ref, so it survives the orbit).
 */
async function createPlateFillet(page: Page, radius = 2) {
  await fitView(page);
  const isVerticalPlateEdge = (ref: EdgeRefLike): boolean =>
    Math.abs((ref.hint?.length ?? 0) - 12) < 0.6 &&
    Math.abs((ref.hint?.midpoint?.[2] ?? 0) - 6) < 0.5 &&
    Boolean(ref.faces?.every((face) => face.hint?.surfaceType === "PLANE"));

  let vertical = await addVisibleEdges(page, isVerticalPlateEdge);
  if (vertical.length < 4) {
    await page.mouse.move(1080, 560);
    await page.mouse.down();
    await page.mouse.move(850, 560, { steps: 12 });
    await page.mouse.up();
    await waitForCameraSettled(page);
    vertical = await addVisibleEdges(page, isVerticalPlateEdge);
  }
  expect(vertical.map((ref) => ref.hint?.length)).toEqual([12, 12, 12, 12]);
  await expect(page.getByTestId("body-selection-popover")).toHaveAttribute(
    "data-count",
    "4",
  );

  await page.getByTestId("start-fillet").click();
  await expect(page.getByTestId("fillet-feature-popover")).toBeVisible();
  await expect(page.getByTestId("fillet-feature-edges")).toContainText(
    "4 edges",
  );
  await expect(
    page.getByTestId("fillet-feature-radius-slider"),
  ).toBeVisible();
  await page.getByTestId("fillet-feature-radius").fill(String(radius));
  await page.getByTestId("fillet-feature-apply").click();

  // The example ships a suppressed "Rounded plate" fillet; target the feature
  // this test just created, not the example's step.
  const step = page
    .locator('[data-feature-type="fillet"]')
    .filter({ hasNotText: "Rounded plate" });
  await expect(step).toHaveCount(1);
  return step;
}

test("creates a fillet on four vertical edges", async ({ app: page }) => {
  const errors = collectErrors(page);
  const canvas = page.locator("canvas.viewport-canvas");
  const step = await createPlateFillet(page);

  await expect(step).toHaveAttribute("data-status", "ok");
  await expect(step.locator(".tree-meta")).toContainText("R 2 mm · 4 edges");
  // The step highlight is the four rounds it generated, not the whole body.
  await expect(canvas).toHaveAttribute("data-feature-faces", "4");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume() - filletRemoved(2, 12), -1);
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "11",
  );
  expect(errors).toEqual([]);
});

test("a fillet survives an upstream height edit", async ({ app: page }) => {
  const errors = collectErrors(page);
  const step = await createPlateFillet(page);

  // A downstream height edit changes the hashes but keeps the face roles, so
  // the fillet's edge refs resolve again on the rebuilt body.
  await page.getByTestId("timeline-extrude").click();
  await setSlider(page.getByTestId("height-slider"), 20);
  await page.getByTestId("feature-popover-apply").click();
  // Move the history cursor past the fillet so it rebuilds on the taller plate.
  await step.click();
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume(20) - filletRemoved(2, 20), -1);
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "11",
  );
  expect(errors).toEqual([]);
});

test("an impossible fillet radius is a visible error and recovers", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const step = await createPlateFillet(page);
  await step.click();
  await expect(page.getByTestId("fillet-feature-popover")).toBeVisible();

  // An impossible radius is a visible error, never a silent drop.
  await page.getByTestId("fillet-feature-radius").fill("50");
  await expect(step).toHaveAttribute("data-status", "error");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "error",
  );
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "7",
  );

  // Recovering the radius rebuilds the fillet without another apply.
  await page.getByTestId("fillet-feature-radius").fill("2");
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume() - filletRemoved(2, 12), -1);
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "11",
  );
  await page.getByTestId("fillet-feature-apply").click();
  expect(errors).toEqual([]);
});


test("the example's suppressed fillet resolves on the plate", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const step = page
    .locator('[data-feature-type="fillet"]')
    .filter({ hasText: "Rounded plate" });
  await expect(step).toHaveCount(1);
  await step.click();
  await expect(step).toHaveAttribute("data-status", "skipped");
  await page.getByTestId("feature-suppress").click();
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect(step.locator(".tree-meta")).toContainText("R 4 mm · 4 edges");

  const plate = examplePlateVolume();
  const removed = 4 * (4 * 4 - (Math.PI * 4 * 4) / 4) * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate - removed, -1);
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute("data-faces", "11");
  expect(errors).toEqual([]);
});


test("the example's suppressed chamfer resolves on the plate", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const step = page
    .locator('[data-feature-type="chamfer"]')
    .filter({ hasText: "Beveled plate" });
  await expect(step).toHaveCount(1);
  await step.click();
  await expect(step).toHaveAttribute("data-status", "skipped");
  await page.getByTestId("feature-suppress").click();
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect(step.locator(".tree-meta")).toContainText("4 mm · 4 edges");

  const plate = examplePlateVolume();
  const removed = 4 * ((4 * 4) / 2) * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(plate - removed, -1);
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute("data-faces", "11");
  expect(errors).toEqual([]);
});


test("cancelling the fillet editor does not re-suppress the step", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const step = page
    .locator('[data-feature-type="fillet"]')
    .filter({ hasText: "Rounded plate" });
  const plate = examplePlateVolume();
  const removed = 4 * (4 * 4 - (Math.PI * 4 * 4) / 4) * 12;

  await step.click();
  await expect(page.getByTestId("fillet-feature-popover")).toBeVisible();
  await page.getByTestId("feature-suppress").click();
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect.poll(() => volume(page)).toBeCloseTo(plate - removed, -1);

  // An empty canvas click cancels the blend editor; like the extrude form it
  // restores the edited parameters, never the suppression.
  await page.mouse.click(1100, 180);
  await expect(page.getByTestId("fillet-feature-popover")).toHaveCount(0);
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect.poll(() => volume(page)).toBeCloseTo(plate - removed, -1);
  expect(errors).toEqual([]);
});


test("creates a chamfer from selected edges with a live preview", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await fitView(page);

  // The plate's 60 mm top/bottom edges are the long ones; the scan adds the
  // visible ones and leaves the 40 mm and 12 mm edges alone.
  const selected = await addVisibleEdges(
    page,
    (ref) => Math.abs((ref.hint?.length ?? 0) - 60) < 0.6,
  );
  expect(selected.length).toBeGreaterThan(0);
  await expect(page.getByTestId("body-selection-popover")).toHaveAttribute(
    "data-count",
    String(selected.length),
  );

  await page.getByTestId("start-chamfer").click();
  await expect(page.getByTestId("chamfer-feature-popover")).toBeVisible();
  await expect(page.getByTestId("chamfer-feature-edges")).toContainText(
    `${selected.length} edge`,
  );
  await expect(page.getByTestId("chamfer-feature-distance-slider")).toBeVisible();

  const plate = examplePlateVolume();
  const removedAt = (distance: number): number =>
    selected.length * ((distance * distance) / 2) * 60;
  await page.getByTestId("chamfer-feature-distance").fill("2");
  await expect.poll(() => volume(page)).toBeCloseTo(plate - removedAt(2), -1);
  await page.getByTestId("chamfer-feature-distance").fill("3");
  await expect.poll(() => volume(page)).toBeCloseTo(plate - removedAt(3), -1);
  await page.getByTestId("chamfer-feature-apply").click();

  const step = page
    .locator('[data-feature-type="chamfer"]')
    .filter({ hasNotText: "Beveled plate" });
  await expect(step).toHaveCount(1);
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect(step.locator(".tree-meta")).toContainText(
    `3 mm · ${selected.length} edge`,
  );
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    String(7 + selected.length),
  );
  expect(errors).toEqual([]);
});
