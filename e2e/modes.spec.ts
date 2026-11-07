import { expect } from "@playwright/test";
import { resetExample, test } from "./support/app";
import { collectErrors, setSlider, volume } from "./support/app";
import { clickSketch, dragSketch, enterSketch } from "./support/sketch";
import { openInsert } from "./support/workflow";
import { fitView } from "./support/model";
import { examplePlateVolume } from "../src/core/doc/exampleMetrics";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

test("Enter only finishes an idle sketch, never a selection or a form", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // S1: with geometry selected, Enter is a no-op (it used to finish the
  // sketch from the old unguarded window listener).
  await clickSketch(page, 0, -20);
  await expect(page.getByTestId("selection-panel")).toHaveAttribute(
    "data-count",
    "1",
  );
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await expect(page.getByTestId("selection-panel")).toHaveAttribute(
    "data-count",
    "1",
  );

  // Escape pops the selection layer, not the stage.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("selection-panel")).toHaveCount(0);
  await expect(page.getByTestId("tool-select")).toBeVisible();

  // S0: now Enter finishes the sketch.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tool-select")).toBeHidden();
  await expect(page.getByTestId("model-tool-select")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Enter ends an armed sketch tool before it finishes the sketch", async ({
  app: page,
}) => {
  await enterSketch(page);
  await page.getByTestId("tool-line").click();
  await expect(page.getByTestId("tool-line")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tool-select")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("tool-select")).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("tool-select")).toBeHidden();
});

test("leaving an editor by timeline reverts it, like its cancel", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const plate = examplePlateVolume(12);
  await page.getByTestId("timeline-extrude").click();
  await expect(page.getByTestId("feature-popover")).toBeVisible();

  await setSlider(page.getByTestId("height-slider"), 30);
  await expect.poll(() => volume(page)).toBeCloseTo(examplePlateVolume(30), -1);

  // Timeline navigation is a cancel/revert, never a silent commit (D5/F14).
  await page.getByTestId("timeline-sketch").click();
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  await page.getByTestId("timeline-extrude").click();
  await expect(page.getByTestId("feature-popover")).toBeVisible();
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);
  expect(errors).toEqual([]);
});

test("a background click dismisses an editor without selecting through it", async ({
  app: page,
}) => {
  await page.getByTestId("timeline-extrude").click();
  await expect(page.getByTestId("feature-popover")).toBeVisible();
  await fitView(page);

  // A face interior that a normal click would pick. The dismissal swallows it
  // (F6): the operation closes and no body selection appears behind it.
  await page.mouse.click(700, 330);
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  await expect(page.getByTestId("body-pick")).toHaveCount(0);
});

test("Escape closes the support picker and the file menu one layer at a time", async ({
  app: page,
}) => {
  await openInsert(page, "sketch");
  await expect(page.getByTestId("support-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("support-popover")).toHaveCount(0);
  await expect(page.getByTestId("model-tool-select")).toBeVisible();

  await page.getByTestId("file-menu").click();
  await expect(page.getByTestId("file-menu-popover")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("file-menu-popover")).toHaveCount(0);
});

test("Escape on the sketch fillet restores the radius", async ({ app: page }) => {
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -30], [40, 30]);
  await page.keyboard.press("Escape");

  await clickSketch(page, -40, 0);
  await page.keyboard.down("Shift");
  await clickSketch(page, 0, -30);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection-panel")).toHaveAttribute(
    "data-count",
    "2",
  );

  await page.getByTestId("open-fillet").click();
  const radius = page.getByTestId("fillet-radius");
  const before = await radius.inputValue();
  await radius.fill("18");
  // R7: the field owns Escape while focused; the operation's Escape is the
  // same as its footer cancel once focus leaves the field.
  await radius.blur();
  await page.keyboard.press("Escape");

  // Escape and the footer cancel are the same restore (F9/R9).
  await expect(page.getByTestId("fillet-popover")).toHaveCount(0);
  await page.getByTestId("open-fillet").click();
  await expect(page.getByTestId("fillet-radius")).toHaveValue(before);
  await page.getByTestId("fillet-cancel").click();
});

test("a tool shortcut cancels the open form, then arms the tool", async ({
  app: page,
}) => {
  await page.getByTestId("timeline-extrude").click();
  await expect(page.getByTestId("feature-popover")).toBeVisible();
  await page.keyboard.press("l");
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  await expect(page.getByTestId("tool-line")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("svg.sketch-canvas")).toBeVisible();

  // Menus own their keys: a shortcut while the file menu is open is ignored.
  await page.getByTestId("file-menu").click();
  await expect(page.getByTestId("file-menu-popover")).toBeVisible();
  await page.keyboard.press("r");
  await expect(page.getByTestId("file-menu-popover")).toBeVisible();
  await expect(page.getByTestId("tool-line")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("file-menu-popover")).toHaveCount(0);
});

test("the export page closes before the timeline moves", async ({ app: page }) => {
  await page.getByTestId("file-menu").click();
  await page.getByTestId("open-export").click();
  await expect(page.getByTestId("export-page")).toBeVisible();

  await page.getByTestId("timeline-sketch").click();
  await expect(page.getByTestId("export-page")).toHaveCount(0);
  await expect(page.getByTestId("tool-select")).toBeVisible();
});

test("an outside click cancels an inline dimension editor", async ({
  app: page,
}) => {
  await enterSketch(page);
  const label = page.locator("[data-dimension-id]").first();
  await label.dblclick();
  await expect(page.getByTestId("dimension-input")).toBeVisible();
  await page.getByTestId("dimension-input").fill("80");

  // The click outside is a cancel (D4), not a commit.
  await page.mouse.click(200, 200);
  await expect(page.getByTestId("dimension-input")).toHaveCount(0);
  await expect(
    page.locator("[data-dimension-id]").filter({ hasText: "80" }),
  ).toHaveCount(0);
});

test("an empty sketch click keeps a new extrude draft", async ({ app: page }) => {
  await enterSketch(page);
  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeDisabled();

  // Pick the plate's material region, away from the hole and the axes.
  await clickSketch(page, -22, 5);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();

  // A far background point, clear of the draft popover that sits top-left.
  await page.mouse.click(1000, 520);
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeDisabled();
});
