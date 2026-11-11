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
} from "./support/sketch";
import {
  pickTopFace,
  pickSideFace,
  pickRightFace,
  findDatumHover,
  fitView,
} from "./support/model";
import {
  openInsert,
  sketchOnPickedFace,
  sketchBossOnPickedFace,
} from "./support/workflow";
import { createExampleDocument } from "../src/core/doc/example";
import { exampleBounds, examplePlateVolume } from "../src/core/doc/exampleMetrics";
import { addSketchFeature } from "../src/core/doc/selectors";
import type { ExtrudeFeature } from "../src/core/doc/types";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});


test("creates a sketch on a planar face and extrudes from it", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await sketchOnPickedFace(page);

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

  const expected =
    examplePlateVolume() + Math.PI * 5 * 5 * 5;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect.poll(() => meshBounds(page)).toBe(exampleBounds(17));
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});


test("creates a sketch on the XZ world plane and joins an extrude", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await openInsert(page, "sketch");
  await expect(page.getByTestId("support-popover")).toBeVisible();
  const viewport = page.locator("canvas.viewport-canvas");
  await expect(viewport).toHaveAttribute("data-support-preview", "on");
  await expect(viewport).toHaveAttribute("data-body-dimmed", "on");
  await page.getByTestId("support-xz").click();
  await expect(page.getByTestId("support-popover")).toContainText(
    "world plane · XZ",
  );
  await page.getByTestId("new-sketch").click();
  await expect(activeStepMeta(page)).toContainText("XZ");
  await expect(viewport).toHaveAttribute("data-support-preview", "off");
  await expect(viewport).toHaveAttribute("data-body-dimmed", "off");

  // Local X/Y on XZ are world X/Z; extrude along local +Z maps to world -Y.
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 0, 6);
  await clickSketch(page, 5, 6);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();

  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 0, 6);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-height").fill("5");
  await page.getByTestId("extrude-apply").click();

  const plate = examplePlateVolume();
  await expect.poll(() => volume(page)).toBeCloseTo(plate + Math.PI * 5 * 5 * 5, -1);
  await expect.poll(() => meshBounds(page)).toBe(exampleBounds());
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});


test("creates an offset datum plane and sketches on it", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await openInsert(page, "plane");
  await expect(page.getByTestId("datum-draft-popover")).toBeVisible();
  await expect(page.getByTestId("datum-distance-slider")).toBeVisible();
  await page.getByTestId("datum-distance").fill("10");
  await page.getByTestId("datum-apply").click();

  const datum = page
    .locator('[data-feature-type="datum"]')
    .filter({ hasText: "Plane 2" });
  await expect(datum).toHaveCount(1);
  await expect(datum).toContainText("offset 10 mm");
  await expect(page.locator("canvas.viewport-canvas")).toHaveAttribute(
    "data-datum-planes",
    "1",
  );

  await openInsert(page, "sketch");
  await expect(
    page
      .getByTestId("support-datum")
      .locator("option")
      .filter({ hasText: "Plane 2 · offset 10 mm" }),
  ).toHaveCount(1);
  await page.getByTestId("support-datum").selectOption({
    label: "Plane 2 · offset 10 mm",
  });
  await expect(page.getByTestId("support-popover")).toContainText(
    "datum plane · Plane 2",
  );
  await page.getByTestId("new-sketch").click();
  await expect(activeStepMeta(page)).toContainText("Datum · Plane 2");
  // A datum sketch has no supporting face, so the body that exists at this
  // step is projected as faint reference edges.
  await expect
    .poll(() => page.locator("[data-body-reference]").count())
    .toBeGreaterThan(0);

  // Plane-local (10, 10) is world (10, 10); the plane sits at z = 10.
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 10, 10);
  await clickSketch(page, 15, 10);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();
  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 10, 10);
  await expect(page.getByTestId("extrude-apply")).toBeEnabled();
  await page.getByTestId("extrude-height").fill("5");
  await page.getByTestId("extrude-apply").click();

  const plate = examplePlateVolume();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(plate + Math.PI * 5 * 5 * 3, -1);
  await expect.poll(() => meshBounds(page)).toBe(exampleBounds(15));

  // Move the datum plane down: the boss follows, so two more millimetres of
  // the 5 mm cylinder are outside the 12 mm plate.
  await datum.click();
  await expect(page.getByTestId("datum-popover")).toBeVisible();
  await page.getByTestId("datum-distance").fill("8");
  await page.getByTestId("datum-popover-apply").click();
  // The datum sits before the boss, so select the end of the history to build
  // through the dependent extrude.
  await page.locator("[data-feature-id]").last().click();
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(plate + Math.PI * 5 * 5 * 1, -1);
  await expect.poll(() => meshBounds(page)).toBe(exampleBounds(13));
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});


