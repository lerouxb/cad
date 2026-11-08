import type { Sketch, SketchConstraint, SketchCurve, SketchPoint } from "../sketch/types";
import type { PlaneFrame } from "../types";
import type { EdgeRef, EdgeHint, TopoRef } from "../kernel/protocol";
import { createDocument } from "./create";
import {
  CURRENT_SCHEMA_VERSION,
  isDatumPlaneFeature,
  isExtrudeFeature,
  isRevolveFeature,
  isSketchFeature,
  type DatumPlaneDefinition,
  type Doc,
  type ExtrudeOperation,
  type FaceProjection,
  type Feature,
  type PlaneRef,
  type RevolveAxis,
  type WorldPlane,
} from "./types";

type UnknownRecord = Record<string, unknown>;

/**
 * Parse a persisted document. Returns null for anything we cannot safely open:
 * unknown future schemas, malformed features, or non-JSON shapes. Callers fall
 * back to a new document instead of crashing in the middle of a rebuild.
 */
export function migrateDoc(raw: unknown): Doc | null {
  if (!isRecord(raw)) return null;
  const version = raw.schemaVersion;

  if (version === CURRENT_SCHEMA_VERSION) return validateDoc(raw);
  // Shape-compatible upgrades:
  // v1 → v2 adds the optional `standalone` point flag;
  // v2 → v3 adds extrude `end` (defaults to blind) and `suppressed` (defaults off);
  // v3 → v4 adds optional dimension label placement (`along`/`distance`);
  // v4 → v5 adds face sketch supports (TopoRef + cached frame);
  // v5 → v6 adds cached face-boundary projections on sketch features;
  // v6 → v7 adds datum-plane features and datum sketch supports;
  // v7 → v8 adds the datum-plane `hidden` presentation flag;
  // v8 → v9 adds fillet features;
  // v9 → v10 adds chamfer features (older documents simply have none);
  // v10 → v11 adds shell features (older documents simply have none);
  // v11 → v12 adds offset-face features (older documents simply have none);
  // v12 → v13 adds optional radius/radialSign to face hints;
  // v13 → v14 adds revolve features (older documents simply have none);
  // v14 → v15 adds projected reference circles (older documents simply have
  // none; `references.circles` is optional).
  if (
    version === 1 ||
    version === 2 ||
    version === 3 ||
    version === 4 ||
    version === 5 ||
    version === 6 ||
    version === 7 ||
    version === 8 ||
    version === 9 ||
    version === 10 ||
    version === 11 ||
    version === 12 ||
    version === 13 ||
    version === 14
  ) {
    return validateDoc(raw);
  }
  if (version === 0 || (version === undefined && "sketch" in raw)) {
    return migrateLegacy(raw);
  }
  // A newer document must not be silently downgraded.
  return null;
}

function migrateLegacy(raw: UnknownRecord): Doc | null {
  const sketch = isSketch(raw.sketch) ? raw.sketch : null;
  if (!sketch) return null;
  const height =
    typeof raw.height === "number" && Number.isFinite(raw.height)
      ? raw.height
      : 12;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name : "Untitled";
  return createDocument(sketch, { name, height });
}

export function validateDoc(raw: unknown): Doc | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  const name = typeof raw.name === "string" ? raw.name : null;
  if (!id || !name || !Array.isArray(raw.features)) return null;

  const features: Feature[] = [];
  const ids = new Set<string>();
  for (const candidate of raw.features) {
    const feature = validateFeature(candidate);
    if (!feature || ids.has(feature.id)) return null;
    ids.add(feature.id);
    features.push(feature);
  }

  // References must point at features in this document, in history order.
  const indexById = new Map(
    features.map((feature, index) => [feature.id, index]),
  );
  const before = (dependencyId: string, featureId: string): boolean => {
    const dependencyIndex = indexById.get(dependencyId);
    return (
      dependencyIndex !== undefined &&
      dependencyIndex < (indexById.get(featureId) ?? -1)
    );
  };
  for (const feature of features) {
    if (isExtrudeFeature(feature) || isRevolveFeature(feature)) {
      const source = features.find(
        (candidate) => candidate.id === feature.sketchId,
      );
      if (!source || !isSketchFeature(source) || !before(source.id, feature.id)) {
        return null;
      }
    }
    if (isDatumPlaneFeature(feature)) {
      for (const base of datumDefinitionRefs(feature.definition)) {
        if (base.kind !== "datum") continue;
        const source = features.find(
          (candidate) => candidate.id === base.featureId,
        );
        if (
          !source ||
          !isDatumPlaneFeature(source) ||
          !before(source.id, feature.id)
        ) {
          return null;
        }
      }
    }
    if (isSketchFeature(feature) && feature.support.kind === "datum") {
      const support = feature.support;
      const source = features.find(
        (candidate) => candidate.id === support.featureId,
      );
      if (
        !source ||
        !isDatumPlaneFeature(source) ||
        !before(source.id, feature.id)
      ) {
        return null;
      }
    }
    if (feature.type === "fillet" || feature.type === "chamfer") {
      // An edge's face roles come from earlier features. A missing source is
      // a lost reference the worker reports; an out-of-order source is a
      // malformed history and must not open.
      for (const edge of feature.edges) {
        for (const face of edge.faces) {
          if (ids.has(face.source) && !before(face.source, feature.id)) {
            return null;
          }
        }
      }
    }
    if (feature.type === "shell" || feature.type === "offset") {
      // Shell open faces and offset faces come from earlier solid features
      // for the same reason.
      for (const face of feature.faces) {
        if (ids.has(face.source) && !before(face.source, feature.id)) {
          return null;
        }
      }
    }
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id,
    name,
    features,
  };
}

