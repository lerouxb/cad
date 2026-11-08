import { expect } from "@playwright/test";
import { resetExample, test } from "./support/app";
import {
  volume,
  meshBounds,
  activeStepMeta,
  collectErrors,
} from "./support/app";
import {
  clickSketch,
  dragSketch,
  enterSketch,
  readProfileRect,
} from "./support/sketch";
import {
  createSketch,
  finishSketchAndBuild,
} from "./support/workflow";
import { examplePlateVolume } from "../src/core/doc/exampleMetrics";
import { symmetricDoc, throughAllDoc } from "./support/fixtures";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});


test("extrudes a lone circle as a cylinder", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-circle").click();

  await clickSketch(page, 0, 0);
  await clickSketch(page, 20, 0);

  // The circle's automatic diameter dimension is the label source.
  const label = page.locator("[data-dimension-id]").filter({ hasText: "⌀" });
  const text = await label.textContent();
  const diameter = Number((text ?? "").replace(/[^\d.]/g, ""));
  expect(diameter).toBeGreaterThan(0);

  await finishSketchAndBuild(page);
  await expect.poll(() => volume(page)).toBeGreaterThan(0);
  const expected = Math.PI * (diameter / 2) ** 2 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect.poll(() => meshBounds(page)).toBe("-20,-20,0,20,20,12");
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute("data-faces", "3");

  expect(errors).toEqual([]);
});


test("uses a drawn inner rectangle as a hole", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();

  await dragSketch(page, [-40, -30], [40, 30]);
  const outerRect = await readProfileRect(page);
  const outerVolume =
    (outerRect.maxX - outerRect.minX) * (outerRect.maxY - outerRect.minY) * 12;
  await finishSketchAndBuild(page);
  await expect.poll(() => volume(page)).toBeCloseTo(outerVolume, -1);

  await page.getByTestId("timeline-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-20, -15], [20, 15]);
  await expect(page.locator("[data-region-id]")).toHaveCount(2);

  // The inner rectangle's points are in sketch millimetres; read them and
  // verify the extruded volume is the plate minus the inner area.
  await page.keyboard.press("Escape");
  const innerArea = await page.evaluate(() => {
    const handles = [...document.querySelectorAll("[data-point-id]")].slice(-4);
    const points = handles.map((handle) => [
      Number(handle.getAttribute("cx")),
      Number(handle.getAttribute("cy")),
    ]);
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      area += a[0]! * b[1]! - b[0]! * a[1]!;
    }
    return Math.abs(area / 2);
  });
  expect(innerArea).toBeGreaterThan(0);

  await finishSketchAndBuild(page);
  const expected = outerVolume - innerArea * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect.poll(() => meshBounds(page)).toBe("-40,-30,0,40,30,12");
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "10",
  );

  expect(errors).toEqual([]);
});


test("extrudes a filleted profile with a circular hole", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -30], [40, 30]);
  await page.keyboard.press("Escape");

  await clickSketch(page, -40, -10);
  await page.keyboard.down("Shift");
  await clickSketch(page, -20, -30);
  await page.keyboard.up("Shift");
  await page.getByTestId("open-fillet").click();
  await page.getByTestId("fillet-radius").fill("10");
  await page.getByTestId("constraint-fillet").click();

  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 20, 0);
  await page.keyboard.press("Escape");

  await page.getByTestId("timeline-extrude").click();
  const cut = 10 * 10 - Math.PI * 10 * 10 / 4;
  const hole = Math.PI * 20 * 20;
  await expect.poll(() => volume(page)).toBeCloseTo((80 * 60 - cut - hole) * 12, -1);

  expect(errors).toEqual([]);
});


test("selects and fuses multiple sketch regions", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();

  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [-40, -20], [-10, 20]);
  await dragSketch(page, [10, -20], [40, 20]);
  await page.keyboard.press("Escape");

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("popover-select-profiles").click();
  await expect(page.getByTestId("region-panel")).toBeVisible();
  await clickSketch(page, -25, -10);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 2 regions");
  await expect.poll(() => volume(page)).toBeCloseTo(30 * 40 * 12, -1);

  await page.getByTestId("all-regions").click();
  await expect(page.getByTestId("region-panel")).toContainText("2 of 2 regions");
  await expect.poll(() => volume(page)).toBeCloseTo(2 * 30 * 40 * 12, -1);

  await page.getByTestId("auto-region").click();
  await expect(page.getByTestId("region-panel")).toContainText("auto");
  await expect.poll(() => volume(page)).toBeCloseTo(30 * 40 * 12, -1);
  await page.getByTestId("finish-sketch").click();

  expect(errors).toEqual([]);
});


