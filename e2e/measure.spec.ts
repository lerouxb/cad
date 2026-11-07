import { expect } from "@playwright/test";
import { collectErrors, resetExample, test } from "./support/app";
import { fitView, scanVisibleEdges } from "./support/model";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

test("measures the body, a face, an edge and two targets", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page.getByTestId("model-tool-measure").click();
  const measure = page.getByTestId("measure-popover");
  await expect(measure).toBeVisible();
  await fitView(page);

  // Whole body: exact volume, surface area and centre of mass.
  await expect(page.getByTestId("measure-volume")).toHaveText("26387.3 mm³");
  await expect(page.getByTestId("measure-area")).toHaveText("7401.1 mm²");
  await expect(page.getByTestId("measure-center")).toHaveText(
    "0, 0, 6 mm",
  );
  await expect(page.getByTestId("model-tool-measure")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("model-tool-select")).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // A face: exact area and perimeter; clicking it again removes the target.
  await page.mouse.click(700, 330);
  await expect(page.getByTestId("measure-area")).toHaveText("2198.9 mm²");
  await expect(page.getByTestId("measure-perimeter")).toHaveText("250.3 mm");
  await expect(measure).toHaveAttribute("data-count", "1");
  await page.mouse.click(700, 330);
  await expect(measure).toHaveAttribute("data-count", "0");
  await expect(page.getByTestId("measure-volume")).toBeVisible();

  // The hole's circular edge: arc length and radius.
  const edges = await scanVisibleEdges(page);
  const hole = edges.find((edge) => edge.length > 50 && edge.length < 51);
  expect(hole).toBeDefined();
  await page.mouse.click(hole!.x, hole!.y);
  await expect(page.getByTestId("measure-length")).toHaveText("50.3 mm");
  await expect(page.getByTestId("measure-radius")).toHaveText("8 mm");
  await page.getByTestId("measure-clear").click();

  // Two parallel vertical edges: minimum distance 60, angle 0.
  const verticals = edges.filter(
    (edge) =>
      Math.abs(edge.length - 12) < 0.6 &&
      Math.abs((edge.ref.hint?.midpoint?.[1] ?? 0) + 20) < 0.5,
  );
  expect(verticals.length).toBeGreaterThanOrEqual(2);
  await page.mouse.click(verticals[0]!.x, verticals[0]!.y);
  await page.mouse.click(verticals[1]!.x, verticals[1]!.y);
  await expect(page.getByTestId("measure-distance")).toHaveText("60 mm");
  await expect(page.getByTestId("measure-angle")).toHaveText("0°");
  await page.getByTestId("measure-clear").click();

  // Two planar faces: 90° and zero minimum distance (they meet).
  await page.mouse.click(700, 330);
  await page.mouse.click(730, 380);
  await expect(page.getByTestId("measure-angle")).toHaveText("90°");
  await expect(page.getByTestId("measure-distance")).toHaveText("0 mm");

  // Escape leaves measure mode and restores the select tool.
  await page.keyboard.press("Escape");
  await expect(measure).toHaveCount(0);
  await expect(page.getByTestId("model-tool-measure")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.getByTestId("model-tool-select")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors).toEqual([]);
});
