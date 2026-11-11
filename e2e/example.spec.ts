import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { loadExample, resetExample, test } from "./support/app";
import {
  setSlider,
  volume,
  meshBounds,
  collectErrors,
} from "./support/app";
import {
  clickSketch,
  dragScreen,
  enterSketch,
} from "./support/sketch";
import {
  clickGapAfterActive,
  createSketch,
} from "./support/workflow";
import { exampleBounds, examplePlateVolume, exampleSolidPlateVolume } from "../src/core/doc/exampleMetrics";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});


test("the sketch body reference follows the history cursor", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const references = page.locator("[data-body-reference]");

  // Editing the example's first sketch is before the first extrude: no body
  // exists at that step, so there is nothing to project. (The stage used to
  // keep the last built mesh in React state after clearing the viewport, so
  // this drew the *previous* document's body as construction-looking lines.)
  await page.getByTestId("timeline-sketch").click();
  await expect(references).toHaveCount(0);

  // A later world-plane sketch's prefix does have a body; its projected
  // outline is the example plate, not whatever happened to be on screen.
  // Insert after the extrude so the new sketch's prefix includes the body.
  await page.getByTestId("timeline-extrude").click();
  await createSketch(page);
  await expect(references.first()).toBeAttached();
  const box = await references.evaluateAll((lines) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const line of lines) {
      for (const key of ["x1", "x2"]) xs.push(Number(line.getAttribute(key)));
      for (const key of ["y1", "y2"]) ys.push(Number(line.getAttribute(key)));
    }
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  });
  expect(box.minX).toBeCloseTo(-30, 0);
  expect(box.maxX).toBeCloseTo(30, 0);
  expect(box.minY).toBeCloseTo(-20, 0);
  expect(box.maxY).toBeCloseTo(20, 0);

  // Loading the example resets the cursor to its first sketch and drops the
  // body with it, so no stale reference survives the document switch.
  await loadExample(page);
  await expect(references).toHaveCount(0);
  expect(errors).toEqual([]);
});


test("the dimensioned example drives an exact solid", async ({ app: page }) => {
  const errors = collectErrors(page);

  const stats = page.getByTestId("mesh-stats");
  await expect(stats).toBeVisible();
  await expect.poll(() => meshBounds(page)).toBe(exampleBounds());
  await expect(stats).toHaveAttribute("data-faces", "7");

  const plate = examplePlateVolume();
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);

  // The stage foot reports the body's real health, not just its size.
  const health = page.getByTestId("body-health");
  await expect(health).toHaveAttribute("data-bodies", "1");
  await expect(health).toHaveAttribute("data-shells", "1");
  await expect(health).toHaveAttribute("data-valid", "true");
  await expect(health).toContainText("1 body · 1 shell · watertight");

  await enterSketch(page);
  await expect(page.getByTestId("dof")).toContainText("Fully constrained");

  // A fully constrained sketch refuses to move.
  const corner = page.locator('[data-point-id="p1"]');
  const box = await corner.boundingBox();
  if (!box) throw new Error("Could not locate the sketch corner");
  await dragScreen(
    page,
    box.x + box.width / 2,
    box.y + box.height / 2,
    box.x + box.width / 2 + 45,
    box.y + box.height / 2 + 20,
  );

  // The sketch step is now the history cursor, so check the built body after
  // selecting the extrude it feeds.
  await page.getByTestId("timeline-extrude").click();
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);

  // Extrude height is an extrude-feature parameter, edited in the feature popover.
  await setSlider(page.getByTestId("height-slider"), 30);
  await page.getByTestId("feature-popover-apply").click();
  const taller = examplePlateVolume(30);
  await expect.poll(() => volume(page)).toBeCloseTo(taller, -1);

  // Drawing appends to the sketch instead of replacing it. A circle inside the
  // plate becomes another hole.
  await page.getByTestId("timeline-sketch").click();
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 20, -10);
  await clickSketch(page, 25, -10);

  // Build the extrude that consumes the edited sketch.
  await page.getByTestId("timeline-extrude").click();
  const withSecondHole = taller - Math.PI * 5 * 5 * 30;
  await expect.poll(() => volume(page)).toBeCloseTo(withSecondHole, -1);

  await page.keyboard.press("Control+z");
  await expect.poll(() => volume(page)).toBeCloseTo(taller, -1);

  expect(errors).toEqual([]);
});


