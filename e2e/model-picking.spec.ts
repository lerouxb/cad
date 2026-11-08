import { expect } from "@playwright/test";
import { resetExample, test } from "./support/app";
import {
  collectErrors,
  volume,
} from "./support/app";
import {
  fitView,
  scanVisibleEdges,
  findHoverNear,
  selectedEdgeRefs,
  shiftClick,
  type EdgeRefLike,
} from "./support/model";
import {
  openInsert,
} from "./support/workflow";

test.beforeEach(async ({ app: page }) => {
  await resetExample(page);
});


test("the model filter row limits picks and Select Other cycles", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  const canvas = page.locator("canvas.viewport-canvas");
  const pick = page.getByTestId("body-pick");
  await fitView(page);

  await expect(page.getByTestId("model-tool-select")).toBeVisible();
  await expect(page.getByTestId("model-filter-all")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The filter's consequence lives in the kicker tooltip, not as inline prose.
  const filters = page
    .locator(".model-tools .tool-options")
    .filter({ has: page.getByTestId("model-filter-all") });
  await expect(filters.locator(".tool-kicker")).toHaveAttribute(
    "title",
    "Everything can be picked",
  );
  await expect(filters).not.toContainText("picked");

  // A face interior is not pickable under the edges filter.
  const facePoint = { x: 700, y: 330 };
  await page.getByTestId("model-filter-edges").click();
  await page.mouse.move(facePoint.x, facePoint.y);
  await expect(canvas).toHaveAttribute("data-hover-kind", "");

  const [firstEdge] = await scanVisibleEdges(page);
  const edgePoint = firstEdge
    ? { x: firstEdge.x, y: firstEdge.y }
    : null;
  expect(edgePoint).not.toBeNull();
  await page.mouse.click(edgePoint!.x, edgePoint!.y);
  await expect(pick).toHaveAttribute("data-kind", "edge");

  // A click that hits only the filtered-out face keeps the edge selection.
  await page.mouse.click(facePoint.x, facePoint.y);
  await expect(pick).toHaveAttribute("data-kind", "edge");

  // Under faces, a pixel a few px inside the edge resolves to the face behind
  // it. Probe the neighbourhood: a silhouette edge may have no face outside.
  await page.getByTestId("model-filter-faces").click();
  const edgeFacePoint = await findHoverNear(
    page,
    edgePoint!.x,
    edgePoint!.y,
    8,
    "face",
  );
  expect(edgeFacePoint).not.toBeNull();
  await page.mouse.click(edgeFacePoint!.x, edgeFacePoint!.y);
  await expect(pick).toHaveAttribute("data-kind", "face");

  // With everything enabled, the edge wins but Select Other reaches the face.
  await page.getByTestId("model-filter-all").click();
  await page.mouse.move(edgeFacePoint!.x, edgeFacePoint!.y);
  await expect(canvas).toHaveAttribute("data-hover-kind", "edge");
  await page.mouse.click(edgeFacePoint!.x, edgeFacePoint!.y);
  await expect(pick).toHaveAttribute("data-kind", "edge");
  const other = page.getByTestId("select-other");
  await expect(other).toBeVisible();
  await expect(other).toContainText("1 of 2");
  // The chip is a real button: it cycles without clicking the geometry again.
  await other.click();
  await expect(pick).toHaveAttribute("data-kind", "face");
  await expect(other).toContainText("2 of 2");
  await other.click();
  await expect(pick).toHaveAttribute("data-kind", "edge");
  await expect(other).toContainText("1 of 2");

  await page.keyboard.press("Escape");
  await expect(pick).toHaveCount(0);
  await expect(other).toHaveCount(0);
  expect(errors).toEqual([]);
});


