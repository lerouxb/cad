import { expect, type Page } from "@playwright/test";

/**
 * Wait for the sketch view to stop moving. Drawing auto-fits the view, and the
 * tool options row collapses for create tools, which changes the SVG's pixel
 * size (and therefore the CTM) without changing the sketch-space viewBox. Both
 * must settle before mapping the next gesture.
 */
/**
 * A feature draft now opens in the model. Legacy sketch-coordinate helpers that
 * are used to pick profiles enter the sketch through the form's stage row first.
 */
async function ensureSketchStage(page: Page): Promise<void> {
  const canvas = page.locator("svg.sketch-canvas");
  if (await canvas.isVisible()) return;
  const extrude = page.getByTestId("popover-select-profiles");
  if ((await extrude.count()) > 0 && (await extrude.isVisible())) {
    await extrude.click();
  } else {
    const revolve = page.getByTestId("revolve-select-profiles");
    if ((await revolve.count()) > 0 && (await revolve.isVisible())) {
      await revolve.click();
    }
  }
  await expect(canvas).toBeVisible();
}

export async function settleSketch(page: Page): Promise<void> {
  await ensureSketchStage(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let last = "";
        let stable = 0;
        let frames = 0;
        const tick = () => {
          const svg = document.querySelector<SVGSVGElement>(
            "svg.sketch-canvas",
          );
          const rect = svg?.getBoundingClientRect();
          const current = `${svg?.getAttribute("viewBox") ?? ""}|${Math.round(
            rect?.width ?? 0,
          )}x${Math.round(rect?.height ?? 0)}`;
          frames += 1;
          if (frames >= 4) {
            if (current === last) stable += 1;
            else stable = 0;
            last = current;
            if (stable >= 2) {
              resolve();
              return;
            }
          }
          if (frames >= 30) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Screen point for a sketch-space coordinate (after the view settles). */
export async function sketchPoint(
  page: Page,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  await settleSketch(page);
  return page.evaluate(
    ([sx, sy]) => {
      const svg = document.querySelector<SVGSVGElement>("svg.sketch-canvas");
      const matrix = svg?.getScreenCTM();
      if (!matrix) throw new Error("Sketch canvas is not visible");
      const point = new DOMPoint(sx, sy).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    },
    [x, y],
  );
}

/** Click a point given in sketch millimetres, independent of pan/zoom. */
export async function clickSketch(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  const screen = await sketchPoint(page, x, y);
  await page.mouse.click(screen.x, screen.y);
}

export async function dblclickSketch(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  const screen = await sketchPoint(page, x, y);
  await page.mouse.dblclick(screen.x, screen.y);
}

/** Drag between two points given in sketch millimetres. */
export async function dragSketch(
  page: Page,
  from: [number, number],
  to: [number, number],
): Promise<void> {
  await settleSketch(page);
  // Map both ends with the same CTM: an auto-fit between two lookups would
  // skew the drag.
  const points = await page.evaluate(
    ([ax, ay, bx, by]) => {
      const svg = document.querySelector<SVGSVGElement>("svg.sketch-canvas");
      const matrix = svg?.getScreenCTM();
      if (!matrix) throw new Error("Sketch canvas is not visible");
      const a = new DOMPoint(ax!, ay!).matrixTransform(matrix);
      const b = new DOMPoint(bx!, by!).matrixTransform(matrix);
      return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
    },
    [from[0], from[1], to[0], to[1]],
  );
  await dragScreen(page, points.a.x, points.a.y, points.b.x, points.b.y);
}

/** Drag a freehand lasso through points given in sketch millimetres. */
export async function lassoSketch(
  page: Page,
  points: [number, number][],
): Promise<void> {
  await settleSketch(page);
  const screen = await page.evaluate((world) => {
    const svg = document.querySelector<SVGSVGElement>("svg.sketch-canvas");
    const matrix = svg?.getScreenCTM();
    if (!matrix) throw new Error("Sketch canvas is not visible");
    return world.map(([x, y]) => {
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
  }, points);
  const first = screen[0]!;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of screen.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps: 5 });
  }
  await page.mouse.move(first.x, first.y, { steps: 5 });
  await page.mouse.up();
}

/** Drag in screen pixels. */
export async function dragScreen(
  page: Page,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
}

/** Open the active sketch step in the sketch editor. */
export async function enterSketch(page: Page): Promise<void> {
  await page.getByTestId("timeline-sketch").click();
  await expect(page.getByTestId("tool-select")).toBeVisible();
}

/** Bounds of the first region fill, in sketch millimetres. */
export async function readProfileRect(page: Page) {
  return page.evaluate(() => {
    const element = document.querySelector("[data-region-bounds]");
    const raw = element?.getAttribute("data-region-bounds");
    if (!raw) throw new Error("No region bounds");
    const [minX, minY, maxX, maxY] = raw.split(",").map(Number);
    return { minX: minX!, minY: minY!, maxX: maxX!, maxY: maxY! };
  });
}