function validateFeature(raw: unknown): Feature | null {
  if (!isRecord(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : null;
  const name = typeof raw.name === "string" ? raw.name : null;
  if (!id || !name) return null;

  if (raw.type === "sketch") {
    const sketch = isSketch(raw.sketch) ? raw.sketch : null;
    if (!sketch) return null;
    const support = validateSupport(raw.support);
    if (!support) return null;
    const projections = validateProjections(raw.projections);
    if (projections === null) return null;
    return {
      id,
      type: "sketch",
      name,
      support,
      sketch,
      ...(projections.length > 0 ? { projections } : {}),
      ...(raw.suppressed === true ? { suppressed: true } : {}),
    };
  }

  if (raw.type === "extrude") {
    if (typeof raw.sketchId !== "string") return null;
    if (typeof raw.height !== "number" || !Number.isFinite(raw.height)) {
      return null;
    }
    return {
      id,
      type: "extrude",
      name,
      sketchId: raw.sketchId,
      regions: Array.isArray(raw.regions)
        ? raw.regions.filter((region): region is string => typeof region === "string")
        : [],
      height: raw.height,
      operation: isOperation(raw.operation) ? raw.operation : "new",
      symmetric: raw.symmetric === true,
      end: isEnd(raw.end) ? raw.end : "blind",
      ...(raw.suppressed === true ? { suppressed: true } : {}),
    };
  }

  if (raw.type === "datum") {
    const definition = validateDatumDefinition(raw.definition);
    const frame = validateFrame(raw.frame);
    if (!definition || !frame) return null;
    return {
      id,
      type: "datum",
      name,
      definition,
      frame,
      ...(raw.hidden === true ? { hidden: true } : {}),
      ...(raw.suppressed === true ? { suppressed: true } : {}),
    };
  }

  if (raw.type === "revolve") {
    if (typeof raw.sketchId !== "string") return null;
    if (!Array.isArray(raw.regions) || !raw.regions.every((id) => typeof id === "string")) {
      return null;
    }
    const axis = validateRevolveAxis(raw.axis);
    if (!axis) return null;
    if (
      typeof raw.angle !== "number" ||
      !Number.isFinite(raw.angle) ||
      raw.angle < 1 ||
      raw.angle > 360
    ) {
      return null;
    }
    if (raw.direction !== "ccw" && raw.direction !== "cw") return null;
    if (isOperation(raw.operation) === false) {
      return null;
    }
    return {
      id,
      type: "revolve",
      name,
      sketchId: raw.sketchId,
      regions: [...raw.regions],
      axis,
      angle: raw.angle,
      direction: raw.direction,
      operation: raw.operation,
      ...(raw.suppressed === true ? { suppressed: true } : {}),
    };
  }

  if (raw.type === "shell") {
    const thickness = raw.thickness;
    if (typeof thickness !== "number" || !Number.isFinite(thickness)) {
      return null;
    }
    const faces = validateTopoRefs(raw.faces);
    if (!faces || faces.length === 0) return null;
    return {
      id,
      type: "shell",
      name,
      faces,
      thickness,
      ...(raw.suppressed === true ? { suppressed: true } : {}),
    };
  }

  if (raw.type === "offset") {
    const distance = raw.distance;
    if (
      typeof distance !== "number" ||
      !Number.isFinite(distance) ||
      distance === 0
    ) {
      return null;
    }
    const faces = validateTopoRefs(raw.faces);
    if (!faces || faces.length === 0) return null;
    return {
      id,
      type: "offset",
      name,
      faces,
      distance,
      ...(raw.suppressed === true ? { suppressed: true } : {}),
    };
  }

  if (raw.type === "fillet" || raw.type === "chamfer") {
    const sizeKey = raw.type === "fillet" ? "radius" : "distance";
    const size = raw[sizeKey];
    if (typeof size !== "number" || !Number.isFinite(size)) return null;
    const edges = validateEdgeRefs(raw.edges);
    if (!edges) return null;
    const suppressed = raw.suppressed === true ? { suppressed: true } : {};
    if (raw.type === "fillet") {
      return { id, type: "fillet", name, edges, radius: size, ...suppressed };
    }
    return {
      id,
      type: "chamfer",
      name,
      edges,
      distance: size,
      ...suppressed,
    };
  }

  return null;
}

function validateRevolveAxis(raw: unknown): RevolveAxis | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "reference") {
    return raw.axis === "x" || raw.axis === "y"
      ? { kind: "reference", axis: raw.axis }
      : null;
  }
  if (raw.kind === "line" && typeof raw.curveId === "string") {
    return { kind: "line", curveId: raw.curveId };
  }
  return null;
}