test("picks a datum plane and starts a sketch on it", async ({ app: page }) => {
  const errors = collectErrors(page);
  await openInsert(page, "plane");
  await page.getByTestId("datum-distance").fill("10");
  await page.getByTestId("datum-apply").click();
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-datum-planes", "1");
  await fitView(page);

  const hover = await findDatumHover(page);
  await expect(canvas).toHaveAttribute("data-hover-kind", "datum");
  await page.mouse.click(hover.x, hover.y);
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-kind",
    "datum",
  );
  const datumId = await page.getByTestId("body-pick").getAttribute("data-datum-id");
  expect(datumId).toBeTruthy();

  await openInsert(page, "sketch");
  await expect(page.getByTestId("support-popover")).toContainText(
    "datum plane · Plane 2",
  );
  await page.getByTestId("new-sketch").click();
  await expect(activeStepMeta(page)).toContainText("Datum · Plane 2");
  expect(errors).toEqual([]);
});


test("creates a midplane between two offset planes", async ({ app: page }) => {
  const errors = collectErrors(page);
  await openInsert(page, "plane");
  await page.getByTestId("datum-distance").fill("2");
  await page.getByTestId("datum-apply").click();

  await openInsert(page, "plane");
  await page.getByTestId("datum-base").selectOption({ label: "Plane 2" });
  await page.getByTestId("datum-distance").fill("8");
  await page.getByTestId("datum-apply").click();

  await openInsert(page, "plane");
  await page.getByTestId("datum-kind-midplane").click();
  await page.getByTestId("datum-base").selectOption({ label: "Plane 2" });
  await page.getByTestId("datum-second").selectOption({ label: "Plane 3" });
  await page.getByTestId("datum-apply").click();

  const planes = page.locator('[data-feature-type="datum"]');
  await expect(planes).toHaveCount(4);
  await planes.filter({ hasText: "Plane 4" }).click();
  await expect(activeStepMeta(page)).toContainText("midplane");
  const midplaneOrigin = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("cad.doc")!);
    const plane = doc.features.find(
      (feature: { type: string; name: string }) =>
        feature.type === "datum" && feature.name === "Plane 4",
    );
    return plane.frame.origin.map((value: number) => Math.round(value)).join(", ");
  });
  expect(midplaneOrigin).toBe("0, 0, 6");
  expect(errors).toEqual([]);
});


test("datum planes based on a face follow source body edits", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  const role = await page
    .getByTestId("body-pick")
    .getAttribute("data-ref-role");
  expect(role).toBeTruthy();

  await openInsert(page, "plane");
  await page.getByTestId("datum-base").selectOption({
    label: `Face · ${role}`,
  });
  await page.getByTestId("datum-distance").fill("0");
  await page.getByTestId("datum-apply").click();

  await openInsert(page, "sketch");
  await page.getByTestId("support-datum").selectOption({
    label: "Plane 2 · offset 0 mm",
  });
  await page.getByTestId("new-sketch").click();
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 10, 10);
  await clickSketch(page, 15, 10);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();
  await page.getByTestId("new-extrude").click();
  await clickSketch(page, 10, 10);
  await page.getByTestId("extrude-height").fill("5");
  await page.getByTestId("extrude-apply").click();

  const boss = Math.PI * 5 * 5 * 5;
  const plate12 = examplePlateVolume();
  await expect.poll(() => volume(page)).toBeCloseTo(plate12 + boss, -1);
  await expect.poll(() => meshBounds(page)).toBe(exampleBounds(17));

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-height").fill("30");
  await page.getByTestId("feature-popover-apply").click();
  await page.locator("[data-feature-id]").last().click();

  const plate30 = examplePlateVolume(30);
  await expect.poll(() => volume(page)).toBeCloseTo(plate30 + boss, -1);
  await expect.poll(() => meshBounds(page)).toBe(exampleBounds(35));

  await expect
    .poll(() =>
      page.evaluate(() => {
        const doc = JSON.parse(localStorage.getItem("cad.doc")!);
        // The datum this test created is appended at the insert gap; the
        // example ships a hidden Midplane datum earlier in the history.
        const datum = [...doc.features]
          .reverse()
          .find((feature: { type: string }) => feature.type === "datum");
        return (
          datum?.frame?.origin?.map(
            (value: number) => Math.round(value * 1000) / 1000 || 0,
          ) ?? null
        );
      }),
    )
    .toEqual([0, 0, 30]);
  expect(errors).toEqual([]);
});