test("selecting a step opens its editor instead of footer commands", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page.getByTestId("timeline-extrude").click();
  await expect(page.getByTestId("feature-popover")).toBeVisible();

  // Edit, rename and profile selection no longer duplicate what selecting the
  // step (or double-clicking its name) already does.
  const detail = page.getByTestId("timeline-detail");
  await expect(detail).not.toContainText("select profiles");
  await expect(detail).not.toContainText("rename");
  await expect(page.getByTestId("edit-feature")).toHaveCount(0);
  await expect(detail.getByTestId("extrude-profiles")).toHaveCount(0);

  // Profiles are picked from the same form that edits the feature.
  await page.getByTestId("popover-select-profiles").click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
  await page.getByTestId("feature-popover-cancel").click();
  await expect(page.getByTestId("tool-select")).toBeHidden();

  // A datum step opens its own editor the same way.
  const datum = page
    .locator('[data-feature-type="datum"]')
    .filter({ hasText: "Midplane" });
  await datum.click();
  await expect(page.getByTestId("datum-popover")).toBeVisible();
  await page.getByTestId("datum-popover-cancel").click();
  expect(errors).toEqual([]);
});


test("shows only the selected extrude's profiles on the model overlay", async ({
  app: page,
}) => {
  const canvas = page.locator("canvas.viewport-canvas");
  await page.getByTestId("timeline-extrude").click();
  await expect(page.getByTestId("feature-popover")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");
  // Extrude 1 uses the plate plus its central hole; construction and unused
  // curves are hidden until profile selection. The selected profile is shaded,
  // with the hole left open.
  await expect(canvas).toHaveAttribute("data-sketch-curves", "2");
  await expect(canvas).toHaveAttribute("data-sketch-fills", "1");
  // The sketch is real geometry on its plane: the body must occlude it rather
  // than the overlay always painting on top.
  await expect(canvas).toHaveAttribute("data-sketch-depth", "depth");

  await page.getByTestId("timeline-sketch").click();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "off");
  await expect(page.locator("[data-region-id]")).toHaveCount(2);

  await page.getByTestId("timeline-extrude").click();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");
  await expect(canvas).toHaveAttribute("data-sketch-curves", "2");
  await expect(canvas).toHaveAttribute("data-sketch-fills", "1");
});


test("clicking the model background cancels the feature editor", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const canvas = page.locator("canvas.viewport-canvas");
  const plate = examplePlateVolume();

  await page.getByTestId("timeline-extrude").click();
  await expect(page.getByTestId("feature-popover")).toBeVisible();
  await page.getByTestId("extrude-height").fill("30");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume(30), -1);

  // The stage background is not a popover or a view control: cancel like the
  // footer button, restoring the feature as it was when the editor opened.
  await page.mouse.click(1100, 180);
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);

  // The same applies to a datum editor.
  const datum = page
    .locator('[data-feature-type="datum"]')
    .filter({ hasText: "Midplane" });
  await datum.click();
  await expect(page.getByTestId("datum-popover")).toBeVisible();
  await page.mouse.click(1100, 180);
  await expect(page.getByTestId("datum-popover")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-feature-highlight", "");
  expect(errors).toEqual([]);
});


test("cancelling an editor does not undo a suppression change", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const plate = examplePlateVolume();
  const pinVolume = Math.PI * 8 * 8 * 20;
  const pin = page
    .locator('[data-feature-type="extrude"]')
    .filter({ hasText: "Center pin" });

  // Select the suppressed pin, then unsuppress it from the step's own detail.
  await pin.click();
  await expect(page.getByTestId("feature-popover")).toBeVisible();
  await expect(pin).toHaveAttribute("data-status", "skipped");
  await page.getByTestId("feature-suppress").click();
  await expect(pin).toHaveAttribute("data-status", "ok");
  await expect.poll(() => volume(page)).toBeCloseTo(plate + pinVolume, -1);

  // Cancelling the parameter editor restores the form's parameters, not the
  // history actions taken while it was open.
  await page.mouse.click(1100, 180);
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  await expect(pin).toHaveAttribute("data-status", "ok");
  await expect.poll(() => volume(page)).toBeCloseTo(plate + pinVolume, -1);
  await expect(page.getByTestId("feature-suppress")).toHaveText("suppress");
  expect(errors).toEqual([]);
});


