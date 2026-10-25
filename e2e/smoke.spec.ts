import { expect, test, type Locator } from "@playwright/test";

/** Set a range input the way a user would, through React's onChange. */
async function setSlider(locator: Locator, value: number): Promise<void> {
  await locator.evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("a constrained sketch drives an exact solid", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");

  await expect(page.getByTestId("solver-status")).toContainText("ready");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");

  const stats = page.getByTestId("mesh-stats");
  await expect(stats).toBeVisible();

  // 60 x 40 x 12 plate with a Ø16 hole.
  const expected = 60 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeGreaterThan(0);
  const initialVolume = Number(await stats.getAttribute("data-volume"));
  expect(Math.abs(initialVolume - expected)).toBeLessThan(1);

  await expect(page.getByTestId("dof")).toContainText("2 DOF");

  // Drag the bottom-right corner to the right: the rectangle gets wider.
  const corner = page.locator('[data-point-id="p1"]');
  const box = await corner.boundingBox();
  if (!box) throw new Error("Could not locate the sketch corner");

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 15, {
    steps: 8,
  });
  await page.mouse.up();

  const widthSlider = page.getByTestId("width-slider");
  const heightSlider = page.getByTestId("height-param-slider");
  const draggedWidth = Number(await widthSlider.inputValue());
  expect(draggedWidth).toBeGreaterThan(60);
  const draggedHeight = Number(await heightSlider.inputValue());
  expect(draggedHeight).toBe(40);
  // The dragged y is rejected by the horizontal constraint.
  await expect(page.getByTestId("dof")).toContainText("2 DOF");

  // The rebuild is debounced, but it does follow the drag.
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .not.toBe(initialVolume);

  // Lock the size, then drive it parametrically.
  await page.getByRole("button", { name: "Constrain size" }).click();
  await expect(page.getByTestId("dof")).toContainText("Fully constrained");

  await setSlider(widthSlider, 90);
  await expect(widthSlider).toHaveValue("90");

  const expectedResized = 90 * draggedHeight * 12 - Math.PI * 8 * 8 * 12;
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeCloseTo(expectedResized, -1);

  // Extrude height is a feature parameter.
  await setSlider(page.getByTestId("height-slider"), 30);
  const expectedTaller = 90 * draggedHeight * 30 - Math.PI * 8 * 8 * 30;
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeCloseTo(expectedTaller, -1);
  const parametricVolume = Number(await stats.getAttribute("data-volume"));

  // Draw a new rectangle with the tool. Drawing replaces the example.
  await page.getByTestId("tool-rect").click();
  const frame = await page.getByLabel("Sketch editor").boundingBox();
  if (!frame) throw new Error("Could not locate the sketch canvas");
  const startX = frame.x + 60;
  const startY = frame.y + 60;
  const endX = frame.x + 250;
  const endY = frame.y + 180;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .not.toBeCloseTo(parametricVolume, 0);
  const drawnVolume = Number(await stats.getAttribute("data-volume"));
  expect(drawnVolume).toBeGreaterThan(0);

  // One undo removes the whole drawn shape and restores the example.
  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeCloseTo(parametricVolume, -1);

  expect(errors).toEqual([]);
});

test("selects, multi-selects, and deletes sketch geometry", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");

  const stats = page.getByTestId("mesh-stats");
  await expect(stats).toBeVisible();
  const initialVolume = Number(await stats.getAttribute("data-volume"));
  expect(initialVolume).toBeGreaterThan(0);

  /** Click a point in sketch millimetres, independent of the current pan/zoom. */
  const clickSketch = async (x: number, y: number): Promise<void> => {
    const screen = await page.evaluate(
      ([sx, sy]) => {
        const svg = document.querySelector<SVGSVGElement>("svg.sketch-canvas");
        const matrix = svg?.getScreenCTM();
        if (!matrix) throw new Error("Sketch canvas is not visible");
        const point = new DOMPoint(sx, sy).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      },
      [x, y],
    );
    await page.mouse.click(screen.x, screen.y);
  };

  // The demo's bottom edge runs from (0, 0) to (60, 0).
  await clickSketch(30, 0);
  const panel = page.getByTestId("selection-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Line");
  await expect(panel).toContainText("60 mm");

  await page.keyboard.press("Delete");
  await expect(panel).toHaveCount(0);
  // The demo's hole circle is still a closed region, so deleting the plate's
  // edges turns the circle into the body.
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeCloseTo(Math.PI * 8 * 8 * 12, -1);

  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeCloseTo(initialVolume, -1);

  // Shift-click adds the right edge to the selection.
  await clickSketch(30, 0);
  await page.keyboard.down("Shift");
  await clickSketch(60, 20);
  await page.keyboard.up("Shift");
  await expect(page.getByTestId("selection-panel")).toHaveAttribute("data-count", "2");
  await expect(page.getByTestId("selection-panel")).toContainText("2 selected");

  await page.getByTestId("delete-selection").click();
  await expect(page.getByTestId("selection-panel")).toHaveCount(0);
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeCloseTo(Math.PI * 8 * 8 * 12, -1);

  await page.keyboard.press("Control+z");
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeCloseTo(initialVolume, -1);

  expect(errors).toEqual([]);
});