function validateDatumDefinition(
  raw: unknown,
): DatumPlaneDefinition | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === "offset") {
    const base = validateSupport(raw.base);
    if (!base) return null;
    if (typeof raw.distance !== "number" || !Number.isFinite(raw.distance)) {
      return null;
    }
    return { kind: "offset", base, distance: raw.distance };
  }
  if (raw.kind === "midplane") {
    const a = validateSupport(raw.a);
    const b = validateSupport(raw.b);
    if (!a || !b) return null;
    return { kind: "midplane", a, b };
  }
  return null;
}

function datumDefinitionRefs(
  definition: DatumPlaneDefinition,
): PlaneRef[] {
  return definition.kind === "offset"
    ? [definition.base]
    : [definition.a, definition.b];
}

function validateProjections(raw: unknown): FaceProjection[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const projections: FaceProjection[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string") return null;
    if (item.kind !== "faceBoundary") return null;
    const source = validateTopoRef(item.source);
    if (!source) return null;
    if (typeof item.label !== "string") return null;
    if (
      !Array.isArray(item.loops) ||
      !item.loops.every(
        (loop) => Array.isArray(loop) && loop.every(isVec2),
      )
    ) {
      return null;
    }
    projections.push({
      id: item.id,
      kind: "faceBoundary",
      source,
      label: item.label,
      loops: item.loops as [number, number][][],
      ...(item.stale === true ? { stale: true } : {}),
    });
  }
  return projections;
}

function isVec2(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part))
  );
}

function validateSupport(raw: unknown): PlaneRef | null {
  if (raw === undefined) {
    // Legacy/hand-written v1 documents without a support default to XY.
    return { kind: "world", plane: "XY" };
  }
  if (isRecord(raw) && raw.kind === "world" && isWorldPlane(raw.plane)) {
    return { kind: "world", plane: raw.plane };
  }
  if (isRecord(raw) && raw.kind === "face") {
    const ref = validateTopoRef(raw.ref);
    const frame = validateFrame(raw.frame);
    if (ref && frame) return { kind: "face", ref, frame };
  }
  if (
    isRecord(raw) &&
    raw.kind === "datum" &&
    typeof raw.featureId === "string" &&
    typeof raw.label === "string"
  ) {
    const frame = validateFrame(raw.frame);
    if (frame) {
      return {
        kind: "datum",
        featureId: raw.featureId,
        label: raw.label,
        frame,
      };
    }
  }
  return null;
}

function validateFrame(raw: unknown): PlaneFrame | null {
  if (!isRecord(raw)) return null;
  if (
    !isVec3(raw.origin) ||
    !isVec3(raw.normal) ||
    !isVec3(raw.xAxis) ||
    !isVec3(raw.yAxis)
  ) {
    return null;
  }
  return {
    origin: raw.origin,
    normal: raw.normal,
    xAxis: raw.xAxis,
    yAxis: raw.yAxis,
  };
}