test("selecting a step scrubs the history and gaps insert steps", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const plate = examplePlateVolume();
  const pinVolume = Math.PI * 8 * 8 * 20;
  const pin = page
    .locator('[data-feature-type="extrude"]')
    .filter({ hasText: "Center pin" });

  // Build a downstream feature, then scrub back to the base extrude by
  // selecting it. There is no roll-back command.
  await pin.click();
  await page.getByTestId("feature-suppress").click();
  await expect.poll(() => volume(page)).toBeCloseTo(plate + pinVolume, -1);
  await expect(pin).toHaveAttribute("data-status", "ok");

  await page.getByTestId("timeline-extrude").click();
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);
  await expect(pin).toHaveAttribute("data-status", "paused");
  await expect(page.getByTestId("roll-back")).toHaveCount(0);
  await expect(page.getByTestId("roll-forward")).toHaveCount(0);

  // Selecting the downstream step builds through it again.
  await pin.click();
  await expect.poll(() => volume(page)).toBeCloseTo(plate + pinVolume, -1);
  await expect(pin).toHaveAttribute("data-status", "ok");

  // The gap after the active step is the insert affordance, with a menu.
  await clickGapAfterActive(page);
  await expect(page.getByTestId("insert-sketch")).toBeVisible();
  await expect(page.getByTestId("insert-plane")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("insert-sketch")).toHaveCount(0);

  // A new sketch lands at that gap, not at the end of the timeline.
  await clickGapAfterActive(page);
  await page.getByTestId("insert-sketch").click();
  await page.getByTestId("new-sketch").click();
  const pinPosition = await page
    .locator("[data-feature-id]")
    .evaluateAll(
      (nodes, id) =>
        nodes.findIndex((node) => node.getAttribute("data-feature-id") === id),
      await pin.getAttribute("data-feature-id"),
    );
  await expect(
    page.locator("[data-feature-id]").nth(pinPosition + 1),
  ).toHaveAttribute("data-feature-type", "sketch");
  expect(errors).toEqual([]);
});


test("clicking the empty timeline tail clears the selected step", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const timeline = page.getByTestId("timeline");
  const canvas = page.locator("canvas.viewport-canvas");
  const empty = page.getByTestId("timeline-empty");
  const box = await empty.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(32);

  const sketchId = await page
    .getByTestId("timeline-sketch")
    .getAttribute("data-feature-id");
  await page.getByTestId("timeline-extrude").click();
  await expect(page.getByTestId("feature-popover")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");

  await empty.click();
  await expect(timeline).toHaveAttribute("data-active-feature", "");
  await expect(page.locator(".timeline-item.is-active")).toHaveCount(0);
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  const track = page.locator(".timeline-track");
  await expect
    .poll(() =>
      track.evaluate(
        (element) =>
          Math.abs(
            element.scrollLeft + element.clientWidth - element.scrollWidth,
          ) <= 1,
      ),
    )
    .toBe(true);
  await expect(page.getByTestId("timeline-detail")).not.toContainText(
    "No step selected",
  );
  // The autosave/status note stays on the right even with no selected step.
  const detailBox = await page.getByTestId("timeline-detail").boundingBox();
  const statusBox = await page.getByTestId("rebuild-status").boundingBox();
  expect(detailBox && statusBox).toBeTruthy();
  if (detailBox && statusBox) {
    expect(statusBox.x).toBeGreaterThan(detailBox.x + detailBox.width / 2);
  }
  await expect(canvas).toHaveAttribute("data-feature-highlight", "");
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "off");

  // The leading tail clears it the same way.
  await page.getByTestId("timeline-empty-start").click();
  await expect(timeline).toHaveAttribute("data-active-feature", "");
  await page.getByTestId("timeline-sketch").click();
  await expect(timeline).toHaveAttribute("data-active-feature", sketchId!);
  expect(errors).toEqual([]);
});