test("flips a face sketch support and keeps that side stable", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await openInsert(page, "sketch");
  await page.getByTestId("flip-face").click();
  await expect(page.getByTestId("support-popover")).toContainText(
    "planar face · flipped",
  );
  await page.getByTestId("new-sketch").click();

  const support = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("cad.doc");
      if (!raw) return null;
      const doc = JSON.parse(raw);
      const sketch = [...doc.features]
        .reverse()
        .find(
          (feature: { type: string; support?: { kind: string } }) =>
            feature.type === "sketch" &&
            feature.support?.kind === "face" &&
            (feature as { name?: string }).name === "Sketch 3",
        );
      const frame = sketch?.support?.frame;
      return frame
        ? {
            ...frame,
            origin: frame.origin.map(
              (value: number) => Math.round(value * 1000) / 1000 || 0,
            ),
          }
        : null;
    });
  await expect
    .poll(async () => (await support())?.normal ?? null)
    .toEqual([0, 0, -1]);

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-height").fill("30");
  await page.getByTestId("feature-popover-apply").click();

  await expect
    .poll(support)
    .toMatchObject({
      origin: [0, 0, 30],
      normal: [0, 0, -1],
      xAxis: [1, 0, 0],
      yAxis: [0, -1, 0],
    });
  expect(errors).toEqual([]);
});


test("shows and clears a lost face support", async ({ app: page }) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await sketchOnPickedFace(page);

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("feature-suppress").click();
  // Only features in the rendered prefix report lost support: move the cursor
  // past the face-supported sketch and the midplane.
  await page.locator("[data-feature-id]").last().click();
  // The example has face-supported features on both the top and bottom plate
  // faces, plus a midplane between them.
  await expect(page.getByTestId("timeline")).toHaveAttribute(
    "data-lost-supports",
    "2",
  );
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Sketch 3" })
    .click();
  await expect(page.getByTestId("timeline-detail")).toContainText(
    "lost · cached frame",
  );
  await expect(page.getByTestId("reselect-support")).toBeVisible();
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "error",
  );

  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("feature-suppress").click();
  await page.locator("[data-feature-id]").last().click();
  await expect
    .poll(() => page.getByTestId("rebuild-status").getAttribute("data-status"))
    .toBe("ok");
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Sketch 3" })
    .click();
  await expect(page.getByTestId("timeline-detail")).not.toContainText(
    "lost · cached frame",
  );
  expect(errors).toEqual([]);
});


test("resolves a stale face role by geometric fallback", async ({ browser }) => {
  const doc = createExampleDocument();
  const extrude = doc.features.find(
    (feature): feature is ExtrudeFeature => feature.type === "extrude",
  );
  if (!extrude) throw new Error("Example has no extrude");
  const withFace = addSketchFeature(doc, {
    name: "Recovered face sketch",
    support: {
      kind: "face",
      ref: {
        source: extrude.id,
        kind: "face",
        role: "extrude:missing-role",
        hint: {
          entityType: "face",
          surfaceType: "PLANE",
          normal: [0, 0, 1],
          centroid: [0, 0, 12],
          area: 2400 - Math.PI * 8 * 8,
        },
      },
      frame: {
        origin: [0, 0, 12],
        normal: [0, 0, 1],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
      },
    },
  });

  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(withFace.doc));
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Recovered face sketch" })
    .click();
  await expect(page.locator("[data-projection-id]").first()).toBeAttached();
  await expect(page.getByTestId("timeline-detail")).not.toContainText(
    "lost · cached frame",
  );
  await expect(page.getByTestId("timeline")).toHaveAttribute(
    "data-lost-supports",
    "0",
  );
  await context.close();
});


test("previews a datum plane while creating it", async ({ app: page }) => {
  const errors = collectErrors(page);
  const canvas = page.locator("canvas.viewport-canvas");
  await openInsert(page, "plane");
  await expect(canvas).toHaveAttribute("data-support-preview", "on");
  await expect(canvas).toHaveAttribute("data-body-dimmed", "on");
  await expect(canvas).toHaveAttribute(
    "data-support-preview-origin",
    "0.000,0.000,10.000",
  );

  await page.getByTestId("datum-distance").fill("25");
  await expect(canvas).toHaveAttribute(
    "data-support-preview-origin",
    "0.000,0.000,25.000",
  );

  await page.getByTestId("datum-apply").click();
  await expect(canvas).toHaveAttribute("data-datum-planes", "1");
  await expect(canvas).toHaveAttribute("data-support-preview", "off");
  await expect(canvas).toHaveAttribute("data-body-dimmed", "off");
  expect(errors).toEqual([]);
});


