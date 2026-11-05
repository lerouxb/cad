import { expect } from "@playwright/test";
import {
  collectErrors,
  resetExample,
  test,
  volume,
} from "./support/app";
import {
  addFacePick,
  fitView,
  pickTopFace,
  scanVisibleFaces,
  selectedFaceRefs,
  shiftClick,
} from "./support/model";
import {
  examplePlateVolume,
  exampleShelledPlateVolume,
} from "../src/core/doc/exampleMetrics";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

test("shells the plate with the top face open", async ({ app: page }) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await expect(page.getByTestId("face-selection-popover")).toHaveAttribute(
    "data-count",
    "1",
  );
  expect(await selectedFaceRefs(page)).toHaveLength(1);

  await page.getByTestId("start-shell").click();
  await expect(page.getByTestId("shell-feature-popover")).toBeVisible();
  await expect(page.getByTestId("shell-feature-faces")).toHaveText(
    "1 open face",
  );
  await page.getByTestId("shell-feature-thickness").fill("2");

  // The draft previews through the kernel before it is a history step.
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(exampleShelledPlateVolume(), -1);
  await page.getByTestId("shell-feature-apply").click();

  const step = page.locator('[data-feature-type="shell"]');
  await expect(step).toHaveCount(1);
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect(step.locator(".tree-meta")).toContainText("2 mm · 1 open face");
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "14",
  );
  // The step highlight is the inner/rim faces the shell generated.
  await expect
    .poll(async () =>
      Number(
        await page
          .locator("canvas.viewport-canvas")
          .getAttribute("data-feature-faces"),
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(exampleShelledPlateVolume(), -1);
  expect(errors).toEqual([]);
});

test("shift-click selects and toggles multiple faces", async ({ app: page }) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  const topId = await page.getByTestId("body-pick").getAttribute("data-id");
  expect(topId).toBeTruthy();

  const other = await addFacePick(page, new Set([topId!]));
  const popover = page.getByTestId("face-selection-popover");
  await expect(popover).toHaveAttribute("data-count", "2");
  expect(await selectedFaceRefs(page)).toHaveLength(2);

  // Clicking a selected face again removes it, and the single overlay moves
  // back to the face that is still selected.
  const canvas = page.locator("canvas.viewport-canvas");
  await shiftClick(page, other.x, other.y);
  await expect(popover).toHaveAttribute("data-count", "1");
  expect(await canvas.getAttribute("data-picked-face")).not.toBe("");
  await shiftClick(page, other.x, other.y);
  await expect(popover).toHaveAttribute("data-count", "2");

  // Removing the last face clears the single overlay as well.
  await page.getByTestId("clear-face-selection").click();
  await expect(popover).toHaveCount(0);
  expect(await canvas.getAttribute("data-picked-face")).toBe("");
  expect(errors).toEqual([]);
});

test("a click refines a box selection without switching tools", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await fitView(page);
  await page.getByTestId("model-filter-faces").click();
  await page.getByTestId("model-tool-box").click();

  await page.mouse.move(260, 140);
  await page.mouse.down();
  await page.mouse.move(1040, 560, { steps: 8 });
  await page.mouse.up();
  const popover = page.getByTestId("face-selection-popover");
  await expect(popover).toHaveAttribute("data-count", "7");
  const before = await selectedFaceRefs(page);

  // Still on the box tool: a plain click is a click pick, not an empty
  // marquee, so Shift-click removes one face from the set.
  const face = (await scanVisibleFaces(page))[0]!;
  await shiftClick(page, face.x, face.y);
  await expect(popover).toHaveAttribute("data-count", "6");
  const after = await selectedFaceRefs(page);
  expect(after).toHaveLength(6);
  expect(after.map((ref) => ref.role)).not.toEqual(
    before.map((ref) => ref.role),
  );
  // The single selected overlay follows the set: the toggled-off face must not
  // stay as the picked anchor (it used to keep a stale wash).
  const removed = before.find(
    (candidate) =>
      !after.some(
        (ref) =>
          ref.source === candidate.source && ref.role === candidate.role,
      ),
  )!;
  const canvas = page.locator("canvas.viewport-canvas");
  expect(await canvas.getAttribute("data-picked-face")).not.toBe(
    `${removed.source}|${removed.role}`,
  );
  expect(
    after.map((ref) => `${ref.source}|${ref.role}`),
  ).toContain(await canvas.getAttribute("data-picked-face"));

  // Switching to select keeps the set; a Shift-click there also toggles.
  await page.getByTestId("model-tool-select").click();
  await expect(popover).toHaveAttribute("data-count", "6");
  await shiftClick(page, face.x, face.y);
  await expect(popover).toHaveAttribute("data-count", "7");
  expect(errors).toEqual([]);
});