test("opening a document starts with no step selected", async ({ app: page }) => {
  const errors = collectErrors(page);
  const timeline = page.getByTestId("timeline");
  await expect(timeline).toHaveAttribute("data-active-feature", "");
  await expect(timeline).toHaveAttribute("data-active-extrude", "");
  await expect(page.locator(".timeline-item.is-active")).toHaveCount(0);
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  await expect(page.getByTestId("timeline-detail")).not.toContainText(
    "No step selected",
  );
  await expect(page.getByTestId("rebuild-status")).toBeVisible();
  await expect.poll(() => volume(page)).toBeCloseTo(examplePlateVolume(), -1);

  const track = page.locator(".timeline-track");
  await expect
    .poll(() =>
      track.evaluate(
        (element) =>
          Math.abs(
            element.scrollLeft + element.clientWidth - element.scrollWidth,
          ) <= 1,
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});


test("Escape at rest clears the selected step", async ({ app: page }) => {
  const errors = collectErrors(page);
  const timeline = page.getByTestId("timeline");
  await page.getByTestId("timeline-sketch").click();
  await expect(timeline).toHaveAttribute("data-active-feature", /.+/);

  await page.keyboard.press("Escape");
  await expect(timeline).toHaveAttribute("data-active-feature", "");
  await expect(page.locator(".timeline-item.is-active")).toHaveCount(0);
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  await expect(page.getByTestId("model-tool-select")).toBeVisible();

  const track = page.locator(".timeline-track");
  await expect
    .poll(() =>
      track.evaluate(
        (element) =>
          Math.abs(
            element.scrollLeft + element.clientWidth - element.scrollWidth,
          ) <= 1,
      ),
    )
    .toBe(true);

  // A second Escape is a no-op: there is no cursor left to clear.
  await page.keyboard.press("Escape");
  await expect(timeline).toHaveAttribute("data-active-feature", "");
  expect(errors).toEqual([]);
});


test("the timeline scrolls sideways without a vertical scrollbar", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const original = page.viewportSize();
  await page.setViewportSize({ width: 1000, height: 720 });
  try {
    const metrics = await page.locator(".timeline-track").evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        overflowY: style.overflowY,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    });
    // A narrow viewport makes the six example steps overflow horizontally,
    // which is the case that used to compute overflow-y:auto as well and add a
    // vertical scrollbar to the timeline strip.
    expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
    expect(metrics.overflowY).toBe("hidden");
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1);

    // A vertical wheel over the strip moves the real native scroll container
    // sideways; there is no second axis to scroll.
    const track = page.locator(".timeline-track");
    await track.hover();
    const before = await track.evaluate((element) => element.scrollLeft);
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => track.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(before);
  } finally {
    await page.locator(".timeline-track").evaluate((element) => {
      element.scrollLeft = 0;
    });
    if (original) await page.setViewportSize(original);
  }
  expect(errors).toEqual([]);
});


test("highlights the geometry an extrude step created", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const canvas = page.locator("canvas.viewport-canvas");
  const extrude = page.getByTestId("timeline-extrude");
  const extrudeId = await extrude.getAttribute("data-feature-id");

  // Selecting the step is explicit; loading starts with no cursor.
  await extrude.click();
  // The first extrude created the whole plate, so every face is highlighted,
  // and its source sketch overlay is still requested.
  await expect(canvas).toHaveAttribute("data-feature-highlight", extrudeId!);
  await expect(canvas).toHaveAttribute("data-feature-faces", "7");
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");
  await expect(canvas).toHaveAttribute("data-sketch-curves", "2");

  // A sketch step is about the profile, not the solid it produced.
  await page.getByTestId("timeline-sketch").click();
  await expect(canvas).toHaveAttribute("data-feature-highlight", "");
  await expect(canvas).toHaveAttribute("data-feature-faces", "0");

  await extrude.click();
  await expect(canvas).toHaveAttribute("data-feature-highlight", extrudeId!);

  // A join highlights the faces it added: the pin's cap *and* its exposed
  // cylinder wall, not the plate it was fused into. The wall is several
  // hundred triangles, so this also catches a regression to cap-only.
  const pin = page
    .locator('[data-feature-type="extrude"]')
    .filter({ hasText: "Center pin" });
  await pin.click();
  const pinId = await pin.getAttribute("data-feature-id");
  await page.getByTestId("feature-suppress").click();
  await expect(canvas).toHaveAttribute("data-feature-highlight", pinId!);
  await expect
    .poll(async () =>
      Number(await canvas.getAttribute("data-feature-triangles")),
    )
    .toBeGreaterThan(300);
  expect(
    Number(await canvas.getAttribute("data-feature-faces")),
  ).toBeLessThan(7);
  expect(errors).toEqual([]);
});


