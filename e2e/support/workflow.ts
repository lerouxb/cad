import { expect, type Page } from "@playwright/test";
import { activeStepMeta } from "./app";
import { clickSketch } from "./sketch";

/** Open the insert menu in the gap after the active step. */
export async function clickGapAfterActive(page: Page): Promise<void> {
  const activeId = await page
    .getByTestId("timeline")
    .getAttribute("data-active-feature");
  if (activeId) {
    await page.locator(`[data-gap="${activeId}"]`).click();
    return;
  }
  const lastId = await page
    .locator("[data-feature-id]")
    .last()
    .getAttribute("data-feature-id");
  if (lastId) await page.locator(`[data-gap="${lastId}"]`).click();
  else await page.getByTestId("insert-gap-start").click();
}

/** Open the insert menu in the gap after the active step and pick a type. */
export async function openInsert(
  page: Page,
  kind: "sketch" | "plane",
): Promise<void> {
  await clickGapAfterActive(page);
  await page
    .getByTestId(kind === "sketch" ? "insert-sketch" : "insert-plane")
    .click();
}

/** Start a sketch on the currently selected face and check its projection. */
export async function sketchOnPickedFace(page: Page): Promise<void> {
  await openInsert(page, "sketch");
  await expect(page.getByTestId("support-popover")).toContainText(
    "selected face",
  );
  await expect(page.getByTestId("support-popover")).toContainText(
    "planar face",
  );
  await expect(page.getByTestId("new-sketch")).toBeEnabled();
  await page.getByTestId("new-sketch").click();

  await expect(activeStepMeta(page)).toContainText("Face ·");
  await expect(page.getByTestId("tool-select")).toBeVisible();
  // Horizontal SVG lines have a zero-height box, so `toBeVisible` is a false
  // negative here; the projected reference is present and dashed.
  await expect(page.locator("[data-projection-id]").first()).toBeAttached();
  await expect(page.locator("[data-projection-id]").first()).toHaveAttribute(
    "stroke-dasharray",
    "2 3",
  );
  await expect(page.locator("[data-projection-point-id]").first()).toBeAttached();
}

/** Create the demo face sketch and its 5 mm boss on the picked top face. */
export async function sketchBossOnPickedFace(page: Page): Promise<void> {
  await sketchOnPickedFace(page);

  // The sketch is plane-local at the face centroid; the projected outline is
  // fixed reference geometry. Draw a 5 mm circle inside the central hole.
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 5, 0);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();

  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 0, 0);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-height").fill("5");
  await page.getByTestId("extrude-apply").click();
}

/** Create a sketch through the explicit support popover (default support). */
export async function createSketch(page: Page): Promise<void> {
  await openInsert(page, "sketch");
  await expect(page.getByTestId("support-popover")).toBeVisible();
  await page.getByTestId("new-sketch").click();
}

/** Leave the sketch and move the history cursor to the extrude that builds it. */
export async function finishSketchAndBuild(page: Page): Promise<void> {
  await page.getByTestId("finish-sketch").click();
  await page.getByTestId("timeline-extrude").click();
}
