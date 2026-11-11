import { describe, expect, it } from "vitest";
import {
  createExampleDocumentById,
  DEFAULT_EXAMPLE_ID,
  EXAMPLES,
} from "./examples";

describe("built-in examples", () => {
  it("has unique ids and a default", () => {
    const ids = EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_EXAMPLE_ID);
    expect(createExampleDocumentById("missing").id).toBe("doc-example");
  });

  it("returns plain JSON documents with a sketch and a body feature", () => {
    for (const example of EXAMPLES) {
      const doc = example.create();
      expect(JSON.stringify(JSON.parse(JSON.stringify(doc)))).toBe(
        JSON.stringify(doc),
      );
      expect(doc.features[0]?.type).toBe("sketch");
      expect(
        doc.features.some((feature) => feature.type !== "sketch"),
      ).toBe(true);
    }
  });

  it("builds a non-empty profile for every sketch example", () => {
    for (const example of EXAMPLES) {
      const doc = example.create();
      const sketch = doc.features.find((feature) => feature.type === "sketch");
      expect(sketch).toBeDefined();
      if (sketch?.type !== "sketch") continue;
      expect(sketch.sketch.curves.length).toBeGreaterThan(0);
    }
  });

  it("keeps the intended feature families", () => {
    const revolve = EXAMPLES.find((example) => example.id === "revolve-tube")!;
    const tube = revolve.create();
    expect(tube.features.some((feature) => feature.type === "revolve")).toBe(
      true,
    );
    const fillet = EXAMPLES.find(
      (example) => example.id === "top-edge-fillet-plate",
    )!;
    expect(
      fillet.create().features.some((feature) => feature.type === "fillet"),
    ).toBe(true);
    const chamfer = EXAMPLES.find(
      (example) => example.id === "chamfered-plate",
    )!;
    expect(
      chamfer.create().features.some((feature) => feature.type === "chamfer"),
    ).toBe(true);
    const shell = EXAMPLES.find((example) => example.id === "shelled-tray")!;
    expect(
      shell.create().features.some((feature) => feature.type === "shell"),
    ).toBe(true);
    const blind = EXAMPLES.find((example) => example.id === "blind-hole")!;
    expect(
      blind
        .create()
        .features.some(
          (feature) =>
            feature.type === "extrude" && feature.operation === "join",
        ),
    ).toBe(true);
  });
});
