import { expect } from "@playwright/test";
import { collectErrors, resetExample, test } from "./support/app";
import {
  fitView,
  pickRightFace,
  scanVisibleEdges,
  waitForCameraSettled,
} from "./support/model";
import { clickSketch, dragSketch, enterSketch } from "./support/sketch";
import { sketchOnPickedFace } from "./support/workflow";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

test("a blend form forces the edges filter and restores all", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await fitView(page);
  const edges = await scanVisibleEdges(page);
  expect(edges.length).toBeGreaterThan(0);
  const [edge] = edges;
  await page.mouse.click(edge!.x, edge!.y);
  await expect(page.getByTestId("body-selection-popover")).toBeVisible();
  await page.getByTestId("start-fillet").click();

  await expect(page.getByTestId("fillet-feature-popover")).toBeVisible();
  await expect(page.getByTestId("model-filter-edges")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("model-filter-all")).toBeDisabled();
  await expect(page.getByTestId("model-filter-faces")).toBeDisabled();
  await expect(page.getByTestId("fillet-feature-edges")).toHaveText(
    "1 selected",
  );

  // A face click is filtered out: it must not replace the edge input.
  await page.mouse.click(700, 330);
  await expect(page.getByTestId("fillet-feature-edges")).toHaveText(
    "1 selected",
  );

  await page.getByTestId("fillet-feature-cancel").click();
  await expect(page.getByTestId("fillet-feature-popover")).toHaveCount(0);
  await expect(page.getByTestId("model-filter-all")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("model-filter-all")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("an extrude form lists its profiles and removes one", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page.getByTestId("clear-document").click();
  await page.getByTestId("insert-gap-start").click();
  await page.getByTestId("insert-sketch").click();
  await page.getByTestId("new-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -20], [-10, 20]);
  await dragSketch(page, [10, -20], [40, 20]);
  await page.keyboard.press("Escape");
  await page.getByTestId("tool-select").click();

  await clickSketch(page, -25, -10);
  await page.getByTestId("profile-extrude").click();
  await page.keyboard.down("Shift");
  await clickSketch(page, 25, -10);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("extrude-profiles")).toHaveText("2 selected");
  await expect(
    page.getByTestId("extrude-profile-list").locator(".selection-item"),
  ).toHaveCount(2);

  await page.getByTestId("extrude-remove-profile-1").click();
  await expect(page.getByTestId("extrude-profiles")).toHaveText("1 selected");
  await expect(
    page.getByTestId("extrude-profile-list").locator(".selection-item"),
  ).toHaveCount(1);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-cancel").click();
  expect(errors).toEqual([]);
});

test("a new extrude draft opens in the model and can look at the sketch", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await clickSketch(page, -20, 10);
  await page.getByTestId("profile-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("model-tool-select")).toBeVisible();
  await expect(page.getByTestId("extrude-profiles")).toHaveText("1 selected");
  await expect(page.getByTestId("mesh-stats")).toBeVisible();

  // The preview owns the canvas, so the ordinary pick tools are a read-only
  // row. Their shortcuts are inert too: `m` must not open measure behind the
  // draft, and `b` must not arm a marquee over the preview.
  await expect(page.getByTestId("model-tool-select")).toBeDisabled();
  await expect(page.getByTestId("model-tool-box")).toBeDisabled();
  await expect(page.getByTestId("model-tool-measure")).toBeDisabled();
  await expect(page.getByTestId("model-filter-all")).toBeDisabled();
  await page.keyboard.press("m");
  await page.keyboard.press("b");
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("model-tool-box")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await page.getByTestId("draft-look-at-sketch").click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await page.getByTestId("draft-view-3d").click();
  await expect(page.getByTestId("model-tool-select")).toBeVisible();
  await expect(page.getByTestId("model-tool-select")).toBeDisabled();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-profiles")).toHaveText("1 selected");

  await page.getByTestId("extrude-cancel").click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a face sketch draft frames the view on its plane", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickRightFace(page);
  await sketchOnPickedFace(page);
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 5, 0);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();
  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("model-tool-select")).toBeVisible();
  await waitForCameraSettled(page);

  // The right (+X) face frame is x = +Y, y = +Z, normal = +X. The oblique
  // drafting direction therefore points to (0.75, 0.9, -1.15): the camera sits
  // on the face's side and below the sketch, not at the canned world iso
  // (0.9, -1.15, 0.75), which looks at the face from above and would make the
  // plane read edge-on from the wrong side.
  const camera = (
    await page
      .locator("canvas.viewport-canvas")
      .getAttribute("data-camera")
  )!
    .split(",")
    .map(Number);
  const direction = [
    camera[0]! - camera[3]!,
    camera[1]! - camera[4]!,
    camera[2]! - camera[5]!,
  ];
  const length = Math.hypot(...direction);
  expect(direction[2]! / length).toBeLessThan(-0.4);

  await page.getByTestId("extrude-cancel").click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a background click or orbit does not dismiss a model draft", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await clickSketch(page, -20, 10);
  await page.getByTestId("profile-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("model-tool-select")).toBeVisible();

  // The canvas is the preview surface: a click and a drag are orbit gestures,
  // not a dismissal. The footer cancel remains the exit.
  await page.mouse.click(1000, 400);
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await page.mouse.move(1000, 400);
  await page.mouse.down();
  await page.mouse.move(900, 440, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-profiles")).toHaveText("1 selected");

  await page.getByTestId("extrude-cancel").click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a revolve form lists profiles and Escape exits the axis pick first", async ({
  app: page,
}) => {
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

  await expect(page.getByTestId("revolve-profiles")).toHaveText("1 selected");
  await expect(
    page.getByTestId("revolve-profile-list").locator(".selection-item"),
  ).toHaveCount(1);
  // A new draft opens on the model, so the row offers the sketch switch.
  await expect(page.getByTestId("revolve-select-profiles")).toHaveText(
    "select",
  );

  await page.getByTestId("revolve-axis-pick").click();
  await expect(page.getByTestId("revolve-axis-pick")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("[data-axis-candidate]").first()).toBeAttached();

  // First Escape leaves the form in place and only exits the pick.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revolve-popover")).toBeVisible();
  await expect(page.getByTestId("revolve-axis-pick")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // The next Escape cancels the draft.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revolve-popover")).toHaveCount(0);
  expect(errors).toEqual([]);
});
