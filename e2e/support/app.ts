import {
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { examplePlateVolume } from "../../src/core/doc/exampleMetrics";

/**
 * Reuse one app page per worker. A fresh page per test re-downloads and
 * re-instantiates the solver and OCCT WASM, which dominates the suite.
 */
export const test = base.extend<Record<never, never>, { app: Page }>({
  app: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        baseURL: "http://127.0.0.1:4173",
        viewport: { width: 1280, height: 720 },
      });
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByTestId("solver-status")).toContainText("ready", {
        timeout: 60_000,
      });
      await expect(page.getByTestId("kernel-status")).toContainText("ready", {
        timeout: 60_000,
      });
      await use(page);
      await context.close();
    },
    { scope: "worker" },
  ],
});

export { expect };

/**
 * The one reset every browser test starts from: day theme, yellow highlighter,
 * snap on, automatic grid, the example document, and the history cursor on its
 * base extrude.
 *
 * The non-document view controls are clicked in a single page evaluation: they
 * are plain buttons whose state lives in React/localStorage, and eight round
 * trips per test adds seconds to the suite. `load-example` itself selects the
 * first sketch, sets select/zoom-fit, and starts from a clean selection, so it
 * subsumes the mode/tool/zoom resets the old preamble did by hand.
 */
export async function resetExample(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.removeItem("cad.files");
    const click = (testId: string): void => {
      document
        .querySelector<HTMLElement>(`[data-testid="${testId}"]`)
        ?.click();
    };
    click("theme-day");
    click("highlight-yellow");
    const snap = document.querySelector<HTMLElement>(
      '[data-testid="snap-toggle"]',
    );
    if (snap?.textContent?.includes("off")) snap.click();
    click("grid-auto");
    if (document.querySelector('[data-testid="file-menu-popover"]')) {
      click("file-menu");
    }
  });
  // `load-example` is a header button that survives every document, so a
  // direct DOM click is safe here and skips the actionability round trip.
  await page.evaluate(() => {
    document
      .querySelector<HTMLElement>('[data-testid="load-example"]')
      ?.click();
  });
  // Selecting the extrude moves the history cursor so the body is rendered.
  // Close its form: a test that edits the extrude opts in explicitly, and a
  // background click on the canvas is a dismissal (MODES R4), not a pick.
  await page.getByTestId("timeline-extrude").click();
  await expect.poll(() => volume(page)).toBeCloseTo(examplePlateVolume(), -1);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
}

/** Set a range input the way a user would, through React's onChange. */
export async function setSlider(
  locator: Locator,
  value: number,
): Promise<void> {
  await locator.evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

export async function volume(page: Page): Promise<number> {
  return Number(
    await page.getByTestId("mesh-stats").getAttribute("data-volume"),
  );
}

/** Rounded mesh bounds as a compact string, tolerating tessellation error. */
export async function meshBounds(page: Page): Promise<string> {
  const raw = await page.getByTestId("mesh-stats").getAttribute("data-bbox");
  if (!raw) throw new Error("No mesh bounds");
  return raw
    .split(",")
    .map((value) => Number(Number(value).toFixed(1)))
    .join(",");
}

/** Meta line of the selected timeline step (the step block is the readout). */
export function activeStepMeta(page: Page) {
  return page.locator('[data-feature-id][aria-pressed="true"] .tree-meta');
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}
