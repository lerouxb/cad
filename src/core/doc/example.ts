import type { EdgeRef, TopoRef } from "../kernel/protocol";
import { addCircle, emptySketch } from "../sketch/create";
import { createExampleModel } from "../sketch/demo";
import { regionsFromSketch } from "../sketch/loops";
import {
  createChamferFeature,
  createDatumPlaneFeature,
  createDocument,
  createExtrudeFeature,
  createFilletFeature,
  createSketchFeature,
} from "./create";
import {
  EXAMPLE_PLATE,
  exampleVerticalEdgeMidpoints,
} from "./exampleMetrics";
import { datumDefinitionFrame, frameFromHint } from "./support";
import type { Doc, PlaneRef } from "./types";

/** Stable id so repeatedly loading the built-in example updates one local file
 * entry instead of piling up identical "Example.cad" rows. */
export const EXAMPLE_DOC_ID = "doc-example";

/**
 * The default part: the dimensioned plate from the sketch demo, a midplane
 * derived from its top/bottom faces, a second extrude from Sketch 1 (the central
 * hole as a solid pin), and a face-supported mounting-holes sketch with a
 * suppressed through-all cut.
 *
 * Using Sketch 1 twice is deliberate: it exercises independent region
 * selections on a shared sketch. The mounting sketch lives on the top face and
 * its cut is suppressed so the base plate, picking coordinates and volume
 * goldens stay stable; unsuppress "Mounting holes cut" to drill it. The pin, the
 * four-edge "Rounded plate" fillet and the alternative "Beveled plate" chamfer
 * are suppressed for the same reason.
 */
function plateArea(): number {
  const { width, height, holeDiameter } = EXAMPLE_PLATE;
  return width * height - Math.PI * (holeDiameter / 2) ** 2;
}

export function createExampleDocument(): Doc {
  const model = createExampleModel();
  const base = createDocument(model.sketch, {
    id: EXAMPLE_DOC_ID,
    name: "Example",
    height: EXAMPLE_PLATE.thickness,
  });
  const baseSketch = base.features[0]!;
  const baseExtrude = base.features[1]!;
  const holeRegion = regionsFromSketch(model.sketch).find(
    (region) => region.kind === "void",
  );

  const topHint = {
    entityType: "face" as const,
    surfaceType: "PLANE",
    normal: [0, 0, 1] as [number, number, number],
    centroid: [0, 0, EXAMPLE_PLATE.thickness] as [number, number, number],
    area: plateArea(),
  };
  const bottomHint = {
    entityType: "face" as const,
    surfaceType: "PLANE",
    normal: [0, 0, -1] as [number, number, number],
    centroid: [0, 0, 0] as [number, number, number],
    area: plateArea(),
  };
  const topFace: TopoRef = {
    source: baseExtrude.id,
    kind: "face",
    role: "extrude:face_6",
    hint: topHint,
  };
  const bottomFace: TopoRef = {
    source: baseExtrude.id,
    kind: "face",
    role: "extrude:face_7",
    hint: bottomHint,
  };
  const topFrame = frameFromHint(topHint);
  const bottomFrame = frameFromHint(bottomHint);
  if (!topFrame || !bottomFrame) throw new Error("Invalid example face hints");
  const midplaneDefinition = {
    kind: "midplane" as const,
    a: { kind: "face" as const, ref: topFace, frame: topFrame },
    b: { kind: "face" as const, ref: bottomFace, frame: bottomFrame },
  };
  const midplaneFrame = datumDefinitionFrame(midplaneDefinition);
  if (!midplaneFrame) throw new Error("Invalid example midplane");

  const midplane = createDatumPlaneFeature(
    midplaneDefinition,
    midplaneFrame,
    { name: "Midplane", hidden: true },
  );
  const topSupport: PlaneRef = {
    kind: "face",
    ref: topFace,
    frame: topFrame,
  };

  const centerPin = {
    ...createExtrudeFeature(baseSketch.id, {
      name: "Center pin",
      height: EXAMPLE_PLATE.pinHeight,
    }),
    operation: "join" as const,
    regions: holeRegion ? [holeRegion.id] : [],
    suppressed: true,
  };

  // The top face frame is centred on the origin; the holes are world
  // (-18, 0) and (18, 0).
  const mounting = addCircle(
    addCircle(emptySketch(), { point: [-18, 0] }, 3),
    { point: [18, 0] },
    3,
  );
  const holesSketch = createSketchFeature(mounting, {
    name: "Mounting holes",
    support: topSupport,
  });
  const holesCut = {
    ...createExtrudeFeature(holesSketch.id, {
      name: "Mounting holes cut",
      height: EXAMPLE_PLATE.thickness,
    }),
    operation: "cut" as const,
    end: "throughAll" as const,
    suppressed: true,
  };

  // A discoverable 3D fillet on the plate's four vertical edges. Suppressed so
  // the default body, picking coordinates and volume goldens stay stable;
  // unsuppress "Rounded plate" to see it.
  const sideFace = (
    role: string,
    normal: [number, number, number],
    centroid: [number, number, number],
    area: number,
  ): TopoRef => ({
    source: baseExtrude.id,
    kind: "face",
    // The hints, not these names, are what resolve on the rebuilt body: the
    // example is hand-authored and the worker's role table is generated.
    role,
    hint: {
      entityType: "face",
      surfaceType: "PLANE",
      normal,
      centroid,
      area,
    },
  });
  const { width, height, thickness } = EXAMPLE_PLATE;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const midHeight = thickness / 2;
  const sideArea = width * thickness;
  const endArea = height * thickness;
  const left = sideFace(
    "extrude:side:left",
    [-1, 0, 0],
    [-halfWidth, 0, midHeight],
    endArea,
  );
  const right = sideFace(
    "extrude:side:right",
    [1, 0, 0],
    [halfWidth, 0, midHeight],
    endArea,
  );
  const front = sideFace(
    "extrude:side:front",
    [0, -1, 0],
    [0, -halfHeight, midHeight],
    sideArea,
  );
  const back = sideFace(
    "extrude:side:back",
    [0, 1, 0],
    [0, halfHeight, midHeight],
    sideArea,
  );
  const corners = exampleVerticalEdgeMidpoints();
  const verticalEdge = (a: TopoRef, b: TopoRef, at: number): EdgeRef => ({
    kind: "edge",
    faces: [a, b],
    hint: {
      entityType: "edge",
      length: thickness,
      midpoint: corners[at]!,
    },
  });
  const plateEdges = [
    verticalEdge(left, front, 0),
    verticalEdge(right, front, 1),
    verticalEdge(right, back, 2),
    verticalEdge(left, back, 3),
  ];
  const roundedPlate = {
    ...createFilletFeature(plateEdges, EXAMPLE_PLATE.filletRadius, {
      name: "Rounded plate",
    }),
    suppressed: true,
  };
  const beveledPlate = {
    ...createChamferFeature(plateEdges, EXAMPLE_PLATE.chamferDistance, {
      name: "Beveled plate",
    }),
    suppressed: true,
  };

  return {
    ...base,
    features: [
      baseSketch,
      baseExtrude,
      midplane,
      centerPin,
      holesSketch,
      holesCut,
      roundedPlate,
      beveledPlate,
    ],
  };
}