test("new steps insert after the selected step without its overlay", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const canvas = page.locator("canvas.viewport-canvas");
  await page.getByTestId("timeline-extrude").click();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");

  await openInsert(page, "plane");
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "off");
  await expect(canvas).toHaveAttribute("data-support-preview", "on");
  await page.getByTestId("datum-apply").click();

  const rows = page.locator("[data-feature-id]");
  await expect(rows.nth(1)).toContainText("Extrude 1");
  await expect(rows.nth(2)).toHaveAttribute("data-feature-type", "datum");
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "off");

  // A sketch chosen while Extrude 1 is selected inserts before that new datum.
  await page.getByTestId("timeline-extrude").click();
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");
  await openInsert(page, "sketch");
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "off");
  await page.getByTestId("new-sketch").click();
  await expect(rows.nth(2)).toHaveAttribute("data-feature-type", "sketch");
  await expect(rows.nth(3)).toHaveAttribute("data-feature-type", "datum");
  expect(errors).toEqual([]);
});


test("hides a datum plane without suppressing it", async ({ app: page }) => {
  const errors = collectErrors(page);
  await openInsert(page, "plane");
  await page.getByTestId("datum-distance").fill("10");
  await page.getByTestId("datum-apply").click();
  const canvas = page.locator("canvas.viewport-canvas");
  await expect(canvas).toHaveAttribute("data-datum-planes", "1");

  const datum = page
    .locator('[data-feature-type="datum"]')
    .filter({ hasText: "Plane 2" });
  await datum.click();
  await datum.getByTestId("toggle-datum-visibility").click();
  await expect(canvas).toHaveAttribute("data-datum-planes", "0");
  await expect(datum).toHaveAttribute("data-status", "ok");
  await expect(datum).toHaveClass(/is-hidden/);
  await expect(datum).toHaveAttribute("data-hidden", "true");

  // It is still a usable support while hidden.
  await openInsert(page, "sketch");
  await expect(page.getByTestId("support-datum")).toContainText("Plane 2");
  await page.getByTestId("support-cancel").click();

  await datum.click();
  await datum.getByTestId("toggle-datum-visibility").click();
  await expect(canvas).toHaveAttribute("data-datum-planes", "1");
  await expect(datum).not.toHaveClass(/is-hidden/);
  expect(errors).toEqual([]);
});


test("snaps a drawn line to a projected face boundary", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await sketchOnPickedFace(page);

  // The projected plate outline is a 60×40 rectangle centred on the face. Start
  // the line 0.5 mm inside the right edge; it must snap onto x = 30 and gain a
  // point-on-line constraint instead of rounding to the 5 mm grid.
  await page.getByTestId("tool-line").click();
  await clickSketch(page, 29.5, 13.3);
  await clickSketch(page, 20, 13.3);
  await page.keyboard.press("Enter");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("cad.doc");
        if (!raw) return null;
        const doc = JSON.parse(raw);
        const sketch = [...doc.features]
          .reverse()
          .find(
            (feature: { type: string; support?: { kind: string } }) =>
              feature.type === "sketch" &&
              feature.support?.kind === "face" &&
              (feature as { name?: string }).name === "Sketch 3",
          );
        const point = sketch?.sketch.points.find(
          (candidate: { x: number }) => candidate.x > 29.9,
        );
        const linked = sketch?.sketch.constraints.some(
          (constraint: { type: string; line?: string }) =>
            constraint.type === "pointOnLine" &&
            constraint.line?.startsWith("proj-"),
        );
        return point && linked ? [point.x, point.y] : null;
      }),
    )
    .not.toBeNull();

  const snapped = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("cad.doc")!);
    const sketch = [...doc.features]
      .reverse()
      .find(
            (feature: { type: string; support?: { kind: string } }) =>
              feature.type === "sketch" &&
              feature.support?.kind === "face" &&
              (feature as { name?: string }).name === "Sketch 3",
          );
    return sketch.sketch.points.find(
      (candidate: { x: number }) => candidate.x > 29.9,
    ) as { x: number; y: number };
  });
  expect(snapped.x).toBeCloseTo(30, 3);
  // The auto horizontal constraint lets the solver settle a few hundredths of
  // a millimetre; the point is still off the 5 mm grid, proving edge snapping.
  expect(snapped.y).toBeCloseTo(13.3, 1);
  expect(errors).toEqual([]);
});


