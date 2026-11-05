import { expect, type Page } from "@playwright/test";

/** The JSON-safe hint and face refs the app exposes for picked edges. */
export interface EdgeFaceLike {
  source?: string;
  role?: string;
  hint?: { surfaceType?: string };
}

export interface EdgeRefLike {
  faces?: EdgeFaceLike[];
  hint?: { length?: number; midpoint?: [number, number, number] };
}

/**
 * Wait until orbit damping has stopped moving the camera. Screen-space scans
 * and pixel picks assume a still camera: orbit damping keeps moving it for a
 * few frames after the gesture, which is enough to miss an edge at one row of a
 * scan and hit it at another.
 */
export async function waitForCameraSettled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          "canvas.viewport-canvas",
        );
        let last = "";
        let stable = 0;
        let frames = 0;
        const tick = () => {
          const current = canvas?.dataset.camera ?? "";
          if (current !== "" && current === last) stable += 1;
          else stable = 0;
          last = current;
          frames += 1;
          if (stable >= 3 || frames >= 60) {
            resolve();
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/** Fit the camera to the stage and wait for it to stop. */
export async function fitView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Fit view" }).click();
  await waitForCameraSettled(page);
}

/**
 * Pick the first face whose normal matches. The stage height depends on the
 * timeline, so fixed pixel picks are brittle; scan the visible faces and verify
 * the selected TopoRef's normal instead.
 */
export async function pickFace(
  page: Page,
  matches: (normal: [number, number, number]) => boolean,
): Promise<void> {
  const canvas = page.locator("canvas.viewport-canvas");
  const pick = page.getByTestId("body-pick");
  await fitView(page);
  for (let y = 200; y <= 500; y += 25) {
    for (let x = 260; x <= 1050; x += 25) {
      await page.mouse.move(x, y);
      if ((await canvas.getAttribute("data-hover-kind")) !== "face") continue;
      await page.mouse.click(x, y);
      if ((await pick.count()) === 0) continue;
      const raw = await pick.getAttribute("data-ref");
      if (!raw) continue;
      const ref = JSON.parse(raw) as {
        hint?: { surfaceType?: string; normal?: [number, number, number] };
      };
      const normal = ref.hint?.normal;
      if (ref.hint?.surfaceType === "PLANE" && normal && matches(normal)) {
        return;
      }
    }
  }
  throw new Error("No matching face found");
}

export async function pickTopFace(page: Page): Promise<void> {
  await pickFace(page, (normal) => normal[2] > 0.9);
}

/** A long (front/back) side face of the demo plate. */
export async function pickSideFace(page: Page): Promise<void> {
  await pickFace(page, (normal) => Math.abs(normal[1]) > 0.9);
}

/** The right (+X) side face of the demo plate. */
export async function pickRightFace(page: Page): Promise<void> {
  await pickFace(page, (normal) => normal[0] > 0.9);
}

/** Find a screen point over a rendered datum plane after Fit view. */
export async function findDatumHover(
  page: Page,
): Promise<{ x: number; y: number }> {
  const canvas = page.locator("canvas.viewport-canvas");
  for (let y = 120; y <= 600; y += 30) {
    for (let x = 120; x <= 900; x += 30) {
      await page.mouse.move(x, y);
      if ((await canvas.getAttribute("data-hover-kind")) === "datum") {
        return { x, y };
      }
    }
  }
  throw new Error("No datum plane hover target found");
}

/**
 * Scan the model for hoverable edges in one browser round trip. Dispatching
 * pointermove events inside the page is dramatically faster than one
 * Playwright move + attribute read per grid point and is what keeps the
 * fillet/chamfer scans from dominating the suite.
 */
export async function scanVisibleEdges(
  page: Page,
): Promise<
  Array<{
    id: string;
    length: number;
    x: number;
    y: number;
    /** The captured edge ref, for filtering by midpoint/orientation. */
    ref: EdgeRefLike;
  }>
> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.viewport-canvas",
    );
    if (!canvas) return [];
    const found: Array<{
      id: string;
      length: number;
      x: number;
      y: number;
      ref: {
        faces?: Array<{
          source?: string;
          role?: string;
          hint?: { surfaceType?: string };
        }>;
        hint?: { midpoint?: [number, number, number] };
      };
    }> = [];
    const seen = new Set<string>();
    for (let y = 230; y <= 500; y += 10) {
      for (let x = 360; x <= 950; x += 10) {
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: x,
            clientY: y,
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        if (canvas.dataset.hoverKind !== "edge") continue;
        const id = canvas.dataset.hoverId;
        const length = Number(canvas.dataset.hoverEdgeLength);
        if (!id || seen.has(id) || !Number.isFinite(length)) continue;
        seen.add(id);
        let ref: {
          faces?: Array<{
            source?: string;
            role?: string;
            hint?: { surfaceType?: string };
          }>;
          hint?: { midpoint?: [number, number, number] };
        };
        try {
          ref = JSON.parse(canvas.dataset.hoverEdgeRef || "{}");
        } catch {
          continue;
        }
        found.push({ id, length, x, y, ref });
      }
    }
    return found;
  });
}

/** Find a hover of `kind` in a small screen-space neighbourhood. */
export async function findHoverNear(
  page: Page,
  x: number,
  y: number,
  radius: number,
  kind: string,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ([cx, cy, r, wanted]) => {
      const canvas = document.querySelector<HTMLCanvasElement>(
        "canvas.viewport-canvas",
      );
      if (!canvas) return null;
      for (let dy = -r; dy <= r; dy += 1) {
        for (let dx = -r; dx <= r; dx += 1) {
          const px = cx + dx;
          const py = cy + dy;
          canvas.dispatchEvent(
            new PointerEvent("pointermove", {
              clientX: px,
              clientY: py,
              bubbles: true,
              pointerId: 1,
              pointerType: "mouse",
            }),
          );
          if (canvas.dataset.hoverKind === wanted) return { x: px, y: py };
        }
      }
      return null;
    },
    [x, y, radius, kind] as const,
  );
}

