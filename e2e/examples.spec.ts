import { expect } from "@playwright/test";
import { EXAMPLES } from "../src/core/doc/examples";
import { examplePlateVolume } from "../src/core/doc/exampleMetrics";
import type { Doc } from "../src/core/doc/types";
import { regionsFromSketch } from "../src/core/sketch/loops";
import { collectErrors, resetExample, test, volume } from "./support/app";

/** Pappus: a full revolution of a profile is 2π · area · centroid distance. */
function revolvedVolume(doc: Doc): number {
  const sketch = doc.features.find((feature) => feature.type === "sketch");
  if (sketch?.type !== "sketch") return Number.NaN;
  const region = regionsFromSketch(sketch.sketch).find(
    (candidate) => candidate.kind === "material",
  );
  if (!region) return Number.NaN;
  const points =
    region.outer.kind === "circle" ? [] : region.outer.points;
  let doubleArea = 0;
  let centroid = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const cross = a[0] * b[1] - b[0] * a[1];
    doubleArea += cross;
    centroid += (a[0] + b[0]) * cross;
  }
  const area = doubleArea / 2;
  centroid /= 6 * area;
  return 2 * Math.PI * Math.abs(area * centroid);
}

const EXPECTED_VOLUME: Partial<Record<string, number>> = {
  plate: examplePlateVolume(),
  "revolve-tube": Math.PI * (20 ** 2 - 10 ** 2) * 20,
  "revolve-half": (Math.PI * (20 ** 2 - 10 ** 2) * 20) / 2,
  "revolve-cone": (Math.PI * 10 ** 2 * 10) / 3,
  "d-boss": (Math.PI * 10 ** 2 * 10) / 2,
  "blind-hole": 60 * 40 * 12 - Math.PI * 8 ** 2 * 5,
  "chamfered-plate": 60 * 40 * 12 - 2 * ((2 * 2) / 2) * 60,
  "top-edge-fillet-plate":
    60 * 40 * 12 - 2 * (2 * 2 - (Math.PI * 2 ** 2) / 4) * 60,
  "shelled-tray": 60 * 40 * 12 - (60 - 4) * (40 - 4) * 10,
  "rounded-plate":
    examplePlateVolume() - 4 * (4 * 4 - (Math.PI * 4 * 4) / 4) * 12,
  "beveled-plate": examplePlateVolume() - 4 * ((4 * 4) / 2) * 12,
};

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});

for (const example of EXAMPLES) {
  test(`loads ${example.label} from the example menu`, async ({
    app: page,
  }) => {
    const errors = collectErrors(page);
    const doc = example.create();
    await page.getByTestId("load-example").click();
    await expect(page.getByTestId("example-menu")).toBeVisible();
    await page.getByTestId(`example-${example.id}`).click();

    await expect(page.getByTestId("example-menu")).toHaveCount(0);
    await expect(page.getByTestId("doc-name")).toHaveText(doc.name);
    await expect(page.getByTestId("rebuild-status")).toHaveAttribute(
      "data-status",
      "ok",
    );
    await expect(page.getByTestId("mesh-stats")).toBeVisible();
    const expected =
      example.id === "revolve-stepped-shaft"
        ? revolvedVolume(doc)
        : EXPECTED_VOLUME[example.id];
    if (expected !== undefined) {
      await expect.poll(() => volume(page)).toBeCloseTo(expected, -1);
    } else {
      expect(await volume(page)).toBeGreaterThan(0);
    }
    expect(errors).toEqual([]);
  });
}

test("the example menu closes on Escape and an outside click", async ({
  app: page,
}) => {
  const button = page.getByTestId("load-example");
  await button.click();
  await expect(page.getByTestId("example-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("example-menu")).toHaveCount(0);

  await button.click();
  await expect(page.getByTestId("example-menu")).toBeVisible();
  await page.mouse.click(1100, 180);
  await expect(page.getByTestId("example-menu")).toHaveCount(0);
});
