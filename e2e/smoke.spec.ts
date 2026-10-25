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
