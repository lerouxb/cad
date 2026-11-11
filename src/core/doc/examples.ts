import {
  addArc,
  addCircle,
  addPolyline,
  emptySketch,
} from "../sketch/create";
import { regionsFromSketch } from "../sketch/loops";
import {
  createChamferFeature,
  createDocument,
  createExtrudeFeature,
  createFilletFeature,
  createRevolveFeature,
  createShellFeature,
  createSketchFeature,
} from "./create";
import type { EdgeRef, TopoRef } from "../kernel/protocol";
import { createExampleDocument } from "./example";
import type { Doc } from "./types";
import { CURRENT_SCHEMA_VERSION } from "./types";

export type ExampleId =
  | "plate"
  | "revolve-tube"
  | "revolve-half"
  | "revolve-cone"
  | "revolve-stepped-shaft"
  | "d-boss"
  | "blind-hole"
  | "chamfered-plate"
  | "top-edge-fillet-plate"
  | "shelled-tray"
  | "rounded-plate"
  | "beveled-plate";

export interface ExampleDefinition {
  id: ExampleId;
  label: string;
  description: string;
  create: () => Doc;
}

export const DEFAULT_EXAMPLE_ID: ExampleId = "plate";

function boxSketch() {
  return addPolyline(
    emptySketch(),
    [
      { point: [-30, -20] },
      { point: [30, -20] },
      { point: [30, 20] },
      { point: [-30, 20] },
    ],
    true,
  );
}

function boxDocument(id: string, name: string): Doc {
  return createDocument(boxSketch(), {
    id,
    name,
    height: 12,
    sketchId: `${id}-sketch`,
    extrudeId: `${id}-extrude`,
  });
}

function boxRefs(extrudeId: string) {
  const face = (
    role: string,
    normal: [number, number, number],
    centroid: [number, number, number],
    area: number,
  ): TopoRef => ({
    source: extrudeId,
    kind: "face",
    role,
    hint: {
      entityType: "face",
      surfaceType: "PLANE",
      normal,
      centroid,
      area,
    },
  });
  const top = face("extrude:face_top", [0, 0, 1], [0, 0, 12], 60 * 40);
  const bottom = face("extrude:face_bottom", [0, 0, -1], [0, 0, 0], 60 * 40);
  const right = face("extrude:face_right", [1, 0, 0], [30, 0, 6], 40 * 12);
  const left = face("extrude:face_left", [-1, 0, 0], [-30, 0, 6], 40 * 12);
  const front = face("extrude:face_front", [0, -1, 0], [0, -20, 6], 60 * 12);
  const back = face("extrude:face_back", [0, 1, 0], [0, 20, 6], 60 * 12);
  const edge = (
    a: TopoRef,
    b: TopoRef,
    midpoint: [number, number, number],
  ): EdgeRef => ({
    kind: "edge",
    faces: [a, b],
    hint: { entityType: "edge", length: 60, midpoint },
  });
  return {
    top,
    bottom,
    left,
    right,
    front,
    back,
    topFront: edge(top, front, [0, -20, 12]),
    topBack: edge(top, back, [0, 20, 12]),
  };
}

function withToggledDefault(
  name: string,
  id: string,
  featureName: string,
): Doc {
  const base = createExampleDocument();
  return {
    ...base,
    id,
    name,
    features: base.features.map((feature) =>
      feature.name === featureName
        ? { ...feature, suppressed: false }
        : feature,
    ),
  };
}

function revolveExample(
  id: string,
  name: string,
  sketchPoints: Array<{ point: [number, number] }>,
  angle: number,
): Doc {
  const sketch = addPolyline(emptySketch(), sketchPoints, true);
  const profile = regionsFromSketch(sketch)[0];
  if (!profile) throw new Error(`${name}: no profile`);
  const sketchFeature = createSketchFeature(sketch, {
    id: `${id}-sketch`,
    name: "Profile",
  });
  const revolve = {
    ...createRevolveFeature(sketchFeature.id, {
      id: `${id}-revolve`,
      name: "Revolve",
      axis: { kind: "reference", axis: "y" },
      angle,
    }),
    regions: [profile.id],
  };
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    name,
    features: [sketchFeature, revolve],
  };
}

