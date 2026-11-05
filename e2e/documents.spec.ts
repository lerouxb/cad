import { expect } from "@playwright/test";
import { resetExample, test } from "./support/app";
import {
  setSlider,
  volume,
  meshBounds,
  activeStepMeta,
} from "./support/app";
import {
  clickSketch,
  enterSketch,
} from "./support/sketch";
import { examplePlateVolume, exampleSolidPlateVolume } from "../src/core/doc/exampleMetrics";
import { CURRENT_SCHEMA_VERSION } from "../src/core/doc/types";
import { multiFeatureDoc } from "./support/fixtures";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});


test("autosaves the document and reopens it", async ({ app: page }) => {
  await page.getByTestId("timeline-extrude").click();
  await setSlider(page.getByTestId("height-slider"), 20);
  await page.getByTestId("feature-popover-apply").click();
  const plate = examplePlateVolume(20);
  await expect.poll(() => volume(page)).toBeCloseTo(plate, -1);

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem("cad.doc");
        if (!raw) return null;
        const doc = JSON.parse(raw);
        return doc.features.find(
          (feature: { type: string }) => feature.type === "extrude",
        )?.height;
      }),
    )
    .toBe(20);

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("cad.doc");
    return raw ? JSON.parse(raw) : null;
  });
  expect(stored?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);

  // A new document in the same context reads the saved part, migrates it, and
  // rebuilds the same solid.
  const second = await page.context().newPage();
  await second.goto("/");
  await expect(second.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(second.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await second.getByTestId("timeline-extrude").click();
  await expect(activeStepMeta(second)).toContainText("20 mm");
  await expect.poll(() => volume(second)).toBeCloseTo(plate, -1);
  await second.close();

  await page.getByTestId("timeline-extrude").click();
  await setSlider(page.getByTestId("height-slider"), 12);
  await page.getByTestId("feature-popover-apply").click();
});


test("downloads, renames and opens a .cad document", async ({ app: page }) => {
  await page.getByTestId("file-menu").click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-doc").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Example.cad");

  await page.getByTestId("file-menu").click();
  await page.getByTestId("rename-doc").click();
  await page.getByTestId("doc-rename-input").fill("Bracket");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("file-menu")).toContainText("Bracket.cad");

  await page.getByTestId("file-open-input").setInputFiles({
    name: "part.cad",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(multiFeatureDoc())),
  });
  await expect(page.locator("[data-feature-id]")).toHaveCount(6);
  const expected = 80 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
});


test("reloading the example reuses its local file entry", async ({ app: page }) => {
  // The built-in example has a stable id, so a reload updates its local file
  // instead of piling up identical Example.cad rows.
  await page.getByTestId("timeline-sketch").click();
  await page.getByTestId("load-example").click();
  await page.waitForTimeout(400);
  await page.getByTestId("load-example").click();
  await page.waitForTimeout(400);
  await page.getByTestId("file-menu").click();
  const rows = page.getByTestId("local-file-list").locator(".file-entry");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Example.cad");
});


test("lists, copies and reopens local files", async ({ app: page }) => {
  await page.getByTestId("file-menu").click();
  await expect(page.getByTestId("local-file-list")).toContainText("Example.cad");
  await page.getByTestId("copy-doc").click();
  await expect(page.getByTestId("file-menu")).toContainText("Example copy.cad");

  await page.getByTestId("file-menu").click();
  await expect(page.getByTestId("local-file-list")).toContainText(
    "Example copy.cad",
  );
  await expect(page.getByTestId("local-file-list")).toContainText("Example.cad");
  await page
    .getByTestId("local-file-list")
    .getByText("Example.cad", { exact: true })
    .click();
  await expect(page.getByTestId("file-menu")).toContainText("Example.cad");

  // A non-current local file can be removed with an explicit confirm.
  await page.getByTestId("file-menu").click();
  const copyRow = page
    .locator(".file-entry")
    .filter({ hasText: "Example copy.cad" });
  await copyRow.getByRole("button", { name: "delete" }).click();
  await copyRow.getByRole("button", { name: "confirm" }).click();
  await expect(page.getByTestId("local-file-list")).not.toContainText(
    "Example copy.cad",
  );
});