test("switching from a datum editor to an extrude restores the overlays", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const canvas = page.locator("canvas.viewport-canvas");
  const midplane = page
    .locator('[data-feature-type="datum"]')
    .filter({ hasText: "Midplane" });

  await midplane.click();
  await expect(page.getByTestId("datum-popover")).toBeVisible();
  await expect(canvas).toHaveAttribute("data-feature-highlight", "");
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "off");

  const extrude = page.getByTestId("timeline-extrude");
  const extrudeId = await extrude.getAttribute("data-feature-id");
  await extrude.click();
  await expect(page.getByTestId("datum-popover")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-feature-highlight", extrudeId!);
  await expect(canvas).toHaveAttribute("data-feature-faces", "7");
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");
  await expect(canvas).toHaveAttribute("data-sketch-curves", "2");
  expect(errors).toEqual([]);
});


test("the example reuses one sketch for independent extruded regions", async ({
  app: page,
}) => {
  const errors = collectErrors(page);

  // The example ships a suppressed "Center pin": a second extrude from Sketch 1
  // that uses the central hole's void region instead of the plate's material.
  const pin = page
    .locator('[data-feature-type="extrude"]')
    .filter({ hasText: "Center pin" });
  await expect(pin).toHaveCount(1);
  // Loading starts with no cursor, so the suppressed pin is simply skipped
  // until it is selected explicitly.
  await expect(pin).toHaveAttribute("data-status", "skipped");

  await pin.click();
  await page.getByTestId("feature-suppress").click();

  const plate = examplePlateVolume();
  const pinVolume = Math.PI * 8 * 8 * 20;
  await expect.poll(() => volume(page)).toBeCloseTo(plate + pinVolume, -1);
  await expect.poll(() => meshBounds(page)).toBe(exampleBounds(20));

  const readExtrudes = () =>
    page.evaluate(() => {
      const doc = JSON.parse(localStorage.getItem("cad.doc") ?? "{}");
      return doc.features
        .filter((feature: { type: string }) => feature.type === "extrude")
        .map((feature: { name: string; regions: string[] }) => ({
          name: feature.name,
          regions: feature.regions,
        }));
    });
  const before: { name: string; regions: string[] }[] = await readExtrudes();
  expect(before.find((feature) => feature.name === "Extrude 1")?.regions).toEqual(
    [],
  );
  expect(before.find((feature) => feature.name === "Center pin")?.regions).toHaveLength(
    1,
  );

  // With two active extrudes consuming Sketch 1, region editing from the sketch
  // is ambiguous. It must not silently edit the first extrude.
  await page.getByTestId("timeline-sketch").click();
  await expect(page.getByTestId("timeline")).toHaveAttribute(
    "data-active-extrude",
    "",
  );
  await expect(page.getByTestId("region-panel")).toHaveCount(0);

  await page.getByTestId("tool-select").click();
  await clickSketch(page, 10, 10);
  await clickSketch(page, 0, 5);
  await expect(await readExtrudes()).toEqual(before);
  await page.locator("[data-feature-id]").last().click();
  await expect.poll(() => volume(page)).toBeCloseTo(plate + pinVolume, -1);

  expect(errors).toEqual([]);
});