function steppedShaftSketch() {
  let sketch = addPolyline(
    emptySketch(),
    [
      { point: [0, 0] },
      { point: [14, 0] },
      { point: [14, 3] },
      { point: [20, 3] },
      { point: [20, 7] },
      { point: [12, 7] },
      { point: [12, 11] },
    ],
    false,
  );
  sketch = addArc(
    sketch,
    { point: [12, 11] },
    { point: [12, 15] },
    [10, 13],
  );
  sketch = addPolyline(
    sketch,
    [
      { point: [12, 15] },
      { point: [14, 17] },
      { point: [14, 20] },
      { point: [8, 20] },
      { point: [8, 24] },
      { point: [0, 24] },
    ],
    false,
  );
  // Close the profile along the axis; this is the revolved centreline edge.
  return addPolyline(
    sketch,
    [{ point: [0, 24] }, { point: [0, 0] }],
    false,
  );
}

function revolveFromSketch(
  id: string,
  name: string,
  sketch: ReturnType<typeof emptySketch>,
  angle = 360,
): Doc {
  const profile = regionsFromSketch(sketch)[0];
  if (!profile) throw new Error(`${name}: no profile`);
  const sketchFeature = createSketchFeature(sketch, {
    id: `${id}-sketch`,
    name: "Profile",
  });
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    name,
    features: [
      sketchFeature,
      {
        ...createRevolveFeature(sketchFeature.id, {
          id: `${id}-revolve`,
          name: "Revolve",
          axis: { kind: "reference", axis: "y" },
          angle,
        }),
        regions: [profile.id],
      },
    ],
  };
}

function dShapeSketch() {
  const base = addPolyline(
    emptySketch(),
    [{ point: [-10, 0] }, { point: [10, 0] }],
    false,
  );
  return addArc(base, { point: [10, 0] }, { point: [-10, 0] }, [0, 10]);
}

function blindHoleDocument(): Doc {
  const plate = addCircle(
    addPolyline(
      emptySketch(),
      [
        { point: [-30, -20] },
        { point: [30, -20] },
        { point: [30, 20] },
        { point: [-30, 20] },
      ],
      true,
    ),
    { point: [0, 0] },
    8,
  );
  const base = createDocument(plate, {
    id: "doc-example-blind-hole",
    name: "Blind hole plate",
    height: 12,
    sketchId: "blind-sketch",
    extrudeId: "blind-extrude",
  });
  const plugSketch = createSketchFeature(
    addCircle(emptySketch(), { point: [0, 0] }, 8.1),
    { id: "blind-plug-sketch", name: "Bottom plug" },
  );
  const plug = createExtrudeFeature(plugSketch.id, {
    id: "blind-plug",
    name: "Bottom plug",
    height: 7,
  });
  return {
    ...base,
    features: [
      ...base.features,
      plugSketch,
      { ...plug, operation: "join", regions: [] },
    ],
  };
}