test("builds a cut and join from a saved multi-feature document", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(multiFeatureDoc()));
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });

  // Union of the 0..60 plate and 40..80 extension, minus the Ø16 hole.
  const expected = 80 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect.poll(() => meshBounds(page)).toBe("0,0,0,80,40,12");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );

  // The history lists the whole document, not just the first sketch/extrude.
  const timeline = page.getByTestId("timeline");
  await expect(page.locator("[data-feature-id]")).toHaveCount(6);
  const holeSketch = page.locator('[data-feature-id="sketch-2"]');
  const cut = page.locator('[data-feature-id="extrude-2"]');
  await expect(holeSketch).toContainText("Hole sketch");
  await expect(cut).toContainText("Cut 1");
  // Opening a document selects its end, so the whole history is built.
  await expect(timeline).toHaveAttribute("data-active-feature", "extrude-3");

  // Selecting a later sketch edits that sketch; it does not silently take over
  // its consuming extrude. Select the extrude step for profile editing.
  await holeSketch.click();
  await expect(timeline).toHaveAttribute("data-active-feature", "sketch-2");
  await expect(timeline).toHaveAttribute("data-active-extrude", "");
  await expect(page.getByTestId("tool-select")).toBeVisible();

  // Double-click rename is an undoable feature edit, not a document swap.
  await holeSketch.dblclick();
  await expect(page.getByTestId("feature-rename")).toBeVisible();
  await page.getByTestId("feature-rename").fill("Hole profile");
  await page.keyboard.press("Enter");
  await expect(holeSketch).toContainText("Hole profile");
  // Select the end again: the sketch step is only a cursor, not a render mode.
  await page.locator('[data-feature-id="extrude-3"]').click();
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);

  // Reorder a downstream sketch before the base includes it; the order is valid.
  await expect(page.locator('[data-feature-id="sketch-3"]')).toHaveCSS(
    "user-select",
    "none",
  );
  await page
    .locator('[data-feature-id="sketch-3"] .step-grip')
    .dragTo(page.locator('[data-feature-id="sketch-1"]'));
  expect(
    await page.evaluate(() => window.getSelection()?.toString() ?? ""),
  ).toBe("");
  await expect(page.locator("[data-feature-id]").first()).toHaveAttribute(
    "data-feature-id",
    "sketch-3",
  );
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);

  await page.getByTestId("timeline-extrude").click();
  await expect(timeline).toHaveAttribute("data-active-feature", "extrude-1");
  await expect(page.getByTestId("feature-popover")).toBeVisible();

  // Selecting the base extrude scrubs the history to that step and pauses the
  // downstream cut and join. Selecting the last step builds through them again.
  await expect.poll(() => volume(page)).toBeCloseTo(exampleSolidPlateVolume(), -1);
  await expect(page.locator('[data-feature-id="extrude-2"]')).toHaveAttribute(
    "data-status",
    "paused",
  );
  await page.locator('[data-feature-id="extrude-3"]').click();
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await expect(page.locator('[data-feature-id="extrude-2"]')).toHaveAttribute(
    "data-status",
    "ok",
  );
  await context.close();
});


test("reports a join with nothing to join instead of creating a body", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const doc = multiFeatureDoc();
  const orphan = {
    ...doc,
    features: doc.features.map((feature) =>
      feature.id === "extrude-1" && feature.type === "extrude"
        ? { ...feature, operation: "join" as const }
        : feature,
    ),
  };
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(orphan));
  await page.goto("/");
  await expect(page.getByTestId("kernel-status")).toContainText("error", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "error",
  );
  await expect(page.getByTestId("rebuild-status")).toContainText(
    "Nothing exists to join.",
  );
  await expect(page.locator('[data-feature-id="extrude-1"]')).toHaveAttribute(
    "data-status",
    "error",
  );
  await context.close();
});

test("rebuilds downstream features after editing the first sketch", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript((json) => {
    localStorage.setItem("cad.doc", json);
  }, JSON.stringify(multiFeatureDoc()));
  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready", {
    timeout: 60_000,
  });
  await expect(page.getByTestId("kernel-status")).toContainText("ready", {
    timeout: 60_000,
  });
  const expected = 80 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);

  await page.getByTestId("timeline-sketch").click();
  await page.getByTestId("tool-circle").click();
  await clickSketch(page, 10, 10);
  await clickSketch(page, 15, 10);
  await page.keyboard.press("Escape");
  await page.getByTestId("finish-sketch").click();
  // Build through the rest of the history to see the downstream effect.
  await page.locator("[data-feature-id]").last().click();
  await expect.poll(() => volume(page)).not.toBeCloseTo(expected, -1);

  await page.getByTestId("undo").click();
  await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
  await context.close();
});


test("switches and persists the appearance theme", async ({ app: page }) => {
  await page.getByTestId("theme-night").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
  await expect(page.locator(".doc-head")).toHaveCSS(
    "background-color",
    "rgb(17, 17, 16)",
  );

  await page.getByTestId("highlight-pink").click();
  await expect(page.locator("html")).toHaveAttribute("data-highlight", "pink");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--marker")
          .trim(),
      ),
    )
    .toBe("#ff79c9");
  expect(
    await page.evaluate(() => ({
      mode: localStorage.getItem("cad.theme"),
      highlight: localStorage.getItem("cad.highlight"),
    })),
  ).toEqual({ mode: "night", highlight: "pink" });

  // Sketch ink follows the theme immediately.
  await enterSketch(page);
  await expect(page.locator("line[data-geometry-id]").first()).toHaveCSS(
    "stroke",
    "rgb(242, 239, 227)",
  );

  // A new document in the same context reads the saved appearance before React
  // paints, without reloading the warm worker page.
  const second = await page.context().newPage();
  await second.goto("/");
  await expect(second.locator("html")).toHaveAttribute("data-theme", "night");
  await expect(second.locator("html")).toHaveAttribute("data-highlight", "pink");
  await second.close();

  await page.getByTestId("theme-day").click();
  await page.getByTestId("highlight-yellow").click();
  await expect(page.locator(".doc-head")).toHaveCSS(
    "background-color",
    "rgb(251, 251, 249)",
  );
});