test("box and lasso select faces under the faces filter", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await fitView(page);
  await page.getByTestId("model-filter-faces").click();
  await page.getByTestId("model-tool-box").click();

  // Window selection selects every face whose triangles are inside the box,
  // including the hidden ones (select-through, like edges).
  await page.mouse.move(260, 140);
  await page.mouse.down();
  await page.mouse.move(1040, 560, { steps: 8 });
  await page.mouse.up();
  const popover = page.getByTestId("face-selection-popover");
  await expect(popover).toHaveAttribute("data-count", "7");
  const boxed = await selectedFaceRefs(page);
  expect(boxed).toHaveLength(7);
  expect(boxed.every((ref) => ref.hint?.surfaceType)).toBe(true);

  // A lasso selects the faces it touches. Which ones depends on the camera, so
  // assert the gesture rather than a count (the box above pins the exact set).
  await page.getByTestId("clear-face-selection").click();
  await expect(popover).toHaveCount(0);
  await page.getByTestId("model-tool-lasso").click();
  await page.mouse.move(760, 310);
  await page.mouse.down();
  await page.mouse.move(800, 310, { steps: 4 });
  await page.mouse.move(800, 350, { steps: 4 });
  await page.mouse.move(760, 350, { steps: 4 });
  await page.mouse.move(760, 310, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => Number(await popover.getAttribute("data-count")))
    .toBeGreaterThan(0);
  const lassoed = await selectedFaceRefs(page);
  expect(lassoed.length).toBeGreaterThan(0);
  expect(lassoed.every((ref) => ref.hint?.surfaceType)).toBe(true);
  const lassoCount = Number(await popover.getAttribute("data-count"));

  // An empty marquee is a no-op, not a clear.
  await page.mouse.move(300, 500);
  await page.mouse.down();
  await page.mouse.move(320, 520, { steps: 4 });
  await page.mouse.up();
  await expect(popover).toHaveAttribute("data-count", String(lassoCount));

  expect(errors).toEqual([]);
});

test("a shell survives an upstream height edit", async ({ app: page }) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await page.getByTestId("start-shell").click();
  await page.getByTestId("shell-feature-thickness").fill("2");
  await page.getByTestId("shell-feature-apply").click();
  const step = page.locator('[data-feature-type="shell"]');
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(exampleShelledPlateVolume(), -1);

  // The open face is a stable ref: a taller plate rebuilds the same shell.
  await page.getByTestId("timeline-extrude").click();
  await page.getByTestId("extrude-height").fill("20");
  await page.getByTestId("feature-popover-apply").click();
  await step.click();
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(exampleShelledPlateVolume(20), -1);
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "ok",
  );
  expect(errors).toEqual([]);
});

test("an impossible shell thickness is a visible error and recovers", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await pickTopFace(page);
  await page.getByTestId("start-shell").click();
  await page.getByTestId("shell-feature-thickness").fill("2");
  await page.getByTestId("shell-feature-apply").click();
  const step = page.locator('[data-feature-type="shell"]');
  await expect(step).toHaveAttribute("data-status", "ok");

  await step.click();
  await page.getByTestId("shell-feature-thickness").fill("50");
  await expect(step).toHaveAttribute("data-status", "error");
  await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
    "data-status",
    "error",
  );
  // The last good (pre-shell) body stays visible.
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(examplePlateVolume(), -1);
  await expect(page.getByTestId("mesh-stats")).toHaveAttribute(
    "data-faces",
    "7",
  );

  await page.getByTestId("shell-feature-thickness").fill("2");
  await expect(step).toHaveAttribute("data-status", "ok");
  await expect
    .poll(() => volume(page))
    .toBeCloseTo(exampleShelledPlateVolume(), -1);
  await page.getByTestId("shell-feature-apply").click();
  expect(errors).toEqual([]);
});
