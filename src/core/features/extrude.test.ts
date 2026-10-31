import { describe, expect, it } from "vitest";
import { addCircle, addRectangle, emptySketch } from "../sketch/create";
import { regionsFromSketch } from "../sketch/loops";
import { selectExtrudeRegions } from "./extrude";

function plateWithHole() {
  const rectangle = addRectangle(emptySketch(), [0, 0], [60, 40]);
  const sketch = addCircle(rectangle, { point: [30, 20] }, 8);
  return regionsFromSketch(sketch);
}

describe("extrude region selection", () => {
  it("falls back to the largest material face", () => {
    const regions = plateWithHole();
    const selection = selectExtrudeRegions(regions, []);
    expect(selection.auto).toBe(true);
    expect(selection.stale).toBe(false);
    expect(selection.regions).toHaveLength(1);
    expect(selection.regions[0]?.kind).toBe("material");
    expect(selection.regions[0]?.holes).toHaveLength(1);
  });

  it("honours an explicit void (hole) selection", () => {
    const regions = plateWithHole();
    const hole = regions.find((region) => region.kind === "void")!;
    const selection = selectExtrudeRegions(regions, [hole.id]);
    expect(selection.auto).toBe(false);
    expect(selection.stale).toBe(false);
    expect(selection.ids).toEqual([hole.id]);
    expect(selection.regions[0]?.kind).toBe("void");
  });

  it("keeps valid ids and reports stale ones", () => {
    const regions = plateWithHole();
    const plate = regions.find((region) => region.kind === "material")!;
    const selection = selectExtrudeRegions(regions, [plate.id, "gone"]);
    expect(selection.auto).toBe(false);
    expect(selection.stale).toBe(true);
    expect(selection.ids).toEqual([plate.id]);
  });

  it("falls back when every stored id is stale", () => {
    const selection = selectExtrudeRegions(plateWithHole(), ["gone"]);
    expect(selection.auto).toBe(true);
    expect(selection.stale).toBe(true);
    expect(selection.regions[0]?.kind).toBe("material");
  });

  it("returns nothing for a sketch without profiles", () => {
    const selection = selectExtrudeRegions(regionsFromSketch(emptySketch()), []);
    expect(selection.regions).toEqual([]);
    expect(selection.ids).toEqual([]);
    expect(selection.auto).toBe(true);
  });
});