test("projects a side face as a closed rectangle", async ({ app: page }) => {
  const errors = collectErrors(page);
  await pickSideFace(page);
  await openInsert(page, "sketch");
  await page.getByTestId("new-sketch").click();

  // Every edge of the side face must be projected, not just the two that the
  // kernel happened to return first.
  await expect(page.locator("[data-projection-id]")).toHaveCount(4);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("cad.doc");
        if (!raw) return null;
        const doc = JSON.parse(raw);
        const sketch = [...doc.features]
          .reverse()
          .find(
            (feature: { type: string; support?: { kind: string } }) =>
              feature.type === "sketch" &&
              feature.support?.kind === "face" &&
              (feature as { name?: string }).name === "Sketch 3",
          );
        return sketch?.projections?.[0]?.loops?.[0]?.length ?? null;
      }),
    )
    .toBe(4);

  const corners = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("cad.doc")!);
    const sketch = [...doc.features]
      .reverse()
      .find(
            (feature: { type: string; support?: { kind: string } }) =>
              feature.type === "sketch" &&
              feature.support?.kind === "face" &&
              (feature as { name?: string }).name === "Sketch 3",
          );
    return (sketch.projections[0].loops[0] as [number, number][])
      .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`)
      .sort();
  });
  expect(corners).toEqual(["-30,-6", "-30,6", "30,-6", "30,6"]);
  expect(errors).toEqual([]);
});


test("dragging a projected edge point leaves the other endpoint fixed", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickRightFace(page);
  await openInsert(page, "sketch");
  await page.getByTestId("new-sketch").click();
  await expect(page.locator("[data-projection-id]")).toHaveCount(4);

  await page.getByTestId("tool-line").click();
  await clickSketch(page, -19, 1);
  await clickSketch(page, -12, -5);
  await page.keyboard.press("Enter");
  await page.getByTestId("tool-select").click();

  const points = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem("cad.doc");
      if (!raw) return null;
      const doc = JSON.parse(raw);
      const sketch = [...doc.features]
        .reverse()
        .find(
            (feature: { type: string; support?: { kind: string } }) =>
              feature.type === "sketch" &&
              feature.support?.kind === "face" &&
              (feature as { name?: string }).name === "Sketch 3",
          );
      const found = sketch?.sketch.points as
        | { x: number; y: number }[]
        | undefined;
      if (!found || found.length < 2) return null;
      const left = found.reduce((a, b) => (a.x < b.x ? a : b));
      const right = found.reduce((a, b) => (a.x > b.x ? a : b));
      return { left: { x: left.x, y: left.y }, right: { x: right.x, y: right.y } };
    });
  await expect.poll(points).not.toBeNull();
  const before = (await points())!;

  // Grab at the endpoint. The other endpoint is on a different projected edge
  // and must not drift with the solver's free variables.
  await dragSketch(page, [-12, -6], [-16, -6]);
  await expect.poll(async () => (await points())?.right.x ?? 0).toBeCloseTo(-16, 0);

  const after = (await points())!;
  expect(after.left.x).toBeCloseTo(before.left.x, 4);
  expect(after.left.y).toBeCloseTo(before.left.y, 4);
  expect(errors).toEqual([]);
});


test("keeps a face sketch attached when its source body changes", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await sketchBossOnPickedFace(page);

  const boss = Math.PI * 5 * 5 * 5;
  const plate12 = examplePlateVolume();
  await expect.poll(() => volume(page)).toBeCloseTo(plate12 + boss, -1);
  await expect.poll(() => meshBounds(page)).toBe(exampleBounds(17));

  // Make the source plate taller. The boss sketch has no own placement
  // dimensions: its frame comes from the live top face, so the boss must move
  // from z = 12 to z = 30 and keep its projected reference attached.
  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-height").fill("30");
  await page.getByTestId("feature-popover-apply").click();
  // The boss is downstream of the edited extrude; move the cursor to the end to
  // rebuild through it.
  await page.locator("[data-feature-id]").last().click();
  const plate30 = examplePlateVolume(30);
  await expect.poll(() => volume(page)).toBeCloseTo(plate30 + boss, -1);
  await expect.poll(() => meshBounds(page)).toBe(exampleBounds(35));
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );

  // Re-open the face sketch: its projected dashed references survived the
  // source change and are still fixed geometry in the new plane.
  await page
    .locator('[data-feature-type="sketch"]')
    .filter({ hasText: "Sketch 3" })
    .click();
  await expect(activeStepMeta(page)).toContainText("Face ·");
  await expect(page.locator("[data-projection-id]").first()).toBeAttached();
  expect(errors).toEqual([]);
});