/** A face hover record from the fast sweep (no ref: faces publish only ids). */
export interface FaceHover {
  id: string;
  x: number;
  y: number;
}

/**
 * Sweep the model for hoverable faces in one browser round trip, like the edge
 * scan. Used to pick a face other than the one already selected.
 */
export async function scanVisibleFaces(page: Page): Promise<FaceHover[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.viewport-canvas",
    );
    if (!canvas) return [];
    const found: Array<{ id: string; x: number; y: number }> = [];
    const seen = new Set<string>();
    for (let y = 200; y <= 500; y += 10) {
      for (let x = 260; x <= 1050; x += 10) {
        canvas.dispatchEvent(
          new PointerEvent("pointermove", {
            clientX: x,
            clientY: y,
            bubbles: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
        if (canvas.dataset.hoverKind !== "face") continue;
        const id = canvas.dataset.hoverId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        found.push({ id, x, y });
      }
    }
    return found;
  });
}

/** The authoritative multi-face selection, as the face popover renders it. */
export async function selectedFaceRefs(page: Page): Promise<
  Array<{
    source: string;
    role: string;
    hint?: { surfaceType?: string; area?: number };
  }>
> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="face-selection-popover"]',
    );
    const raw = el?.getAttribute("data-face-refs");
    return raw ? (JSON.parse(raw) as unknown[]) : [];
  }) as Promise<
    Array<{
      source: string;
      role: string;
      hint?: { surfaceType?: string; area?: number };
    }>
  >;
}

/** Shift-click a visible face whose pick id is not in `exclude`. */
export async function addFacePick(
  page: Page,
  exclude: ReadonlySet<string> = new Set(),
): Promise<FaceHover> {
  const face = (await scanVisibleFaces(page)).find(
    (candidate) => !exclude.has(candidate.id),
  );
  if (!face) throw new Error("No other face hover target found");
  await shiftClick(page, face.x, face.y);
  return face;
}

export function edgeKey(ref: EdgeRefLike | null | undefined): string {
  return (ref?.faces ?? [])
    .map((face) => `${face.source ?? ""}:${face.role ?? ""}`)
    .sort()
    .join("|");
}

function readSelectedEdgeRefs(page: Page): Promise<EdgeRefLike[]> {
  return page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="body-selection-popover"]',
    );
    const raw = el?.getAttribute("data-edge-refs");
    return raw ? (JSON.parse(raw) as unknown[]) : [];
  }) as Promise<EdgeRefLike[]>;
}

/**
 * The authoritative multi-edge selection, as the popover renders it. Tests read
 * this instead of inferring state from a hover or the single-pick badge.
 */
export async function selectedEdgeRefs(page: Page): Promise<EdgeRefLike[]> {
  // Let React commit before reading (two frames covers a slow paint).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return readSelectedEdgeRefs(page);
}

/**
 * Wait for a click to land. Under parallel-worker load React can take longer
 * than one frame to commit; polling the authoritative readout is what makes the
 * edge scans deterministic without a fixed sleep.
 */
async function waitForEdgeCount(
  page: Page,
  count: number,
  timeout = 4_000,
): Promise<EdgeRefLike[]> {
  await expect
    .poll(async () => (await readSelectedEdgeRefs(page)).length, {
      timeout,
      intervals: [40, 80, 160, 320],
    })
    .toBe(count);
  return readSelectedEdgeRefs(page);
}

export async function shiftClick(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  await page.keyboard.down("Shift");
  await page.mouse.click(x, y);
  await page.keyboard.up("Shift");
}

/**
 * Add every visible edge that `accept` allows. Hovering and clicking agree on
 * the same pixel (the viewport ties edges by screen distance, not ray order),
 * and the popover's `data-edge-refs` is the authoritative result of each click,
 * so a click that selects the wrong edge fails loudly instead of corrupting
 * the fillet/chamfer input.
 */
export async function addVisibleEdges(
  page: Page,
  accept: (ref: EdgeRefLike) => boolean,
): Promise<EdgeRefLike[]> {
  let chosen = await selectedEdgeRefs(page);
  const seen = new Set(chosen.map(edgeKey));
  for (const candidate of await scanVisibleEdges(page)) {
    // The sweep finds candidate pixels; the real hover at that pixel is the
    // oracle for what a click will pick (and is re-read in case the camera or
    // mesh moved after the sweep).
    await page.mouse.move(candidate.x, candidate.y);
    const hovered = await page
      .locator("canvas.viewport-canvas")
      .evaluate((canvas) => {
        const raw = canvas.dataset.hoverEdgeRef;
        return raw ? (JSON.parse(raw) as EdgeRefLike) : null;
      });
    if (!hovered || !accept(hovered)) continue;
    const key = edgeKey(hovered);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    await shiftClick(page, candidate.x, candidate.y);
    const next = await waitForEdgeCount(page, chosen.length + 1);
    expect(
      next.some((item) => edgeKey(item) === key),
      `Clicking the ${hovered.hint?.length ?? "?"} mm edge at (${candidate.x}, ${candidate.y}) selected ${next
        .map((item) => `${item.hint?.length ?? "?"} mm`)
        .join(", ")}`,
    ).toBe(true);
    chosen = next;
  }
  return chosen;
}