test("extrudes a lone circle as a cylinder", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");

  await page.getByTestId("clear-sketch").click();
  await page.getByTestId("tool-circle").click();

  const frame = await page.getByLabel("Sketch editor").boundingBox();
  if (!frame) throw new Error("Could not locate the sketch canvas");
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  await page.mouse.click(cx, cy);
  await page.mouse.click(cx + 55, cy);

  const stats = page.getByTestId("mesh-stats");
  await expect(stats).toBeVisible();

  const diameter = Number(await page.getByTestId("hole-slider").inputValue());
  expect(diameter).toBeGreaterThan(0);
  const expected = Math.PI * (diameter / 2) ** 2 * 12;
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeCloseTo(expected, -1);

  expect(errors).toEqual([]);
});

test("uses a drawn inner rectangle as a hole", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");

  await page.getByTestId("tool-rect").click();
  const frame = await page.getByLabel("Sketch editor").boundingBox();
  if (!frame) throw new Error("Could not locate the sketch canvas");

  const drag = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 8 });
    await page.mouse.up();
  };

  await drag(frame.x + 60, frame.y + 50, frame.x + 300, frame.y + 210);

  const stats = page.getByTestId("mesh-stats");
  await expect(stats).toBeVisible();
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeGreaterThan(0);
  const outerVolume = Number(await stats.getAttribute("data-volume"));

  await drag(frame.x + 140, frame.y + 100, frame.x + 230, frame.y + 160);

  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .not.toBeCloseTo(outerVolume, 0);

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

  const expected = outerVolume - innerArea * 12;
  await expect
    .poll(async () => Number(await stats.getAttribute("data-volume")))
    .toBeCloseTo(expected, -1);

  expect(errors).toEqual([]);
});

test("creates, edits and deletes parametric dimensions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");
  await expect(page.getByTestId("solver-status")).toContainText("ready");
  await expect(page.getByTestId("kernel-status")).toContainText("ready");

  const clickSketch = async (x: number, y: number): Promise<void> => {
    const screen = await page.evaluate(
      ([sx, sy]) => {
        const svg = document.querySelector<SVGSVGElement>("svg.sketch-canvas");
        const matrix = svg?.getScreenCTM();
        if (!matrix) throw new Error("Sketch canvas is not visible");
        const point = new DOMPoint(sx, sy).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      },
      [x, y],
    );
    await page.mouse.click(screen.x, screen.y);
  };

  const stats = page.getByTestId("mesh-stats");
  const volume = async () => Number(await stats.getAttribute("data-volume"));

  await page.getByTestId("tool-dimension").click();
  await clickSketch(30, 0); // the demo's bottom edge
  await clickSketch(30, -16); // place below it

  const widthLabel = page.locator("[data-dimension-id]").filter({ hasText: "60" });
  await expect(widthLabel).toBeVisible();
  await expect(page.getByTestId("dof")).toContainText("1 DOF");

  await widthLabel.dblclick();
  await page.getByTestId("dimension-input").fill("90");
  await page.getByTestId("dimension-input").press("Enter");

  const widened = 90 * 40 * 12 - Math.PI * 8 * 8 * 12;
  await expect.poll(volume).toBeCloseTo(widened, -1);
  await expect(page.getByTestId("width-slider")).toHaveValue("90");

  // A reference dimension measures without constraining: the DOF stays put and
  // the height slider remains disabled.
  await page.getByTestId("reference-toggle").check();
  await clickSketch(90, 20); // right edge after the width change
  await clickSketch(104, 20);
  await expect(page.locator("[data-dimension-id]")).toHaveCount(3);
  await expect(page.getByTestId("dof")).toContainText("1 DOF");
  await expect(page.getByTestId("height-param-slider")).toBeDisabled();

  // Deleting the driving dimension frees the width again.
  await page.locator("[data-dimension-id]").filter({ hasText: "90" }).dblclick();
  await page.getByTestId("dimension-delete").click();
  await expect(page.getByTestId("dof")).toContainText("2 DOF");
  await expect(page.getByTestId("width-slider")).toBeDisabled();

  expect(errors).toEqual([]);
});