export const EXAMPLES: readonly ExampleDefinition[] = [
  {
    id: "plate",
    label: "Plate",
    description: "The default dimensioned plate with a central through hole",
    create: createExampleDocument,
  },
  {
    id: "revolve-tube",
    label: "Revolve tube",
    description: "Full 360° tube; the profile sits off the Y axis",
    create: () =>
      revolveExample(
        "doc-example-revolve-tube",
        "Revolve tube",
        [
          { point: [10, -10] },
          { point: [20, -10] },
          { point: [20, 10] },
          { point: [10, 10] },
        ],
        360,
      ),
  },
  {
    id: "revolve-half",
    label: "Revolve half",
    description: "180° half tube; same profile, partial revolve",
    create: () =>
      revolveExample(
        "doc-example-revolve-half",
        "Revolve half",
        [
          { point: [10, -10] },
          { point: [20, -10] },
          { point: [20, 10] },
          { point: [10, 10] },
        ],
        180,
      ),
  },
  {
    id: "revolve-cone",
    label: "Revolve cone",
    description: "Triangle touching the Y axis, full 360° cone",
    create: () =>
      revolveExample(
        "doc-example-revolve-cone",
        "Revolve cone",
        [
          { point: [0, 0] },
          { point: [10, 0] },
          { point: [0, 10] },
        ],
        360,
      ),
  },
  {
    id: "revolve-stepped-shaft",
    label: "Revolve stepped shaft",
    description: "Multi-shoulder shaft with a flange, taper and rounded groove",
    create: () =>
      revolveFromSketch(
        "doc-example-revolve-shaft",
        "Revolve stepped shaft",
        steppedShaftSketch(),
      ),
  },
  {
    id: "d-boss",
    label: "D-shaped boss",
    description: "Partial cylinder with a flat radial cap; test partial offsets",
    create: () =>
      createDocument(dShapeSketch(), {
        id: "doc-example-d-boss",
        name: "D-shaped boss",
        height: 10,
        sketchId: "d-boss-sketch",
        extrudeId: "d-boss-extrude",
      }),
  },
  {
    id: "blind-hole",
    label: "Blind hole plate",
    description: "Plate with a plugged central hole; blind Ø16 × 5 with a planar cap",
    create: blindHoleDocument,
  },
  {
    id: "chamfered-plate",
    label: "Chamfered plate",
    description: "Top-edge chamfers; test an offset following slanted planar walls",
    create: () => {
      const base = boxDocument("doc-example-chamfered", "Chamfered plate");
      const extrude = base.features[1];
      if (extrude?.type !== "extrude") throw new Error("Missing extrude");
      const refs = boxRefs(extrude.id);
      return {
        ...base,
        features: [
          ...base.features,
          createChamferFeature([refs.topFront, refs.topBack], 2, {
            id: "chamfered-top",
            name: "Top chamfers",
          }),
        ],
      };
    },
  },
  {
    id: "top-edge-fillet-plate",
    label: "Top-edge fillet plate",
    description: "Top-edge rounds; offsetting the top face reports the undercut",
    create: () => {
      const base = boxDocument("doc-example-top-fillet", "Top-edge fillet plate");
      const extrude = base.features[1];
      if (extrude?.type !== "extrude") throw new Error("Missing extrude");
      const refs = boxRefs(extrude.id);
      return {
        ...base,
        features: [
          ...base.features,
          createFilletFeature([refs.topFront, refs.topBack], 2, {
            id: "top-fillet",
            name: "Top rounds",
          }),
        ],
      };
    },
  },
  {
    id: "shelled-tray",
    label: "Shelled tray",
    description: "Open-top box; test offsets on shell-generated inner walls",
    create: () => {
      const base = boxDocument("doc-example-shelled", "Shelled tray");
      const extrude = base.features[1];
      if (extrude?.type !== "extrude") throw new Error("Missing extrude");
      const refs = boxRefs(extrude.id);
      return {
        ...base,
        features: [
          ...base.features,
          createShellFeature([refs.top], 2, {
            id: "tray-shell",
            name: "Open tray",
          }),
        ],
      };
    },
  },
  {
    id: "rounded-plate",
    label: "Rounded plate",
    description: "Default plate with the four vertical fillets unsuppressed",
    create: () =>
      withToggledDefault(
        "Rounded plate",
        "doc-example-rounded",
        "Rounded plate",
      ),
  },
  {
    id: "beveled-plate",
    label: "Beveled plate",
    description: "Default plate with the four vertical chamfers unsuppressed",
    create: () =>
      withToggledDefault(
        "Beveled plate",
        "doc-example-beveled",
        "Beveled plate",
      ),
  },
];

export function createExampleDocumentById(id: string): Doc {
  const example =
    EXAMPLES.find((candidate) => candidate.id === id) ??
    EXAMPLES.find((candidate) => candidate.id === DEFAULT_EXAMPLE_ID)!;
  return example.create();
}