test("selects a hole as its own extrusion profile", async ({ app: page }) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // The demo is a 60x40 plate with a centered Ø16 hole: both faces are profiles.
  await expect(page.locator("[data-region-id]")).toHaveCount(2);
  await expect(page.locator('[data-region-kind="void"]')).toHaveCount(1);

  await page.getByTestId("tool-select").click();

  // A new extrude starts empty: the profile must be chosen explicitly.
  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeDisabled();

  // Inside the hole but clear of its rim and the construction diagonal.
  await clickSketch(page, 0, 5);
  await expect(page.getByTestId("region-panel")).toContainText(
    "1 of 2 regions · void",
  );
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();

  await page.getByTestId("extrude-apply").click();
  // Join fills the existing Ø16 hole, so the plate becomes solid.
  await expect.poll(() => volume(page)).toBeCloseTo(exampleSolidPlateVolume(), -1);
  await expect(page.locator("[data-feature-id]")).toHaveCount(9);
  await expect(
    page.locator('[data-feature-type="extrude"]').last(),
  ).toContainText("Extrude 4");

  expect(errors).toEqual([]);
});


test("a polygon crossing the example keeps every profile selectable", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // A four-sided polygon crossing both the plate boundary and the central hole.
  await page.getByTestId("tool-line").click();
  for (const [x, y] of [
    [-40, 0],
    [2, 27],
    [39, 7.5],
    [16, -27],
    [-40, 0],
  ] as const) {
    await clickSketch(page, x, y);
  }
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-region-id]")).toHaveCount(10);
  await expect(page.locator('[data-region-kind="void"]')).toHaveCount(1);

  // The sketch step is the cursor, so measure the polygon-split base at the
  // extrude that consumes it, then return to the sketch to pick profiles.
  await page.getByTestId("timeline-extrude").click();
  await expect.poll(() => volume(page)).toBeLessThan(24000);
  const before = await volume(page);
  await page.getByTestId("timeline-sketch").click();

  // Selecting the profile opens its popover; the feature chip starts the draft.
  await expect(page.getByTestId("extrude-apply")).toHaveCount(0);
  await clickSketch(page, -22, 5);
  await expect(page.getByTestId("profile-popover")).toBeVisible();
  await page.getByTestId("profile-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await expect(page.getByTestId("region-panel")).toContainText("1 of 10 regions");

  // The central hole is still a selectable void profile through the arrangement.
  await clickSketch(page, 0, 5);
  await expect(page.getByTestId("region-panel")).toContainText(
    "1 of 10 regions · void",
  );
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-apply").click();

  // Join fills the Ø16 hole with the new cylinder; the base region itself
  // changes because the polygon splits it, so compare against the pre-extrude
  // volume rather than the original plate.
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(before + Math.PI * 8 * 8 * 12, -1);
  await expect(page.locator("[data-feature-id]")).toHaveCount(9);
  await expect(
    page.locator('[data-feature-type="extrude"]').last(),
  ).toContainText("Extrude 4");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});


test("selects narrow profile slivers when a diamond crosses the example", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await enterSketch(page);

  // The diamond from the reported sketch: narrow slivers where a sketch-mode
  // click would otherwise hit a line's 12 px hit target first.
  await page.getByTestId("tool-line").click();
  for (const [x, y] of [
    [-40, -7.5],
    [-6, 28],
    [42, -7.5],
    [-8, -32],
    [-40, -7.5],
  ] as const) {
    await clickSketch(page, x, y);
  }
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-region-id]")).toHaveCount(10);
  await expect(page.locator('[data-region-kind="void"]')).toHaveCount(1);
  await page.getByTestId("timeline-extrude").click();
  await expect.poll(() => volume(page)).toBeLessThan(24000);
  const before = await volume(page);
  await page.getByTestId("timeline-sketch").click();

  // Profile mode raises the region hit layer above geometry, so the narrow
  // left sliver is selectable even though it lies next to a line.
  await page.getByTestId("new-extrude").click();
  await expect(page.getByTestId("extrude-draft-popover")).toBeVisible();
  await clickSketch(page, -35, -7.5);
  await expect(page.getByTestId("region-panel")).toContainText("1 of 10 regions");

  await clickSketch(page, 0, 5);
  await expect(page.getByTestId("region-panel")).toContainText(
    "1 of 10 regions · void",
  );
  await page.getByTestId("extrude-apply").click();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(before + Math.PI * 8 * 8 * 12, -1);
  expect(errors).toEqual([]);
});