test("box and lasso select model edges", async ({ app: page }) => {
  const errors = collectErrors(page);
  await fitView(page);

  const visible = await scanVisibleEdges(page);
  const left = visible.find(
    (edge) => Math.abs(edge.length - 12) < 0.6 && edge.x < 600,
  )!;
  const right = visible.find(
    (edge) => Math.abs(edge.length - 12) < 0.6 && edge.x > 800,
  )!;
  expect(left).toBeDefined();
  expect(right).toBeDefined();

  const drag = async (
    points: Array<{ x: number; y: number }>,
  ): Promise<void> => {
    await page.mouse.move(points[0]!.x, points[0]!.y);
    await page.mouse.down();
    for (const point of points.slice(1)) {
      await page.mouse.move(point.x, point.y, { steps: 6 });
    }
    await expect(page.getByTestId("model-marquee")).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId("model-marquee")).toHaveCount(0);
  };

  // A box selects only what it fully encloses: the vertical edge at the
  // corner, not the long top/bottom edges that merely pass nearby.
  await page.getByTestId("model-tool-box").click();
  await expect(page.getByTestId("model-tool-box")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await drag([
    { x: left.x - 20, y: left.y - 55 },
    { x: left.x + 20, y: left.y + 55 },
  ]);
  const boxed = await selectedEdgeRefs(page);
  expect(boxed).toHaveLength(1);
  expect(boxed[0]!.hint?.length).toBeCloseTo(12, 1);
  expect(boxed[0]!.hint?.midpoint).toEqual([-30, -20, 6]);
  await expect(page.getByTestId("body-selection-popover")).toHaveAttribute(
    "data-count",
    "1",
  );

  // An empty box is a no-op, not "select nothing".
  await drag([
    { x: 220, y: 480 },
    { x: 280, y: 540 },
  ]);
  expect(await selectedEdgeRefs(page)).toHaveLength(1);

  // Shift adds another window to the selection.
  await page.keyboard.down("Shift");
  await drag([
    { x: right.x - 20, y: right.y - 55 },
    { x: right.x + 20, y: right.y + 55 },
  ]);
  await page.keyboard.up("Shift");
  const both = await selectedEdgeRefs(page);
  expect(both).toHaveLength(2);
  expect(both.map((ref) => ref.hint?.midpoint?.[0]).sort()).toEqual([-30, 30]);

  // A lasso selects what it touches, so a small loop over the corner also
  // catches the two edges that meet there.
  await page.getByTestId("clear-body-selection").click();
  await page.getByTestId("model-tool-lasso").click();
  await drag([
    { x: left.x - 14, y: left.y - 14 },
    { x: left.x + 14, y: left.y - 14 },
    { x: left.x + 14, y: left.y + 14 },
    { x: left.x - 14, y: left.y + 14 },
    { x: left.x - 14, y: left.y - 14 },
  ]);
  const lassoed = await selectedEdgeRefs(page);
  expect(lassoed.some((ref) => ref.hint?.length === 12)).toBe(true);
  expect(lassoed.length).toBeGreaterThan(1);

  await page.getByTestId("model-tool-select").click();
  expect(errors).toEqual([]);
});


test("v, b and g select model tools by name", async ({ app: page }) => {
  const errors = collectErrors(page);
  const marquee = page.getByTestId("model-marquee");
  const select = page.getByTestId("model-tool-select");
  const box = page.getByTestId("model-tool-box");
  const lasso = page.getByTestId("model-tool-lasso");
  const marqueeKind = () =>
    marquee.evaluate((element) =>
      element.querySelector("svg") ? "lasso" : "box",
    );

  await expect(select).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("v");
  await expect(select).toHaveAttribute("aria-pressed", "true");

  // b is the box tool, not a tool literally called "b".
  await page.keyboard.press("b");
  await expect(box).toHaveAttribute("aria-pressed", "true");
  await expect(select).toHaveAttribute("aria-pressed", "false");
  await expect(box).toHaveCount(1);
  await page.mouse.move(400, 200);
  await page.mouse.down();
  await page.mouse.move(600, 400, { steps: 4 });
  await expect(marquee).toBeVisible();
  expect(await marqueeKind()).toBe("box");
  await page.mouse.up();

  await page.keyboard.press("g");
  await expect(lasso).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(400, 200);
  await page.mouse.down();
  await page.mouse.move(500, 220, { steps: 4 });
  await page.mouse.move(520, 320, { steps: 4 });
  await expect(marquee).toBeVisible();
  expect(await marqueeKind()).toBe("lasso");
  await page.mouse.up();

  // v returns to a real click tool: no marquee is drawn and the pick works.
  await page.keyboard.press("v");
  await expect(select).toHaveAttribute("aria-pressed", "true");
  await page.mouse.click(700, 330);
  await expect(marquee).toHaveCount(0);
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-kind",
    "face",
  );
  expect(errors).toEqual([]);
});


