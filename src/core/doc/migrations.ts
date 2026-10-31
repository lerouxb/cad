import type { Sketch, SketchConstraint, SketchCurve, SketchPoint } from "../sketch/types";
import { createDocument } from "./create";
import {
  CURRENT_SCHEMA_VERSION,
  isExtrudeFeature,
  isSketchFeature,
  type Doc,
  type ExtrudeOperation,
  type Feature,
  type PlaneRef,
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

  // An extrude must point at a sketch that exists in this document.
  for (const feature of features) {
    if (
      isExtrudeFeature(feature) &&
      !features.some(
        (candidate) =>
          isSketchFeature(candidate) && candidate.id === feature.sketchId,
      )
    ) {
      return null;
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
    return {
      id,
      type: "sketch",
      name,
      support: validateSupport(raw.support),
      sketch,
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
    };
  }

  return null;
}

function validateSupport(raw: unknown): PlaneRef {
  if (isRecord(raw) && raw.kind === "world" && isWorldPlane(raw.plane)) {
    return { kind: "world", plane: raw.plane };
  }
  // The spike only ever had XY sketches. Legacy/hand-written v1 documents
  // without a support default to it rather than losing the sketch.
  return { kind: "world", plane: "XY" };
}

function isWorldPlane(value: unknown): value is WorldPlane {
  return value === "XY" || value === "XZ" || value === "YZ";
}

function isOperation(value: unknown): value is ExtrudeOperation {
  return value === "new" || value === "join" || value === "cut";
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