test("the global clear resets the whole file to an empty document", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await expect(page.locator("[data-feature-id]")).toHaveCount(8);

  await page.getByTestId("clear-document").click();
  await expect(page.locator("[data-feature-id]")).toHaveCount(0);
  await expect(page.getByTestId("no-solid-message")).toContainText(
    "Start with a sketch",
  );
  await expect(page.getByTestId("timeline-extrude")).toHaveCount(0);
  await expect(page.getByTestId("timeline-detail")).not.toContainText(
    "No features",
  );
  await expect(page.getByTestId("rebuild-status")).toBeVisible();
  await expect(page.getByTestId("tool-select")).toBeHidden();

  // The leading gap starts the first step.
  await page.getByTestId("insert-gap-start").click();
  await page.getByTestId("insert-sketch").click();
  await expect(page.getByTestId("support-popover")).toBeVisible();
  // Creating the sketch is the fix; the empty-state callout must not sit
  // behind the support picker or the new sketch.
  await expect(page.getByTestId("no-solid-message")).toHaveCount(0);
  await page.getByTestId("new-sketch").click();
  await expect(page.getByTestId("no-solid-message")).toHaveCount(0);
  await expect(page.locator("[data-feature-id]")).toHaveCount(1);
  await expect(page.locator("[data-feature-id]").first()).toHaveAttribute(
    "data-feature-type",
    "sketch",
  );
  await expect(page.getByTestId("tool-select")).toBeVisible();

  // The blank sketch is immediately usable.
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 0);
  await clickSketch(page, 10, 0);
  await expect(page.locator("[data-region-id]")).toHaveCount(1);
  expect(errors).toEqual([]);
});


test("the no-solid callout returns after a sketch-only history", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page.getByTestId("clear-document").click();
  await page.getByTestId("insert-gap-start").click();
  await page.getByTestId("insert-sketch").click();
  await page.getByTestId("new-sketch").click();
  await page.getByTestId("finish-sketch").click();

  await expect(page.getByTestId("no-solid-message")).toBeVisible();
  await expect(page.getByTestId("no-solid-message")).toContainText(
    "Draw a closed loop or select a region",
  );
  // Selecting the sketch opens the sketch stage, where the model callout is
  // not rendered at all.
  await page.getByTestId("timeline-sketch").click();
  await expect(page.getByTestId("no-solid-message")).toHaveCount(0);
  expect(errors).toEqual([]);
});


test("inserts a step at the very start from the leading gap", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const first = await page
    .locator("[data-feature-id]")
    .first()
    .getAttribute("data-feature-id");

  await page.getByTestId("insert-gap-start").click();
  await expect(page.getByTestId("insert-menu-head")).toContainText(
    "insert at the start",
  );
  await page.getByTestId("insert-plane").click();
  await page.getByTestId("datum-apply").click();

  await expect(page.locator("[data-feature-id]").first()).toHaveAttribute(
    "data-feature-type",
    "datum",
  );
  await expect(page.locator("[data-feature-id]").nth(1)).toHaveAttribute(
    "data-feature-id",
    first!,
  );
  await expect(page.getByTestId("timeline")).toHaveAttribute(
    "data-active-feature",
    /.+/,
  );
  expect(errors).toEqual([]);
});


test("rebuilds the reported circle-through-hole part without an invalid profile", async ({
  browser,
}) => {
  const doc = readFileSync(
    new URL(
      "../src/core/sketch/__fixtures__/circle-through-hole.cad.json",
      import.meta.url,
    ),
    "utf8",
  );
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, doc);
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("mesh-stats")).toBeVisible();
  await expect.poll(() => volume(page)).toBeGreaterThan(0);
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  // The old region id is invalid, so the engine visibly falls back instead of
  // sending an invalid profile to the kernel.
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "title",
    /stored region selection no longer exists/,
  );
  await context.close();
});
