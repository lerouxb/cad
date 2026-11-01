import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deserializeDoc } from "../doc/persistence";
import { primarySketch } from "../doc/selectors";
import { regionsFromSketch } from "./loops";

function reportedPart() {
  const doc = deserializeDoc(
    readFileSync(
      new URL("./__fixtures__/circle-through-hole.cad.json", import.meta.url),
      "utf8",
    ),
  );
  if (!doc) throw new Error("Fixture did not migrate");
  return doc;
}

describe("reported circle-through-hole part", () => {
  it("keeps both plate faces and both half-disks, and drops the stale selection", () => {
    const regions = regionsFromSketch(primarySketch(reportedPart()));

    expect(regions.some((region) => region.id === "reg-1sontjf")).toBe(false);
    const large = regions.filter(
      (region) => region.kind === "material" && region.area > 800,
    );
    expect(large).toHaveLength(2);
    for (const region of large) {
      expect(region.holes).toHaveLength(0);
      expect(region.outer.kind).toBe("path");
    }
    const halves = regions.filter(
      (region) =>
        region.kind === "material" &&
        region.outer.kind === "path" &&
        region.area < 300,
    );
    expect(halves).toHaveLength(2);
    expect(
      halves.reduce((sum, region) => sum + region.area, 0),
    ).toBeCloseTo(Math.PI * 10 * 10, 0);
  });
});