test("creates a new sketch and a joining extrude", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);
  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [0, 0], [40, 20]);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();
  await expect.poll(() => volume(page)).toBeCloseTo(40 * 20 * 12, -1);

  await createSketch(page);
  await expect(page.locator("[data-feature-id]")).toHaveCount(9);
  await expect(
    page
      .locator('[data-feature-type="sketch"]')
      .filter({ hasText: "Sketch 3" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("tool-select")).toBeVisible();

  await page.getByTestId("tool-rect").click();
  await dragSketch(page, [40, 0], [80, 20]);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();

  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeDisabled();
  await clickSketch(page, 60, 10);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-apply").click();
  await expect(page.locator("[data-feature-id]")).toHaveCount(10);
  await expect(
    page.locator('[data-feature-type="extrude"]').last(),
  ).toContainText("Extrude 4");
  await expect.poll(() => volume(page)).toBeCloseTo(80 * 20 * 12, -1);
  // Clearing the example's base sketch legitimately loses the face supports of
  // the mounting sketch and the midplane, so the whole history is not "ok".
  // The new sketch and join must still build cleanly.
  await expect(
    page.locator('[data-feature-type="extrude"]').last(),
  ).toHaveAttribute("data-status", "ok");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "error",
  );
  await expect(page.getByTestId("timeline")).toHaveAttribute(
    "data-lost-supports",
    "2",
  );
  expect(errors).toEqual([]);
});


test("new extrude picks profiles from the selected sketch", async ({ app: page }) => {
  // Selection is explicit: choose the sketch first, then extrude it.
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Mounting holes" })
    .click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeDisabled();
  await expect(page.getByTestId("region-panel")).toContainText("select profiles");

  await clickSketch(page, -18, 0);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 2 regions");
  await page.keyboard.down("Shift");
  await clickSketch(page, 18, 0);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("region-panel")).toContainText("2 of 2 regions");
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();

  await page.getByTestId("extrude-operation-cut").click();
  await page.getByTestId("extrude-end").selectOption("throughAll");
  await page.getByTestId("extrude-apply").click();

  const expected =
    examplePlateVolume() - 2 * Math.PI * 3 * 3 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect(
    page.locator('[data-feature-type="extrude"]').last(),
  ).toContainText("Extrude 4");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
});


test("edits, suppresses and deletes an extrude", async ({ app: page }) => {
  const plate12 = examplePlateVolume();
  await expect.poll(() => volume(page)).toBeCloseTo(plate12, -1);

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-height").fill("30");
  const plate30 = examplePlateVolume(30);
  await expect.poll(() => volume(page)).toBeCloseTo(plate30, -1);

  await page.getByTestId("extrude-symmetric").click();
  await expect(page.getByTestId("extrude-symmetric")).toContainText("symmetric");
  await expect.poll(() => meshBounds(page)).toBe("-30,-20,-15,30,20,15");

  await page.getByTestId("extrude-operation-join").click();
  await expect.poll(() => volume(page)).toBeCloseTo(plate30, -1);
  await page.getByTestId("extrude-operation-new").click();

  await page.getByTestId("feature-popover-apply").click();
  await page.getByTestId("feature-suppress").click();
  await expect(page.getByTestId("timeline-extrude")).toHaveAttribute(
    "data-status",
    "skipped",
  );
  await expect(page.getByTestId("mesh-stats")).toHaveCount(0);
  await page.getByTestId("feature-suppress").click();
  await expect.poll(() => volume(page)).toBeCloseTo(plate30, -1);

  await page.getByTestId("feature-delete").click();
  await expect(page.locator("[data-feature-id]")).toHaveCount(5);
  await expect(page.getByTestId("timeline-extrude")).toHaveAttribute(
    "data-status",
    "skipped",
  );
  await page.getByTestId("undo").click();
  await expect(page.locator("[data-feature-id]")).toHaveCount(8);
  await expect.poll(() => volume(page)).toBeCloseTo(plate30, -1);
});


test("cancel restores the previous extrude and discards a draft", async ({
  app: page,
}) => {
  const plate12 = examplePlateVolume();
  await expect.poll(() => volume(page)).toBeCloseTo(plate12, -1);

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-height").fill("30");
  await page.getByTestId("extrude-symmetric").click();
  const plate30 = examplePlateVolume(30);
  await expect.poll(() => volume(page)).toBeCloseTo(plate30, -1);
  await expect(page.getByTestId("feature-popover")).toContainText(
    "30 mm · new body · symmetric · 1 profile",
  );

  await page.getByTestId("feature-popover-cancel").click();
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  await expect.poll(() => volume(page)).toBeCloseTo(plate12, -1);
  await expect(activeStepMeta(page)).toContainText("12 mm");
  await expect(activeStepMeta(page)).toContainText("one side");

  // Cancel also leaves profile-selection mode and returns to the model.
  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("popover-select-profiles").click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await page.getByTestId("feature-popover-cancel").click();
  await expect(page.getByTestId("tool-select")).toBeHidden();

  // Cancelling a draft never creates a feature.
  await page.getByTestId("timeline-sketch").click();
  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.locator("[data-feature-id]")).toHaveCount(8);
  await page.getByTestId("extrude-cancel").click();
  await expect(page.getByTestId("extrude-draft-popover")).toHaveCount(0);
  await expect(page.locator("[data-feature-id]")).toHaveCount(8);
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await page.getByTestId("timeline-extrude").click();
  await expect.poll(() => volume(page)).toBeCloseTo(plate12, -1);
});


test("builds a symmetric extrude around the sketch plane", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(symmetricDoc()));
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect.poll(() => volume(page)).toBeCloseTo(40 * 20 * 10, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,-5,40,20,5");
  await context.close();
});


test("cuts through the whole body from a through-all extrude", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(throughAllDoc()));
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  const expected = 80 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,80,40,12");
  await context.close();
});