function validateTopoRef(raw: unknown): TopoRef | null {
  if (
    !isRecord(raw) ||
    typeof raw.source !== "string" ||
    raw.kind !== "face" ||
    typeof raw.role !== "string" ||
    !isRecord(raw.hint)
  ) {
    return null;
  }
  const hint = raw.hint;
  return {
    source: raw.source,
    kind: "face",
    role: raw.role,
    hint: {
      entityType: "face",
      ...(typeof hint.surfaceType === "string"
        ? { surfaceType: hint.surfaceType }
        : {}),
      ...(isVec3(hint.normal) ? { normal: hint.normal } : {}),
      ...(isVec3(hint.centroid) ? { centroid: hint.centroid } : {}),
      ...(typeof hint.area === "number" && Number.isFinite(hint.area)
        ? { area: hint.area }
        : {}),
      ...(typeof hint.radius === "number" &&
      Number.isFinite(hint.radius) &&
      hint.radius > 0
        ? { radius: hint.radius }
        : {}),
      ...(hint.radialSign === 1 || hint.radialSign === -1
        ? { radialSign: hint.radialSign }
        : {}),
    },
  };
}

function validateTopoRefs(raw: unknown): TopoRef[] | null {
  if (!Array.isArray(raw)) return null;
  const refs: TopoRef[] = [];
  for (const candidate of raw) {
    const ref = validateTopoRef(candidate);
    if (!ref) return null;
    refs.push(ref);
  }
  return refs;
}

function validateEdgeRefs(raw: unknown): EdgeRef[] | null {
  if (!Array.isArray(raw)) return null;
  const edges: EdgeRef[] = [];
  for (const candidate of raw) {
    const edge = validateEdgeRef(candidate);
    if (!edge) return null;
    edges.push(edge);
  }
  return edges;
}

function validateEdgeRef(raw: unknown): EdgeRef | null {
  if (
    !isRecord(raw) ||
    raw.kind !== "edge" ||
    !Array.isArray(raw.faces) ||
    raw.faces.length !== 2
  ) {
    return null;
  }
  const a = validateTopoRef(raw.faces[0]);
  const b = validateTopoRef(raw.faces[1]);
  if (!a || !b) return null;
  const hint = isRecord(raw.hint) ? raw.hint : {};
  const edgeHint: EdgeHint = {
    entityType: "edge",
    ...(typeof hint.length === "number" && Number.isFinite(hint.length)
      ? { length: hint.length }
      : {}),
    ...(isVec3(hint.midpoint) ? { midpoint: hint.midpoint } : {}),
  };
  return { kind: "edge", faces: [a, b], hint: edgeHint };
}

function isVec3(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((part) => typeof part === "number" && Number.isFinite(part))
  );
}

function isWorldPlane(value: unknown): value is WorldPlane {
  return value === "XY" || value === "XZ" || value === "YZ";
}

function isOperation(value: unknown): value is ExtrudeOperation {
  return (
    value === "new" ||
    value === "join" ||
    value === "cut" ||
    value === "intersect"
  );
}

function isEnd(value: unknown): value is "blind" | "throughAll" {
  return value === "blind" || value === "throughAll";
}

function isSketch(raw: unknown): raw is Sketch {
  if (!isRecord(raw)) return false;
  if (!Array.isArray(raw.points)) return false;
  if (!Array.isArray(raw.curves)) return false;
  if (!Array.isArray(raw.constraints)) return false;
  return (
    raw.points.every(isSketchPoint) &&
    raw.curves.every(isSketchCurve) &&
    raw.constraints.every(isConstraintLike) &&
    (raw.references === undefined || isRecord(raw.references))
  );
}

function isSketchPoint(raw: unknown): raw is SketchPoint {
  return (
    isRecord(raw) &&
    typeof raw.id === "string" &&
    typeof raw.x === "number" &&
    Number.isFinite(raw.x) &&
    typeof raw.y === "number" &&
    Number.isFinite(raw.y)
  );
}

function isSketchCurve(raw: unknown): raw is SketchCurve {
  if (!isRecord(raw) || typeof raw.id !== "string") return false;
  if (raw.type === "line") {
    return typeof raw.a === "string" && typeof raw.b === "string";
  }
  if (raw.type === "circle") {
    return (
      typeof raw.center === "string" &&
      typeof raw.radius === "number" &&
      Number.isFinite(raw.radius)
    );
  }
  if (raw.type === "arc") {
    return (
      typeof raw.center === "string" &&
      typeof raw.start === "string" &&
      typeof raw.end === "string"
    );
  }
  return false;
}

function isConstraintLike(raw: unknown): raw is SketchConstraint {
  return isRecord(raw) && typeof raw.id === "string" && typeof raw.type === "string";
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}
