import { describe, expect, it } from "vitest";
import {
  offsetBlindCylinderMessage,
  offsetCurvedNeighbourMessage,
  offsetMultipleCylinderSelectionMessage,
  offsetNonParallelSelectionMessage,
  offsetPartialCylinderMessage,
  offsetSelectedSurfaceMessage,
  offsetSlantedWallMessage,
  offsetSurfaceLabel,
  offsetTangentFilletMessage,
} from "./offsetDiagnostics";

describe("offset diagnostics", () => {
  it("names the public surface families", () => {
    expect(offsetSurfaceLabel("PLANE")).toBe("a planar face");
    expect(offsetSurfaceLabel("CYLINDRE")).toBe("a cylindrical face");
    expect(offsetSurfaceLabel("CONE")).toBe("a conical face");
    expect(offsetSurfaceLabel("SPHERE")).toBe("a spherical face");
    expect(offsetSurfaceLabel("TORUS")).toBe("a toroidal face");
    expect(offsetSurfaceLabel("BSPLINE_SURFACE")).toBe("a B-spline face");
    expect(offsetSurfaceLabel("OFFSET_SURFACE")).toBe("an offset face");
    expect(offsetSurfaceLabel("OTHER_SURFACE")).toBe("a curved face");
  });

  it("names the blocking neighbour and suggests the workaround", () => {
    expect(offsetSlantedWallMessage()).toContain("slanted wall");
    expect(offsetSlantedWallMessage()).toContain(
      "edit the wall so it is perpendicular",
    );
    expect(offsetTangentFilletMessage()).toContain("top-edge fillet");
    expect(offsetTangentFilletMessage()).toContain(
      "Move this offset before the fillet",
    );
    expect(offsetCurvedNeighbourMessage("CONE")).toContain("a conical face");
    expect(offsetCurvedNeighbourMessage("CONE")).toContain(
      "edit that operation",
    );
  });

  it("names the selected-face and selection limits", () => {
    expect(offsetSelectedSurfaceMessage("SPHERE")).toContain(
      "The selected face is a spherical face",
    );
    expect(offsetNonParallelSelectionMessage()).toContain(
      "offset them in separate steps",
    );
    expect(offsetMultipleCylinderSelectionMessage()).toContain(
      "one full cylindrical hole or boss",
    );
  });

  it("distinguishes a partial and a blind cylinder", () => {
    const partial = offsetPartialCylinderMessage(0.25);
    expect(partial).toContain("partial wall (25% of a full circle)");
    expect(partial).toContain("full cylindrical holes and bosses only");
    expect(offsetBlindCylinderMessage()).toContain("blind hole");
  });
});