test("edges that share a face pair are hovered and picked separately", async ({
  app: page,
}) => {
  const errors = collectErrors(page);
  await page.getByTestId("file-menu").click();
  await page.getByTestId("file-open-input").setInputFiles(
    "e2e/fixtures/cat-face.cad.json",
  );
  await expect.poll(() => volume(page)).toBeGreaterThan(1000);
  await fitView(page);

  const canvas = page.locator("canvas.viewport-canvas");
  const faceKey = (ref: EdgeRefLike) =>
    (ref.faces ?? [])
      .map((face) => `${face.source}:${face.role}`)
      .sort()
      .join("|");
  type EdgeHover = Awaited<ReturnType<typeof scanVisibleEdges>>[number];
  const groups = new Map<string, EdgeHover[]>();
  const edges = await scanVisibleEdges(page);
  for (const edge of edges) {
    const key = faceKey(edge.ref);
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const pair = [...groups.values()].find((group) => {
    const midpoints = new Set(
      group.map((edge) => JSON.stringify(edge.ref.hint?.midpoint)),
    );
    return group.length >= 2 && midpoints.size >= 2;
  });
  expect(
    pair,
    "the cat body has edges with the same face pair at different places",
  ).toBeDefined();
  const [first, second] = pair!;
  expect(faceKey(first!.ref)).toBe(faceKey(second!.ref));

  // Hovering the second edge must report its own ref. With a face-pair-only
  // id, setHover saw the same id and left the first edge's hover in place.
  await page.mouse.move(first!.x, first!.y);
  const firstHover = await canvas.getAttribute("data-hover-edge-ref");
  await page.mouse.move(second!.x, second!.y);
  const secondHover = await canvas.getAttribute("data-hover-edge-ref");
  expect(firstHover).toBeTruthy();
  expect(secondHover).toBeTruthy();
  expect(secondHover).not.toBe(firstHover);

  // Both are distinct selections; the old key collapsed them into one.
  await shiftClick(page, first!.x, first!.y);
  await shiftClick(page, second!.x, second!.y);
  await expect(page.getByTestId("body-selection-popover")).toHaveAttribute(
    "data-count",
    "2",
  );
  const selected = await selectedEdgeRefs(page);
  expect(selected).toHaveLength(2);
  expect(
    new Set(selected.map((ref) => JSON.stringify(ref.hint?.midpoint))).size,
  ).toBe(2);
  expect(errors).toEqual([]);
});


test("picks faces and edges in the model view", async ({ app: page }) => {
  const canvas = page.locator("canvas.viewport-canvas");
  // Loading starts with no history cursor; selecting the base extrude is what
  // puts its sketch overlay on the model.
  await page.getByTestId("timeline-extrude").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("feature-popover")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-sketch-overlay", "on");
  await fitView(page);

  // Hover and click a top face.
  await page.mouse.move(700, 330);
  await expect(canvas).toHaveAttribute("data-hover-kind", "face");
  await page.mouse.click(700, 330);
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-kind",
    "face",
  );
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-id",
    /^face-/,
  );
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-ref-role",
    /^extrude:/,
  );
  const ref = JSON.parse(
    (await page.getByTestId("body-pick").getAttribute("data-ref")) ?? "{}",
  );
  expect(ref).toMatchObject({
    kind: "face",
    hint: { entityType: "face" },
  });
  expect(typeof ref.source).toBe("string");

  // Face support is M4; + sketch acknowledges the picked face but still asks
  // for a world plane instead of silently ignoring it.
  await openInsert(page, "sketch");
  await expect(page.getByTestId("support-popover")).toContainText(
    "selected face",
  );
  await page.getByTestId("support-cancel").click();

  // A visible top edge wins over the face underneath it.
  await page.mouse.move(600, 356);
  await expect(canvas).toHaveAttribute("data-hover-kind", "edge");
  await page.mouse.click(600, 356);
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-kind",
    "edge",
  );
  await expect(page.getByTestId("body-pick")).toHaveAttribute(
    "data-id",
    /^edge-/,
  );

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("body-pick")).toHaveCount(0);
});
