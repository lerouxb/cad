import {
  OcctWasmAdapter,
  addHoles,
  adjacentFaces,
  assignRoles,
  cut,
  faceAxis,
  applyMatrix,
  captureHint,
  castShape,
  chamferWithEvolution,
  circle,
  classifyPointOnFace,
  cylinder,
  clearMeshCache,
  clone,
  createRef,
  curveLength,
  curvePointAt,
  cutWithEvolution,
  exportSTEP,
  exportSTL,
  extrude,
  face,
  faceCenter,
  faceGeomType,
  facesOfEdge,
  filletWithEvolution,
  fromBREP,
  fuse,
  fuseAll,
  fuseWithEvolution,
  intersectWithEvolution,
  getBounds,
  getCurveType,
  getEdges,
  getFaces,
  getHashCode,
  getShells,
  getSolids,
  getVertices,
  innerWires,
  isEmpty,
  isValid,
  isShell,
  isSolid,
  line,
  loft,
  measureDistance,
  measureLength,
  measureLinearProps,
  measureSurfaceProps,
  measureVolume,
  measureVolumeProps,
  normalAt,
  outerWire,
  registerKernel,
  projectPointOnFace,
  revolve,
  resolveRef,
  shape,
  shellWithEvolution,
  sharedEdges,
  solidFromShell,
  threePointArc,
  toBREP,
  toBufferGeometryData,
  translate,
  updateRoles,
  unwrap,
  verticesOfEdge,
  vertexPosition,
  wireLoop,
  withScope,
  type ClosedWire,
  type Edge,
  type EvolutionResult,
  type Face,
  type Matrix4x4,
  type PlanarWire,
  type RoleTable,
  type Shape3D,
  type Solid,
  type ValidSolid,
} from "brepjs";
import { OcctKernel } from "occt-wasm";
import type { PlaneFrame, Vec3 } from "../core/types";
import type {
  BodyDiff,
  BodyMesh,
  DiffMesh,
  EdgeRef,
  ExtrudeParams,
  FeatureBuildStatus,
  KernelEdgeBlendFeature,
  KernelFeature,
  KernelOffsetFaceFeature,
  KernelShellFeature,
  KernelRequest,
  MeasureResult,
  MeasureTarget,
  ProfileRegion,
  RevolveParams,
  KernelResponse,
  ProfileLoop,
  TopoRef,
} from "../core/kernel/protocol";
import { faceRefKey } from "../core/kernel/protocol";
import {
  offsetBlindCapMessage,
  offsetSealedCylinderMessage,
  offsetCurvedNeighbourMessage,
  offsetHoleWallMessage,
  offsetHorizontalCylinderMessage,
  offsetMixedSlantedCurvedMessage,
  offsetMultipleCylinderSelectionMessage,
  offsetNonConvexFaceMessage,
  offsetNonParallelSelectionMessage,
  offsetPartialCapMessage,
  offsetSelectedSurfaceMessage,
  offsetTangentFilletMessage,
} from "../core/features/offsetDiagnostics";

// This file only runs inside a dedicated worker.
declare const self: DedicatedWorkerGlobalScope;

let kernelReady: Promise<void> | null = null;
/** Retained for the isolated same-domain merge below. */
let kernelAdapter: OcctWasmAdapter | null = null;
let rawKernel: OcctKernel | null = null;

function ensureKernel(): Promise<void> {
  kernelReady ??= (async () => {
    const kernel = await OcctKernel.init();
    const adapter = OcctWasmAdapter.fromKernel(kernel);
    registerKernel("occt-wasm", adapter);
    kernelAdapter = adapter;
    rawKernel = kernel;
  })();
  return kernelReady;
}

self.onmessage = (event: MessageEvent<KernelRequest>) => {
  void handle(event.data);
};

async function handle(request: KernelRequest): Promise<void> {
  try {
    await ensureKernel();

    if (request.type === "init") {
      reply({ type: "ready", kernel: "occt-wasm" });
      return;
    }

    if (request.type === "faceBoundary") {
      const entry = solidCache.get(request.cacheKey);
      if (!entry) {
        reply({
          type: "faceBoundary",
          requestId: request.requestId,
          ok: false,
          message: "The source prefix solid is no longer cached.",
        });
        return;
      }
      const boundary = faceBoundary(entry.solid, entry.roles, request.ref);
      if (!boundary || "broken" in boundary) {
        const reason = boundary?.broken ?? "not-found";
        reply({
          type: "faceBoundary",
          requestId: request.requestId,
          ok: false,
          message:
            reason === "deleted"
              ? "The referenced face was deleted from the source body."
              : reason === "ambiguous"
                ? "The referenced face is ambiguous on the source body."
                : "The referenced face was not found on the source body.",
        });
        return;
      }
      reply({
        type: "faceBoundary",
        requestId: request.requestId,
        ok: true,
        ...boundary,
      });
      return;
    }

    if (request.type === "edgeBoundary") {
      const entry = solidCache.get(request.cacheKey);
      if (!entry) {
        reply({
          type: "edgeBoundary",
          requestId: request.requestId,
          ok: false,
          message: "The source prefix solid is no longer cached.",
        });
        return;
      }
      const boundary = edgeBoundary(entry.solid, entry.roles, request.ref);
      if (!boundary || "broken" in boundary) {
        reply({
          type: "edgeBoundary",
          requestId: request.requestId,
          ok: false,
          message:
            boundary?.broken ??
            "The referenced edge was not found on the source body.",
        });
        return;
      }
      reply({
        type: "edgeBoundary",
        requestId: request.requestId,
        ok: true,
        ...boundary,
      });
      return;
    }

    if (request.type === "measure") {
      const entry = solidCache.get(request.cacheKey);
      if (!entry) {
        reply({
          type: "measured",
          requestId: request.requestId,
          ok: false,
          message:
            "The current body is not ready to measure. Rebuild it and try again.",
        });
        return;
      }
      try {
        reply({
          type: "measured",
          requestId: request.requestId,
          ok: true,
          result: measureTargets(entry.solid, entry.roles, request.targets),
        });
      } catch (error) {
        reply({
          type: "measured",
          requestId: request.requestId,
          ok: false,
          message: errorMessage(error),
        });
      }
      return;
    }

    if (request.type === "export") {
      const entry = solidCache.get(request.cacheKey);
      if (!entry) {
        reply({
          type: "exportError",
          requestId: request.requestId,
          message:
            "The current body is not ready to export. Rebuild it and try again.",
        });
        return;
      }
      try {
        // The export meshes the solid itself; drop cached tessellations whose
        // buffers may have been transferred to the main thread.
        if (request.format === "stl") clearMeshCache();
        const blob = unwrap(
          request.format === "stl"
            ? exportSTL(entry.solid, { binary: true, tolerance: 0.05 })
            : exportSTEP(entry.solid),
        );
        const data = await blob.arrayBuffer();
        reply(
          {
            type: "exported",
            requestId: request.requestId,
            format: request.format,
            data,
          },
          [data],
        );
      } catch (error) {
        reply({
          type: "exportError",
          requestId: request.requestId,
          message: errorMessage(error),
        });
      }
      return;
    }

    const started = performance.now();
    const built = buildFeatures(request.features);
    if (!built.mesh) {
      reply({
        type: "error",
        gen: request.gen,
        message: "No solid feature could be built.",
        features: built.features,
      });
      return;
    }
    const mesh = built.mesh;
    mesh.stats.buildMs = performance.now() - started;
    const transfer: ArrayBuffer[] = [
      mesh.positions.buffer as ArrayBuffer,
      mesh.normals.buffer as ArrayBuffer,
      mesh.indices.buffer as ArrayBuffer,
      mesh.edgePositions.buffer as ArrayBuffer,
    ];
    for (const part of [mesh.diff?.added, mesh.diff?.removed]) {
      if (!part) continue;
      transfer.push(
        part.positions.buffer as ArrayBuffer,
        part.normals.buffer as ArrayBuffer,
        part.indices.buffer as ArrayBuffer,
      );
    }
    reply(
      { type: "result", gen: request.gen, mesh, features: built.features },
      transfer,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const gen = request.type === "rebuild" ? request.gen : 0;
    reply({ type: "error", gen, message });
  }
}

function reply(message: KernelResponse, transfer?: Transferable[]): void {
  self.postMessage(message, { transfer: transfer ?? [] });
}

/** Measure the body, one face/edge, or the distance/angle between two. */
function measureTargets(
  solid: Solid,
  roles: RoleTable,
  targets: readonly MeasureTarget[],
): MeasureResult {
  type Face3D = Parameters<typeof captureHint>[0];
  const faces: Face3D[] = [];
  const edges: Edge[] = [];
  try {
    for (const target of targets.slice(0, 2)) {
      if (target.kind === "face") {
        const resolved = resolveFaceOnSolid(solid, roles, target.ref);
        if ("broken" in resolved) {
          throw new Error(
            "The selected face no longer exists on the current body.",
          );
        }
        faces.push(resolved.face as Face3D);
      } else {
        const resolved = resolveEdgeOnSolid(solid, roles, target.ref);
        if ("broken" in resolved) throw new Error(resolved.broken);
        edges.push(resolved.edge);
      }
    }

    if (faces.length === 0 && edges.length === 0) {
      const volume = unwrap(measureVolumeProps(solid));
      const surface = unwrap(measureSurfaceProps(solid));
      return {
        volume: volume.volume,
        area: surface.area,
        centerOfMass: volume.centerOfMass,
      };
    }

    if (faces.length === 0 && edges.length === 1) {
      const edge = edges[0]!;
      const linear = unwrap(measureLinearProps(edge));
      const result: MeasureResult = {
        length: linear.length,
        centerOfMass: linear.centerOfMass,
      };
      if (getCurveType(edge) === "CIRCLE") {
        const radius = circumradius(
          curvePointAt(edge, 0),
          curvePointAt(edge, 1 / 3),
          curvePointAt(edge, 2 / 3),
        );
        if (radius !== null) result.radius = radius;
      }
      return result;
    }

    if (edges.length === 0 && faces.length === 1) {
      const face = faces[0]! as unknown as Face;
      const surface = unwrap(measureSurfaceProps(face));
      let perimeter = 0;
      const outer = outerWire(face);
      if (outer) perimeter += unwrap(measureLength(outer));
      for (const inner of innerWires(face)) {
        if (inner) perimeter += unwrap(measureLength(inner));
      }
      return {
        area: surface.area,
        perimeter,
        centerOfMass: surface.centerOfMass,
      };
    }

    // Two targets: exact minimum distance, plus an angle when it is meaningful.
    const result: MeasureResult = {};
    try {
      result.distance = unwrap(measureDistance(faces[0] ?? edges[0]!, faces[1] ?? edges[1]!));
    } catch {
      // Distance is undefined for exotic pairs; the shape metrics still show.
    }
    if (faces.length === 2) {
      const a = captureHint(faces[0]! as unknown as Face).normal;
      const b = captureHint(faces[1]! as unknown as Face).normal;
      if (a && b) result.angle = angleBetween(a, b);
    }
    if (edges.length === 2) {
      if (
        getCurveType(edges[0]!) === "LINE" &&
        getCurveType(edges[1]!) === "LINE"
      ) {
        result.angle = angleBetween(
          directionOf(edges[0]!),
          directionOf(edges[1]!),
        );
      }
    }
    return result;
  } finally {
    // `sharedEdges` returns caller-owned handles; faces are borrowed.
    for (const edge of edges) edge.delete();
  }
}

function directionOf(edge: Edge): Vec3 {
  const start = curvePointAt(edge, 0);
  const end = curvePointAt(edge, 1);
  return [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
}

function angleBetween(a: Vec3, b: Vec3): number {
  const lengths = Math.hypot(...a) * Math.hypot(...b);
  if (lengths < 1e-12) return 0;
  const dot =
    Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / lengths;
  return (Math.acos(Math.min(1, Math.max(0, dot))) * 180) / Math.PI;
}

function circumradius(a: Vec3, b: Vec3, c: Vec3): number | null {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
  const cross = [
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ];
  const area = Math.hypot(...cross) / 2;
  if (area < 1e-9) return null;
  return (ab * bc * ca) / (4 * area);
}

function buildFeatures(features: KernelFeature[]): {
  mesh: BodyMesh | null;
  features: FeatureBuildStatus[];
} {
  const statuses: FeatureBuildStatus[] = [];
  let diff: BodyDiff | null = null;
  const protectedKeys = new Set<string>();
  const pending: Array<PrefixEntry & { key: string }> = [];
  let base: Solid | null = null;
  let baseKey: string | null = null;
  let baseRoles: RoleTable = new Map();
  let cacheInvalid = false;

  for (const feature of features) {
    // Preview diffs are request-time state, not solid state. Never satisfy a
    // preview from the prefix cache: the cached solid has no diff meshes.
    const cached = feature.preview ? undefined : solidCache.get(feature.cacheKey);
    if (cached) {
      base = cached.solid;
      baseRoles = cached.roles;
      baseKey = feature.cacheKey;
      protectedKeys.add(feature.cacheKey);
      statuses.push({
        featureId: feature.featureId,
        status: "ok",
        cached: true,
      });
      continue;
    }

    if (
      feature.kind === "fillet" ||
      feature.kind === "chamfer" ||
      feature.kind === "shell" ||
      feature.kind === "offsetFace"
    ) {
      if (!base) {
        cacheInvalid = true;
        statuses.push({
          featureId: feature.featureId,
          status: "error",
          cached: false,
          message: `Nothing exists to ${feature.kind}.`,
        });
        continue;
      }
      try {
        const result: { solid: Solid; roles: RoleTable } =
          feature.kind === "shell"
            ? buildShellFeature(feature, base, baseRoles)
            : feature.kind === "offsetFace"
              ? buildOffsetFaceFeature(feature, base, baseRoles)
              : buildEdgeBlendFeature(feature, base, baseRoles);
        if (feature.kind === "offsetFace" && feature.preview) {
          diff = buildOffsetDiff(base, result.solid);
        }
        base = result.solid;
        baseRoles = result.roles;
        baseKey = feature.cacheKey;
        protectedKeys.add(feature.cacheKey);
        if (!feature.preview) {
          pending.push({
            key: feature.cacheKey,
            solid: result.solid,
            roles: result.roles,
          });
        }
        statuses.push({
          featureId: feature.featureId,
          status: "ok",
          cached: false,
        });
      } catch (error) {
        cacheInvalid = true;
        statuses.push({
          featureId: feature.featureId,
          status: "error",
          cached: false,
          message: errorMessage(error),
        });
      }
      continue;
    }

    let tool: Solid;
    try {
      if (feature.kind === "revolve") {
        tool = buildRevolveSolid(feature.params);
      } else {
        if (feature.params.end === "throughAll" && feature.operation !== "cut") {
          throw new Error("Through-all is only available for a cut extrude.");
        }
        tool = buildSolid(feature.params, base);
      }
    } catch (error) {
      cacheInvalid = true;
      statuses.push({
        featureId: feature.featureId,
        status: "error",
        cached: false,
        message: errorMessage(error),
      });
      continue;
    }

    try {
      if (!base) {
        if (feature.operation === "cut" || feature.operation === "intersect") {
          tool.delete();
          cacheInvalid = true;
          statuses.push({
            featureId: feature.featureId,
            status: "error",
            cached: false,
            message:
              feature.operation === "cut"
                ? "Nothing exists to cut."
                : "Nothing exists to intersect.",
          });
          continue;
        }
        if (feature.operation === "join") {
          // No silent fallback: a join with nothing to join is an error the
          // user sees, not an implicit first body.
          tool.delete();
          cacheInvalid = true;
          statuses.push({
            featureId: feature.featureId,
            status: "error",
            cached: false,
            message: "Nothing exists to join.",
          });
          continue;
        }
        base = tool;
        baseRoles = new Map([
          [
            feature.featureId,
            assignRoles(tool, feature.kind === "revolve" ? "revolve" : "extrude"),
          ],
        ]);
        baseKey = feature.cacheKey;
        protectedKeys.add(feature.cacheKey);
        if (!feature.preview) {
          pending.push({
            key: feature.cacheKey,
            solid: tool,
            roles: baseRoles,
          });
        }
        statuses.push({
          featureId: feature.featureId,
          status: "ok",
          cached: false,
        });
        continue;
      }

      if (feature.operation === "new") {
        tool.delete();
        cacheInvalid = true;
        statuses.push({
          featureId: feature.featureId,
          status: "error",
          cached: false,
          message: "Only the first solid feature can create a new body.",
        });
        continue;
      }

      const toolRoles = new Map([
        [
          feature.featureId,
          assignRoles(tool, feature.kind === "revolve" ? "revolve" : "extrude"),
        ],
      ]);
      const result = unwrap(
        feature.operation === "cut"
          ? cutWithEvolution(base, tool)
          : feature.operation === "intersect"
            ? intersectWithEvolution(base, tool)
            : fuseWithEvolution(base, tool),
      );
      // Advance every origin's role table through the boolean. This is what
      // keeps a face's role stable when an upstream join/cut re-hashes it.
      let roles: RoleTable = new Map([...baseRoles, ...toolRoles]);
      for (const origin of [...roles.keys()]) {
        roles = updateRoles(roles, origin, result.evolution);
      }
      // A boolean of two solids is a solid; brepjs's widest overload returns
      // Shape3D, so narrow it here before caching.
      const resultSolid = result.shape as Solid;
      if (feature.operation === "cut") {
        const before = unwrap(measureVolume(base));
        const after = isEmpty(resultSolid)
          ? 0
          : unwrap(measureVolume(resultSolid));
        if (isEmpty(resultSolid) || after >= before - 1e-7) {
          throw new Error("The cutter does not intersect the body.");
        }
      }
      if (feature.operation === "intersect") {
        if (
          isEmpty(resultSolid) ||
          getSolids(resultSolid).length === 0 ||
          unwrap(measureVolume(resultSolid)) <= 1e-9
        ) {
          throw new Error("The intersection is empty.");
        }
      }
      if (feature.preview) {
        diff = buildBooleanDiff(base, tool, resultSolid, feature.operation);
      }
      // OCCT does not report every boolean-made face as "modified": a tool wall
      // that keeps only part of its length (or a cut's new hole wall) can arrive
      // with no role at all. Name those faces against the tool they lie on, so
      // selections and the feature highlight still see the geometry this
      // operation created.
      roles = adoptUntrackedFaces(
        resultSolid,
        tool,
        feature.featureId,
        toolRoles,
        roles,
      );
      tool.delete();
      base = resultSolid;
      baseRoles = roles;
      baseKey = feature.cacheKey;
      protectedKeys.add(feature.cacheKey);
      if (!feature.preview) {
        pending.push({
          key: feature.cacheKey,
          solid: resultSolid,
          roles,
        });
      }
      statuses.push({
        featureId: feature.featureId,
        status: "ok",
        cached: false,
      });
    } catch (error) {
      tool.delete();
      cacheInvalid = true;
      statuses.push({
        featureId: feature.featureId,
        status: "error",
        cached: false,
        message: errorMessage(error),
      });
      // A failed feature is skipped; later features use the last good base.
    }
  }

  if (baseKey) protectedKeys.add(baseKey);
  const mesh = base ? meshSolid(base, baseRoles) : null;

  if (cacheInvalid) {
    // A transient boolean failure must not leave downstream prefix solids that
    // were built as if the failed feature had been skipped. Dispose everything
    // and force a clean retry next time.
    for (const entry of pending) entry.solid.delete();
    solidCache.clear();
  } else {
    for (const entry of pending) {
      solidCache.set(
        entry.key,
        { solid: entry.solid, roles: entry.roles },
        protectedKeys,
      );
    }
    solidCache.trim(protectedKeys);
  }

  if (mesh && diff) mesh.diff = diff;
  return { mesh, features: statuses };
}

/** Build one tool solid and return an independently owned clone. */
/**
 * Name boolean-result faces that the kernel's history did not track.
 *
 * `updateRoles` only follows hashes the kernel reports as modified. Generated
 * faces (a cut's hole wall, a joined cylinder that keeps only its exposed
 * length, the bottom disk of a pin filling a hole) are absent from that record,
 * so they would otherwise be anonymous: no stable `TopoRef`, no edge/face
 * highlight for the feature that created them. Match each anonymous result face
 * to the tool face it lies on and adopt that tool face's role.
 */
function adoptUntrackedFaces(
  result: Solid,
  tool: Solid,
  featureId: string,
  toolRoles: RoleTable,
  roles: RoleTable,
): RoleTable {
  const claimed = new Set<number>();
  for (const originRoles of roles.values()) {
    for (const hashes of originRoles.values()) {
      for (const hash of hashes) claimed.add(hash);
    }
  }
  const unclaimed = getFaces(result).filter(
    (face) => !claimed.has(getHashCode(face)),
  );
  if (unclaimed.length === 0) return roles;

  const toolRolesForFeature = toolRoles.get(featureId);
  if (!toolRolesForFeature) return roles;
  const roleByHash = new Map<number, string>();
  for (const [role, hashes] of toolRolesForFeature) {
    for (const hash of hashes) roleByHash.set(hash, role);
  }
  const toolFaces: Array<{
    face: Parameters<typeof captureHint>[0];
    role: string;
    hint: ReturnType<typeof captureHint>;
  }> = [];
  for (const face of getFaces(tool)) {
    const role = roleByHash.get(getHashCode(face));
    if (!role) continue;
    const typed = face as Parameters<typeof captureHint>[0];
    toolFaces.push({ face: typed, role, hint: captureHint(typed) });
  }
  if (toolFaces.length === 0) return roles;

  const adopted: Array<[string, number]> = [];
  for (const face of unclaimed) {
    const typed = face as Parameters<typeof captureHint>[0];
    const points = sampleFacePoints(typed);
    if (points.length === 0) continue;
    const resultHint = captureHint(typed);
    let best: { role: string; hits: number; score: number } | null = null;
    for (const candidate of toolFaces) {
      let hits = 0;
      let distance = 0;
      for (const point of points) {
        try {
          const projection = projectPointOnFace(candidate.face, point);
          if (!projection.ok || projection.value.distance > 0.05) continue;
          const where = classifyPointOnFace(candidate.face, point, 0.05);
          if (where === "out") continue;
          hits += 1;
          distance += projection.value.distance;
        } catch {
          // An analytic projection can fail on exotic surfaces; skip the point.
        }
      }
      if (hits === 0) continue;
      const sameNormal =
        resultHint.normal && candidate.hint.normal
          ? resultHint.normal[0] * candidate.hint.normal[0] +
              resultHint.normal[1] * candidate.hint.normal[1] +
              resultHint.normal[2] * candidate.hint.normal[2] >
            0.9
          : false;
      const score =
        hits +
        (sameNormal ? 1 : 0) -
        distance / Math.max(points.length, 1) / 10;
      if (!best || score > best.score) {
        best = { role: candidate.role, hits, score };
      }
    }
    if (best) adopted.push([best.role, getHashCode(face)]);
  }
  if (adopted.length === 0) return roles;

  const next = new Map(roles);
  const featureRoles = new Map(next.get(featureId) ?? []);
  for (const [role, hash] of adopted) {
    const hashes = featureRoles.get(role);
    if (!hashes) featureRoles.set(role, [hash]);
    else if (!hashes.includes(hash)) featureRoles.set(role, [...hashes, hash]);
  }
  next.set(featureId, featureRoles);
  return next;
}

/** Surface points on a face: its centre plus edge samples, for tool matching. */
function sampleFacePoints(
  face: Parameters<typeof captureHint>[0],
): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  try {
    const center = faceCenter(face);
    points.push([center[0], center[1], center[2]]);
  } catch {
    // Non-analytic faces may not have a centre; edge samples still work.
  }
  for (const edge of getEdges(face).slice(0, 8)) {
    for (const t of [0.25, 0.5, 0.75]) {
      const point = curvePointAt(edge, t);
      points.push([point[0], point[1], point[2]]);
    }
  }
  return points;
}

/** True when a resolved face still matches the hint it was recorded with. */
function hintAgrees(
  ref: TopoRef,
  hint: {
    normal?: readonly [number, number, number];
    centroid?: readonly [number, number, number];
    area?: number;
  },
): boolean {
  const wantedNormal = ref.hint.normal;
  if (!wantedNormal || !hint.normal) return true;
  const dot =
    hint.normal[0] * wantedNormal[0] +
    hint.normal[1] * wantedNormal[1] +
    hint.normal[2] * wantedNormal[2];
  return dot >= 0.95;
}

/** Best geometric face match for a support hint; tolerant of centroid drift. */
function matchFaceByHint(
  solid: Solid,
  ref: TopoRef,
): Parameters<typeof captureHint>[0] | null {
  const wantedNormal = ref.hint.normal;
  if (!wantedNormal) return null;
  const wantedArea = ref.hint.area;
  let best: { face: Parameters<typeof captureHint>[0]; score: number } | null =
    null;
  for (const face of getFaces(solid)) {
    const hint = captureHint(face as Parameters<typeof captureHint>[0]);
    if (!hint.normal) continue;
    const normalDot =
      hint.normal[0] * wantedNormal[0] +
      hint.normal[1] * wantedNormal[1] +
      hint.normal[2] * wantedNormal[2];
    if (normalDot < 0.95) continue;
    const areaRatio =
      wantedArea !== undefined && hint.area !== undefined && hint.area > 0
        ? Math.min(hint.area, wantedArea) / Math.max(hint.area, wantedArea)
        : 1;
    if (areaRatio < 0.5) continue;
    const centroid = hint.centroid;
    const wantedCentroid = ref.hint.centroid;
    const distance =
      centroid && wantedCentroid
        ? Math.hypot(
            centroid[0] - wantedCentroid[0],
            centroid[1] - wantedCentroid[1],
            centroid[2] - wantedCentroid[2],
          )
        : 0;
    const score = normalDot + areaRatio - distance / 1000;
    if (!best || score > best.score) {
      best = { face: face as Parameters<typeof captureHint>[0], score };
    }
  }
  return best?.face ?? null;
}

/** Sample a face's outer and inner wires into world-space boundary loops. */
/** Sample an edge as a world-space polyline for a sketch projection. */
function edgeBoundary(
  solid: Solid,
  roles: RoleTable,
  ref: EdgeRef,
):
  | { points: [number, number, number][]; closed: boolean }
  | { broken: string } {
  try {
    const resolved = resolveEdgeOnSolid(solid, roles, ref);
    if ("broken" in resolved) return { broken: resolved.broken };
    const edge = resolved.edge;
    if (getCurveType(edge) === "LINE") {
      const start = curvePointAt(edge, 0);
      const end = curvePointAt(edge, 1);
      return {
        points: [
          [start[0], start[1], start[2]],
          [end[0], end[1], end[2]],
        ],
        closed: false,
      };
    }
    const length = curveLength(edge);
    const steps = Math.max(8, Math.min(64, Math.ceil(length / 1.5)));
    const points: [number, number, number][] = [];
    for (let index = 0; index <= steps; index += 1) {
      const point = curvePointAt(edge, index / steps);
      points.push([point[0], point[1], point[2]]);
    }
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const closed =
      Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]) <
      1e-6;
    if (closed) points.pop();
    return { points, closed };
  } catch {
    return {
      broken: "The selected edge no longer exists on the source body.",
    };
  }
}

function faceBoundary(
  solid: Solid,
  roles: RoleTable,
  ref: TopoRef,
):
  | {
      normal: [number, number, number];
      centroid: [number, number, number];
      loops: [number, number, number][][];
      confidence: "exact" | "geometric-fallback";
    }
  | { broken: "deleted" | "ambiguous" | "not-found" }
  | null {
  try {
    const resolved = resolveRef(
      {
        origin: ref.source,
        role: ref.role,
        hint: {
          entityType: "face",
          ...(ref.hint.normal ? { normal: ref.hint.normal } : {}),
          ...(ref.hint.centroid ? { centroid: ref.hint.centroid } : {}),
          ...(ref.hint.area !== undefined ? { area: ref.hint.area } : {}),
        },
      },
      roles,
      solid,
    );
    let face: Parameters<typeof captureHint>[0] | null =
      "face" in resolved ? resolved.face : null;
    let confidence: "exact" | "geometric-fallback" = "exact";
    if (face) {
      // A positional role can survive an upstream edit while now pointing at a
      // completely different face (splits, reordered iteration). Trust it only
      // when it still agrees with the geometric hint.
      const exactHint = captureHint(face);
      if (
        !exactHint.normal ||
        !hintAgrees(ref, {
          normal: exactHint.normal,
          centroid: exactHint.centroid,
          area: exactHint.area,
        })
      ) {
        face = null;
      }
    }
    if (!face) {
      // brepjs only falls back when the role is untracked. A role whose hashes
      // are stale (common after an upstream edit) should still use the geometric
      // hint, otherwise every positional role becomes a false lost support.
      const fallback = matchFaceByHint(solid, ref);
      if (!fallback) {
        return { broken: "face" in resolved ? "ambiguous" : resolved.reason };
      }
      face = fallback;
      confidence = "geometric-fallback";
    }
    const hint = captureHint(face);
    if (!hint.normal || !hint.centroid) return null;
    const loops: [number, number, number][][] = [];
    for (const wire of [outerWire(face), ...innerWires(face)]) {
      const segments = getEdges(wire).map((edge): [number, number, number][] => {
        // Straight edges only need their endpoints: sampling them would turn a
        // rectangle into hundreds of collinear reference points. Curves keep a
        // deterministic sample so dashes/constraints follow the arc.
        if (getCurveType(edge) === "LINE") {
          const start = curvePointAt(edge, 0);
          const end = curvePointAt(edge, 1);
          return [
            [start[0], start[1], start[2]],
            [end[0], end[1], end[2]],
          ];
        }
        const length = curveLength(edge);
        const steps = Math.max(2, Math.min(64, Math.ceil(length / 1.5)));
        const points: [number, number, number][] = [];
        for (let index = 0; index <= steps; index++) {
          const point = curvePointAt(edge, index / steps);
          points.push([point[0], point[1], point[2]]);
        }
        return points;
      });
      if (segments.length === 0) continue;

      // Edge order and orientation are not guaranteed by the kernel. Chain the
      // segments by matching endpoints so a side face is a real rectangle, not
      // four points in arbitrary order.
      const close = (
        a: [number, number, number],
        b: [number, number, number],
      ): boolean =>
        Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;
      const loop = [...segments.shift()!];
      while (segments.length > 0) {
        const tail = loop[loop.length - 1]!;
        const index = segments.findIndex(
          (segment) =>
            close(segment[0]!, tail) ||
            close(segment[segment.length - 1]!, tail),
        );
        if (index < 0) break;
        const [segment] = segments.splice(index, 1);
        if (!segment) continue;
        const ordered = close(segment[0]!, tail)
          ? segment
          : [...segment].reverse();
        for (let pointIndex = 1; pointIndex < ordered.length; pointIndex++) {
          const point = ordered[pointIndex]!;
          if (!close(loop[loop.length - 1]!, point)) loop.push(point);
        }
      }
      if (loop.length >= 2 && close(loop[0]!, loop[loop.length - 1]!)) {
        loop.pop();
      }
      if (loop.length < 3) continue;

      // Normalize winding and start so repeated rebuilds compare equal even if
      // the kernel returns the wire edges in a different order.
      const normal = hint.normal;
      let areaX = 0;
      let areaY = 0;
      let areaZ = 0;
      for (let index = 0; index < loop.length; index++) {
        const a = loop[index]!;
        const b = loop[(index + 1) % loop.length]!;
        areaX += (a[1] - b[1]) * (a[2] + b[2]);
        areaY += (a[2] - b[2]) * (a[0] + b[0]);
        areaZ += (a[0] - b[0]) * (a[1] + b[1]);
      }
      if (areaX * normal[0] + areaY * normal[1] + areaZ * normal[2] < 0) {
        loop.reverse();
      }
      let startIndex = 0;
      for (let index = 1; index < loop.length; index++) {
        const point = loop[index]!;
        const best = loop[startIndex]!;
        if (
          point[0] < best[0] - 1e-9 ||
          (Math.abs(point[0] - best[0]) <= 1e-9 &&
            (point[1] < best[1] - 1e-9 ||
              (Math.abs(point[1] - best[1]) <= 1e-9 &&
                point[2] < best[2] - 1e-9)))
        ) {
          startIndex = index;
        }
      }
      loops.push([
        ...loop.slice(startIndex),
        ...loop.slice(0, startIndex),
      ]);
    }
    if (loops.length === 0) return null;
    return {
      normal: [hint.normal[0], hint.normal[1], hint.normal[2]],
      centroid: [hint.centroid[0], hint.centroid[1], hint.centroid[2]],
      loops,
      confidence,
    };
  } catch {
    return null;
  }
}

function buildEdgeBlendFeature(
  feature: KernelEdgeBlendFeature,
  base: Solid,
  baseRoles: RoleTable,
): { solid: Solid; roles: RoleTable } {
  const size = feature.kind === "fillet" ? feature.radius : feature.distance;
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(
      `${feature.kind === "fillet" ? "Fillet radius" : "Chamfer distance"} must be greater than zero.`,
    );
  }
  if (feature.edges.length === 0) {
    throw new Error(`Select at least one edge to ${feature.kind}.`);
  }

  const resolved: ResolvedEdge[] = [];
  try {
    for (const ref of feature.edges) {
      const edge = resolveEdgeOnSolid(base, baseRoles, ref);
      if ("broken" in edge) throw new Error(edge.broken);
      resolved.push(edge);
    }

    const result: EvolutionResult<ValidSolid> = unwrap(
      feature.kind === "fillet"
        ? filletWithEvolution(
            // `Solid` is the runtime-valid result of the worker's own
            // builders; the ValidSolid brand is compile-time only.
            base as ValidSolid,
            resolved.map((entry) => entry.edge),
            size,
          )
        : chamferWithEvolution(
            base as ValidSolid,
            resolved.map((entry) => entry.edge),
            size,
          ),
    );
    // OCCT reports an empty evolution for both fillets and chamfers, so
    // `updateRoles` cannot carry the face roles across. Re-derive them from
    // geometry: the adjacent faces are trimmed but keep their surface and
    // position, and the generated faces are the new ones between each pair.
    const remap = remapRolesByGeometry(base, result.shape as Solid, baseRoles);
    const roles = adoptBlendFaces(
      result.shape as Solid,
      remap,
      resolved,
      feature.featureId,
      feature.kind,
    );
    return { solid: result.shape as Solid, roles };
  } finally {
    // `sharedEdges` hands back fresh, caller-owned edge handles. Faces are
    // borrowed and must not be disposed here.
    for (const entry of resolved) entry.edge.delete();
  }
}

interface ResolvedEdge {
  edge: Edge;
  /** The two pre-fillet faces the edge bounded. */
  faces: [Face, Face];
}

/**
 * Merge same-domain faces on an isolated BREP copy.
 *
 * `unifySameDomain` can corrupt a later fuse on a shape it shares subshapes
 * with, which poisons the cached prefix and makes the next offset preview fail.
 * Copying through BREP first keeps the cached prefix untouched. The copy is
 * only the merge input; the adopted result is independent of it.
 */
function mergeSameDomain(solid: Solid): Solid | null {
  const adapter = kernelAdapter;
  const kernel = rawKernel;
  if (!adapter || !kernel) return null;
  let copy: Solid | null = null;
  try {
    copy = unwrap(fromBREP(unwrap(toBREP(solid)))) as Solid;
    const wrapped = (copy as unknown as { wrapped: unknown }).wrapped;
    const id = adapter.shapeId(wrapped as never);
    const unified = kernel.unifySameDomain(id as never);
    const merged = castShape(adapter.adoptShape(unified)) as Solid;
    copy.delete();
    return merged;
  } catch {
    copy?.delete();
    return null;
  }
}

/**
 * Move one full cylindrical hole or boss wall radially by changing its
 * radius. A hole is enlarged with a bigger cut cylinder and shrunk by fusing
 * an annular tube; a boss is grown with a bigger cylinder and shrunk by cutting
 * an annular tube. The wall itself keeps its role and downstream refs.
 */
/**
 * True when two adjacent faces meet tangentially along their shared edge. This
 * distinguishes a top-edge fillet (the fillet normal matches the face normal at
 * the edge) from a hole/boss wall that crosses the face at an angle.
 */
function tangentNeighbour(
  selected: Parameters<typeof captureHint>[0],
  neighbour: Parameters<typeof captureHint>[0],
): boolean {
  try {
    for (const edge of sharedEdges(selected as Face, neighbour as Face)) {
      const point = curvePointAt(edge, 0.5);
      const a = unit(normalAt(selected as Face, point));
      const b = unit(normalAt(neighbour as Face, point));
      if (Math.abs(dot(a, b)) > 0.999) return true;
    }
  } catch {
    return false;
  }
  return false;
}

interface OffsetPlane {
  normal: Vec3;
  /** dot(normal, pointOnPlane), with a unit normal. */
  d: number;
}

function facePlane(face: Face): OffsetPlane {
  const center = faceCenter(face);
  const normal = unit(normalAt(face, center));
  return { normal, d: dot(normal, center) };
}

function pointKey(point: Vec3): string {
  return `${Math.round(point[0] * 1e6)},${Math.round(point[1] * 1e6)},${Math.round(point[2] * 1e6)}`;
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function intersectPlanes(
  a: OffsetPlane,
  b: OffsetPlane,
  c: OffsetPlane,
): Vec3 | null {
  const bc = cross3(b.normal, c.normal);
  const det = dot(a.normal, bc);
  if (Math.abs(det) < 1e-9) return null;
  const ca = cross3(c.normal, a.normal);
  const ab = cross3(a.normal, b.normal);
  const point = scale(
    add(add(scale(bc, a.d), scale(ca, b.d)), scale(ab, c.d)),
    1 / det,
  );
  return point.every((value) => Number.isFinite(value)) ? point : null;
}

/** Walk a closed wire's edges and return its vertices in order. */
function orderedWirePoints(wire: ClosedWire): Vec3[] {
  const edges = getEdges(wire);
  if (edges.length < 3) {
    throw new Error(
      "The selected face has a curved outer boundary; slanted planar neighbours need straight edges.",
    );
  }
  const incidents = new Map<
    string,
    Array<{ index: number; other: string }>
  >();
  const pointByKey = new Map<string, Vec3>();
  const endpoints: Array<[string, string]> = [];
  for (const [index, edge] of edges.entries()) {
    const start = curvePointAt(edge, 0);
    const end = curvePointAt(edge, 1);
    const startKey = pointKey(start);
    const endKey = pointKey(end);
    pointByKey.set(startKey, start);
    pointByKey.set(endKey, end);
    endpoints.push([startKey, endKey]);
    for (const [key, other] of [
      [startKey, endKey],
      [endKey, startKey],
    ] as const) {
      const list = incidents.get(key) ?? [];
      list.push({ index, other });
      incidents.set(key, list);
    }
  }
  for (const list of incidents.values()) {
    if (list.length !== 2) {
      throw new Error(
        "The selected face has a non-manifold outer boundary; edit the sketch or the feature.",
      );
    }
  }
  const start = endpoints[0]![0];
  const ordered: string[] = [start];
  let current = start;
  let previous = -1;
  for (let step = 0; step < edges.length; step += 1) {
    const next = incidents
      .get(current)!
      .find((candidate) => candidate.index !== previous);
    if (!next) break;
    previous = next.index;
    current = next.other;
    if (current === start) break;
    ordered.push(current);
  }
  if (ordered.length !== edges.length || current !== start) {
    throw new Error(
      "The selected face's outer boundary could not be followed; edit the sketch or the feature.",
    );
  }
  return ordered.map((key) => pointByKey.get(key)!);
}

function wireFromPoints(points: Vec3[]): ClosedWire & PlanarWire {
  const edges = points.map((point, index) =>
    line(point, points[(index + 1) % points.length]!),
  );
  return unwrap(wireLoop(edges)) as ClosedWire & PlanarWire;
}

function otherFaceOnEdge(
  solid: Solid,
  edge: Edge,
  selectedHash: number,
): Face {
  const others = facesOfEdge(solid, edge).filter(
    (face) => getHashCode(face) !== selectedHash,
  );
  if (others.length !== 1) {
    throw new Error(
      "The selected face does not have a simple straight wall on every edge; edit the feature before offsetting it.",
    );
  }
  return others[0] as Face;
}

/** A convex outer loop has the same turn direction at every non-collinear vertex. */
function isConvexLoop(points: Vec3[], normal: Vec3): boolean {
  if (points.length < 3) return false;
  let sign = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    const c = points[(index + 2) % points.length]!;
    const turn = dot(
      cross3(
        [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
        [c[0] - b[0], c[1] - b[1], c[2] - b[2]],
      ),
      normal,
    );
    if (Math.abs(turn) < 1e-9) continue;
    const next = Math.sign(turn);
    if (sign !== 0 && next !== sign) return false;
    sign = next;
  }
  return true;
}

/** A lofted shape is a solid, or a shell that can be closed into one. */
function loftToSolid(
  wires: ClosedWire[],
  scope: {
    track: <T extends Shape3D>(shape: T) => T;
  },
): Solid {
  const shape = scope.track(unwrap(loft(wires, { ruled: true })));
  if (isSolid(shape)) return shape;
  if (isShell(shape)) {
    return scope.track(unwrap(solidFromShell(shape)));
  }
  shape.delete();
  throw new Error(
    "The offset could not build a valid move volume; edit the walls or split the face into simpler steps.",
  );
}

/**
 * Build the material a slanted planar neighbour move adds/removes. The tool is
 * the ruled loft between the old face boundary and the moved boundary; the
 * neighbouring planes supply each moved vertex, so the side walls stay on the
 * existing adjacent planes and the later boolean extends them.
 */
function buildPlanarMoveTool(
  base: Solid,
  face: Parameters<typeof captureHint>[0],
  normal: Vec3,
  distance: number,
): Solid {
  const faceAsFace = face as Face;
  const selectedHash = getHashCode(faceAsFace);
  const outer = outerWire(faceAsFace);
  const outerPoints = orderedWirePoints(outer);
  if (!isConvexLoop(outerPoints, normal)) {
    throw new Error(offsetNonConvexFaceMessage());
  }

  const planesByVertex = new Map<string, OffsetPlane[]>();
  for (const edge of getEdges(outer)) {
    if (String(getCurveType(edge)).toUpperCase() !== "LINE") {
      throw new Error(
        "The selected face has a curved outer edge; slanted planar neighbours need straight edges.",
      );
    }
    const startKey = pointKey(curvePointAt(edge, 0));
    const endKey = pointKey(curvePointAt(edge, 1));
    const neighbour = otherFaceOnEdge(base, edge, selectedHash);
    const type = String(faceGeomType(neighbour)).toUpperCase();
    if (!type.includes("PLANE")) {
      throw new Error(
        offsetMixedSlantedCurvedMessage(String(faceGeomType(neighbour))),
      );
    }
    const plane = facePlane(neighbour);
    for (const key of [startKey, endKey]) {
      const list = planesByVertex.get(key) ?? [];
      list.push(plane);
      planesByVertex.set(key, list);
    }
  }

  const selectedPlane: OffsetPlane = {
    normal,
    d: dot(normal, faceCenter(faceAsFace)) + distance,
  };
  const movedByKey = new Map<string, Vec3>();
  for (const [key, planes] of planesByVertex) {
    if (planes.length !== 2) {
      throw new Error(
        "The selected face has a non-manifold corner; edit the feature before offsetting it.",
      );
    }
    const moved = intersectPlanes(selectedPlane, planes[0]!, planes[1]!);
    if (!moved) {
      throw new Error(
        "The offset would collapse or twist a corner; reduce the distance or edit the adjacent walls.",
      );
    }
    movedByKey.set(key, moved);
  }
  const movedOuterPoints = outerPoints.map(
    (point) => movedByKey.get(pointKey(point))!,
  );

  const holes = innerWires(faceAsFace);
  const sweep = scale(normal, distance);
  return withScope((scope) => {
    const newOuter = scope.track(wireFromPoints(movedOuterPoints));
    const newHoles = holes.map((hole) => {
      for (const edge of getEdges(hole)) {
        const neighbour = otherFaceOnEdge(base, edge, selectedHash);
        const type = String(faceGeomType(neighbour)).toUpperCase();
        if (type.includes("PLANE")) {
          if (Math.abs(dot(facePlane(neighbour).normal, normal)) > 0.01) {
            throw new Error(offsetHoleWallMessage());
          }
        } else if (type.includes("CYL")) {
          const axis = faceAxis(neighbour);
          if (!axis || Math.abs(dot(unit(axis.direction), normal)) < 0.99) {
            throw new Error(offsetHoleWallMessage());
          }
        } else {
          throw new Error(offsetHoleWallMessage());
        }
      }
      return scope.track(translate(hole, sweep) as ClosedWire);
    });
    let tool = loftToSolid([outer, newOuter], scope);
    for (let index = 0; index < holes.length; index += 1) {
      const cutter = loftToSolid([holes[index]!, newHoles[index]!], scope);
      tool = scope.track(unwrap(cut(tool, cutter)));
    }
    if (!isValid(tool)) {
      throw new Error(
        "The offset did not produce a valid closed body; edit the walls or split the face into simpler steps.",
      );
    }
    return unwrap(clone(tool));
  });
}

/**
 * A partial cylindrical wall bounded by two radial planar caps. The tool is an
 * annular sector revolved around the same axis; the cap planes stay fixed, so
 * the boolean extends/trims them just like the planar-move case.
 */
function buildPartialCylinderTool(
  base: Solid,
  selectedFace: Parameters<typeof captureHint>[0],
  axis: { origin: Vec3; direction: Vec3 },
  radius: number,
  newRadius: number,
  lo: number,
  hi: number,
  radialSign: 1 | -1,
  extendLo: boolean,
  extendHi: boolean,
): { tool: Solid; mode: "fuse" | "cut" } {
  const w = unit(axis.direction);
  const reference: Vec3 = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = unit(add(reference, scale(w, -dot(reference, w))));
  const v = cross3(w, u);
  const radialAt = (theta: number): Vec3 =>
    add(scale(u, Math.cos(theta)), scale(v, Math.sin(theta)));
  const angleOf = (point: Vec3): number => {
    const relative = add(point, scale(axis.origin, -1));
    const axial = dot(relative, w);
    const radial = add(relative, scale(w, -axial));
    return Math.atan2(dot(radial, v), dot(radial, u));
  };

  const selectedHash = getHashCode(selectedFace as Face);
  const endAngles: number[] = [];
  for (const edge of getEdges(selectedFace as Face)) {
    if (String(getCurveType(edge)).toUpperCase() !== "LINE") continue;
    const start = curvePointAt(edge, 0);
    const end = curvePointAt(edge, 1);
    const direction = unit([
      end[0] - start[0],
      end[1] - start[1],
      end[2] - start[2],
    ]);
    // The end caps are the generatrices: straight edges parallel to the axis.
    if (Math.abs(dot(direction, w)) < 0.99) continue;
    const neighbour = otherFaceOnEdge(base, edge, selectedHash);
    if (!String(faceGeomType(neighbour)).toUpperCase().includes("PLANE")) {
      throw new Error(offsetPartialCapMessage());
    }
    const plane = facePlane(neighbour);
    const relative = add(start, scale(axis.origin, -1));
    const axial = dot(relative, w);
    const radial = add(relative, scale(w, -axial));
    const radialUnit = unit(radial);
    // A radial cap contains the axis and the radius: its normal is tangential.
    if (
      Math.abs(dot(plane.normal, w)) > 0.01 ||
      Math.abs(dot(plane.normal, radialUnit)) > 0.01
    ) {
      throw new Error(offsetPartialCapMessage());
    }
    endAngles.push(angleOf(start));
  }
  if (endAngles.length !== 2) {
    throw new Error(offsetPartialCapMessage());
  }

  const tau = Math.PI * 2;
  const normalize = (angle: number): number =>
    ((angle % tau) + tau) % tau;
  const a = normalize(endAngles[0]!);
  const b = normalize(endAngles[1]!);
  const ccw = normalize(b - a);
  const mid = normalize(angleOf(faceCenter(selectedFace as Face)));
  const midDelta = normalize(mid - a);
  const start = midDelta <= ccw + 1e-6 ? a : b;
  const span = midDelta <= ccw + 1e-6 ? ccw : tau - ccw;
  if (!(span > 1e-6) || span > tau - 1e-6) {
    throw new Error(offsetPartialCapMessage());
  }

  const grows = newRadius > radius;
  const mode: "fuse" | "cut" =
    radialSign < 0 ? (grows ? "cut" : "fuse") : grows ? "fuse" : "cut";
  const radialOverlap = 0.01;
  const inner =
    radialSign < 0
      ? grows
        ? radius - radialOverlap
        : newRadius
      : grows
        ? radius - radialOverlap
        : newRadius;
  const outer =
    radialSign < 0
      ? grows
        ? newRadius
        : radius + radialOverlap
      : grows
        ? newRadius
        : radius + radialOverlap;
  const pad = 0.25;
  const zLo = lo - (extendLo ? pad : 0);
  const zHi = hi + (extendHi ? pad : 0);
  const radial = radialAt(start);
  const point = (r: number, z: number): Vec3 =>
    add(add(axis.origin, scale(w, z)), scale(radial, r));
  const profilePoints = [
    point(inner, zLo),
    point(outer, zLo),
    point(outer, zHi),
    point(inner, zHi),
  ];

  return withScope((scope) => {
    const wire = scope.track(wireFromPoints(profilePoints));
    const profile = scope.track(unwrap(face(wire)));
    const shape = scope.track(
      unwrap(
        revolve(
          profile as unknown as Parameters<typeof revolve>[0],
          { axis: w, at: axis.origin, angle: span },
        ),
      ),
    );
    let tool: Solid;
    if (isSolid(shape)) {
      tool = shape;
    } else if (isShell(shape)) {
      tool = scope.track(unwrap(solidFromShell(shape)));
    } else {
      throw new Error(
        "The offset could not build a valid sector; edit the wall or split the face into simpler steps.",
      );
    }
    if (!isValid(tool)) {
      throw new Error(
        "The offset did not produce a valid closed body; edit the walls or split the face into simpler steps.",
      );
    }
    return { tool: unwrap(clone(tool)), mode };
  });
}

function buildCylindricalOffset(
  feature: KernelOffsetFaceFeature,
  base: Solid,
  baseRoles: RoleTable,
  face: Parameters<typeof captureHint>[0],
): { solid: Solid; roles: RoleTable } {
  const axis = faceAxis(face as Face);
  if (!axis) {
    throw new Error("The selected cylindrical face has no stable axis.");
  }
  const info = cylinderHint(face);
  if (info.radius === undefined || info.radialSign === undefined) {
    throw new Error("The selected cylindrical face has no stable radius.");
  }
  const [lo, hi] = faceAxialExtent(face, axis);
  const height = hi - lo;
  if (!(height > 1e-6)) {
    throw new Error("The selected cylindrical face has no usable extent.");
  }
  const area = captureHint(face).area;
  const fullArea = 2 * Math.PI * info.radius * height;
  if (area === undefined) {
    throw new Error("The selected cylindrical face has no usable area.");
  }
  const full =
    Math.abs(area - fullArea) <= Math.max(1e-3, fullArea * 0.01);
  const [bodyLo, bodyHi] = solidAxialExtent(base, axis);
  const openAtLo = Math.abs(lo - bodyLo) < 1e-2;
  const openAtHi = Math.abs(hi - bodyHi) < 1e-2;
  const through = openAtLo && openAtHi;
  if (info.radialSign < 0 && !openAtLo && !openAtHi) {
    throw new Error(offsetSealedCylinderMessage());
  }
  if (info.radialSign < 0 && !through) {
    const blindAxial = openAtHi ? lo : hi;
    if (!blindEndIsPlanar(base, face, axis, blindAxial)) {
      throw new Error(offsetBlindCapMessage());
    }
  }

  const distance = feature.distance;
  const newRadius = info.radius + distance * info.radialSign;
  if (!(newRadius > 1e-6)) {
    throw new Error("The offset is too large for this hole or boss.");
  }

  const basePoint = add(axis.origin, scale(axis.direction, lo));
  let tool: Solid;
  let mode: "fuse" | "cut";
  if (!full) {
    const grows = newRadius > info.radius;
    const holeGrows = info.radialSign < 0 && grows;
    const partial = buildPartialCylinderTool(
      base,
      face,
      axis,
      info.radius,
      newRadius,
      lo,
      hi,
      info.radialSign,
      holeGrows && openAtLo,
      holeGrows && openAtHi,
    );
    tool = partial.tool;
    mode = partial.mode;
  } else if (info.radialSign < 0) {
    if (newRadius > info.radius) {
      // Hole grows: cut a larger cylinder. Pad only the open end(s), so a
      // blind hole keeps its bottom cap at the same depth.
      const pad = 0.25;
      // The open end is at hi when openAtHi, otherwise at lo. The blind end
      // (lo or hi) stays exactly where it is.
      const from =
        through || openAtLo
          ? add(basePoint, scale(axis.direction, -pad))
          : basePoint;
      const cutHeight = through ? height + 2 * pad : height + pad;
      tool = cylinder(newRadius, cutHeight, {
        at: from,
        axis: axis.direction,
      });
      mode = "cut";
    } else {
      // Hole shrinks: fill the annular gap between the old and new radius.
      const outer = cylinder(info.radius, height, {
        at: basePoint,
        axis: axis.direction,
      });
      const inner = cylinder(newRadius, height, {
        at: basePoint,
        axis: axis.direction,
      });
      tool = unwrap(cut(outer, inner));
      mode = "fuse";
    }
  } else if (newRadius > info.radius) {
    // Boss grows: add an annular shell, not a solid cylinder. A solid cylinder
    // fills a coaxial bore (a revolve/tube) and turns a hollow boss into a
    // solid plug. A small inward overlap makes the fuse clean against the
    // existing wall; the union gain is still π(new² - old²)·height.
    const overlap = Math.min(0.01, info.radius * 0.5);
    const outer = cylinder(newRadius, height, {
      at: basePoint,
      axis: axis.direction,
    });
    const inner = cylinder(info.radius - overlap, height, {
      at: basePoint,
      axis: axis.direction,
    });
    tool = unwrap(cut(outer, inner));
    mode = "fuse";
  } else {
    // Boss shrinks: remove its outer annular shell.
    const outer = cylinder(info.radius + 0.01, height, {
      at: basePoint,
      axis: axis.direction,
    });
    const inner = cylinder(newRadius, height, {
      at: basePoint,
      axis: axis.direction,
    });
    tool = unwrap(cut(outer, inner));
    mode = "cut";
  }

  let solid: Solid;
  try {
    solid = unwrap(mode === "fuse" ? fuse(base, tool) : cut(base, tool));
  } finally {
    tool.delete();
  }

  try {
    if (isEmpty(solid)) {
      throw new Error("The offset removes the whole body.");
    }
    if (getSolids(solid).length !== 1) {
      throw new Error("The offset did not produce a single body.");
    }
    if (!isValid(solid)) {
      throw new Error("The offset did not produce a valid closed body.");
    }
    const merged = mergeSameDomain(solid);
    if (merged) {
      if (
        isValid(merged) &&
        getFaces(merged).length <= getFaces(solid).length
      ) {
        solid.delete();
        solid = merged;
      } else {
        merged.delete();
      }
    }
    const before = unwrap(measureVolume(base));
    const after = unwrap(measureVolume(solid));
    if (Math.abs(after - before) < 1e-6) {
      throw new Error("The offset did not change the body.");
    }
    const remap = remapRolesByGeometry(base, solid, baseRoles);
    const roles = transferCylinderRole(
      solid,
      remap,
      baseRoles,
      getHashCode(face),
      axis,
      newRadius,
      feature.featureId,
    );
    return { solid, roles };
  } catch (error) {
    solid.delete();
    throw error;
  }
}

/** A blind hole is supported only when its closed end is a planar cap. */
function blindEndIsPlanar(
  base: Solid,
  face: Parameters<typeof captureHint>[0],
  axis: { origin: Vec3; direction: Vec3 },
  endAxial: number,
): boolean {
  const faceAsFace = face as Face;
  for (const edge of getEdges(faceAsFace)) {
    const point = curvePointAt(edge, 0.5);
    const axial = dot(
      add(point, scale(axis.origin, -1)),
      axis.direction,
    );
    if (Math.abs(axial - endAxial) > 1e-2) continue;
    const neighbours = facesOfEdge(base, edge).filter(
      (candidate) => getHashCode(candidate) !== getHashCode(faceAsFace),
    );
    if (
      neighbours.some((candidate) =>
        String(faceGeomType(candidate)).toUpperCase().includes("PLANE"),
      )
    ) {
      return true;
    }
  }
  return false;
}

function faceAxialExtent(
  face: Parameters<typeof captureHint>[0],
  axis: { origin: Vec3; direction: Vec3 },
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const edge of getEdges(face as Face)) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const point = curvePointAt(edge, t);
      const axial = dot(
        add(point, scale(axis.origin, -1)),
        axis.direction,
      );
      lo = Math.min(lo, axial);
      hi = Math.max(hi, axial);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new Error("The selected cylindrical face has no usable extent.");
  }
  return [lo, hi];
}

function solidAxialExtent(
  solid: Solid,
  axis: { origin: Vec3; direction: Vec3 },
): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const vertex of getVertices(solid)) {
    const point = vertexPosition(
      vertex as Parameters<typeof vertexPosition>[0],
    );
    const axial = dot(add(point, scale(axis.origin, -1)), axis.direction);
    lo = Math.min(lo, axial);
    hi = Math.max(hi, axial);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new Error("The body has no usable extent for this offset.");
  }
  return [lo, hi];
}

function transferCylinderRole(
  post: Solid,
  remap: RoleRemap,
  baseRoles: RoleTable,
  preHash: number,
  axis: { origin: Vec3; direction: Vec3 },
  radius: number,
  featureId: string,
): RoleTable {
  const next: MutableRoleTable = new Map();
  for (const [origin, roleMap] of remap.roles) {
    const copy = new Map<string, number[]>();
    for (const [role, hashes] of roleMap) copy.set(role, [...hashes]);
    next.set(origin, copy);
  }
  const claimed = new Set(remap.claimed);
  const owners: Array<{ origin: string; role: string }> = [];
  for (const [origin, roleMap] of baseRoles) {
    for (const [role, hashes] of roleMap) {
      if (hashes.includes(preHash)) owners.push({ origin, role });
    }
  }

  let best: { hash: number; score: number } | null = null;
  for (const candidate of getFaces(post) as Array<Parameters<typeof captureHint>[0]>) {
    const hash = getHashCode(candidate);
    if (claimed.has(hash)) continue;
    if (!String(faceGeomType(candidate as Face)).toUpperCase().includes("CYL")) {
      continue;
    }
    const candidateAxis = faceAxis(candidate as Face);
    const hint = cylinderHint(candidate);
    if (!candidateAxis || hint.radius === undefined) continue;
    if (Math.abs(dot(unit(candidateAxis.direction), unit(axis.direction))) < 0.999) {
      continue;
    }
    const relative = add(candidateAxis.origin, scale(axis.origin, -1));
    const axial = dot(relative, unit(axis.direction));
    const radial = add(relative, scale(unit(axis.direction), -axial));
    const axisDistance = Math.hypot(radial[0], radial[1], radial[2]);
    if (axisDistance > 0.05) continue;
    const radiusDiff = Math.abs(hint.radius - radius);
    if (radiusDiff > 0.05) continue;
    const score = radiusDiff + axisDistance;
    if (!best || score < best.score) best = { hash, score };
  }

  if (best && owners.length > 0) {
    for (const owner of owners) {
      const roleMap = next.get(owner.origin) ?? new Map<string, number[]>();
      const hashes = roleMap.get(owner.role) ?? [];
      if (!hashes.includes(best.hash)) hashes.push(best.hash);
      roleMap.set(owner.role, hashes);
      next.set(owner.origin, roleMap);
    }
    claimed.add(best.hash);
  }

  const featureRoles = new Map<string, number[]>();
  let anonymous = 0;
  for (const candidate of getFaces(post) as Array<Parameters<typeof captureHint>[0]>) {
    const hash = getHashCode(candidate);
    if (claimed.has(hash)) continue;
    featureRoles.set(`offset:face_${anonymous++}`, [hash]);
    claimed.add(hash);
  }
  if (featureRoles.size > 0) next.set(featureId, featureRoles);
  return next;
}

/**
 * Move planar faces along their normals. A face is swept by the signed
 * distance and fused (outward) or cut (inward). This is exact only when every
 * neighbouring surface is preserved by the sweep: planar neighbours must
 * contain the sweep direction and cylindrical neighbours must have their axis
 * parallel to it. A tangent top-edge fillet or a slanted wall would leave an
 * undercut/step, so it is rejected instead of producing silent wrong geometry.
 */
function buildOffsetFaceFeature(
  feature: KernelOffsetFaceFeature,
  base: Solid,
  baseRoles: RoleTable,
): { solid: Solid; roles: RoleTable } {
  const distance = feature.distance;
  if (!Number.isFinite(distance) || distance === 0) {
    throw new Error("Offset distance must be greater than zero.");
  }
  if (feature.faces.length === 0) {
    throw new Error("Select at least one face to offset.");
  }

  type Face3D = Parameters<typeof captureHint>[0];
  // Cylindrical hole/boss walls need a different rebuild (a concentric
  // cylinder or tube), not a planar sweep.
  const resolvedFaces: Face3D[] = [];
  for (const ref of feature.faces) {
    const resolved = resolveFaceOnSolid(base, baseRoles, ref);
    if ("broken" in resolved) {
      throw new Error(
        "The selected face no longer exists on the current body; reselect it or remove the offset.",
      );
    }
    resolvedFaces.push(resolved.face as Face3D);
  }
  const cylinderFaces = resolvedFaces.filter((face) =>
    String(faceGeomType(face as Face)).toUpperCase().includes("CYL"),
  );
  if (cylinderFaces.length > 0) {
    if (resolvedFaces.length !== 1) {
      throw new Error(offsetMultipleCylinderSelectionMessage());
    }
    return buildCylindricalOffset(
      feature,
      base,
      baseRoles,
      resolvedFaces[0]!,
    );
  }

  const selected: Array<{
    face: Face3D;
    normal: Vec3;
    center: Vec3;
    hash: number;
    method: "prism" | "planarMove";
  }> = [];

  for (const ref of feature.faces) {
    const resolved = resolveFaceOnSolid(base, baseRoles, ref);
    if ("broken" in resolved) {
      throw new Error(
        "The selected face no longer exists on the current body; reselect it or remove the offset.",
      );
    }
    const face = resolved.face as Face3D;
    const type = String(faceGeomType(face as Face)).toUpperCase();
    if (!type.includes("PLANE")) {
      throw new Error(offsetSelectedSurfaceMessage(type));
    }
    const center = faceCenter(face as Face);
    const normal = unit(normalAt(face as Face, center));
    selected.push({
      face,
      normal,
      center,
      hash: getHashCode(face),
      method: "prism",
    });
  }

  const first = selected[0]!;
  for (const entry of selected.slice(1)) {
    if (Math.abs(dot(entry.normal, first.normal)) < 0.999) {
      throw new Error(offsetNonParallelSelectionMessage());
    }
  }

  const sweep: Vec3 = scale(first.normal, distance > 0 ? 1 : -1);
  for (const entry of selected) {
    let hasSlantedPlane = false;
    for (const neighbour of adjacentFaces(base, entry.face as Face)) {
      const type = String(faceGeomType(neighbour)).toUpperCase();
      if (type.includes("PLANE")) {
        const normal = unit(normalAt(neighbour, faceCenter(neighbour)));
        if (Math.abs(dot(normal, sweep)) > 0.01) hasSlantedPlane = true;
        continue;
      }
      if (type.includes("CYL")) {
        const axis = faceAxis(neighbour);
        if (!axis || Math.abs(dot(unit(axis.direction), sweep)) < 0.99) {
          throw new Error(
            tangentNeighbour(
              entry.face as Parameters<typeof captureHint>[0],
              neighbour as Parameters<typeof captureHint>[0],
            )
              ? offsetTangentFilletMessage()
              : offsetHorizontalCylinderMessage(),
          );
        }
        continue;
      }
      throw new Error(
        offsetCurvedNeighbourMessage(String(faceGeomType(neighbour))),
      );
    }
    if (hasSlantedPlane) entry.method = "planarMove";
  }

  let solid = base;
  try {
    for (const entry of selected) {
      const tool =
        entry.method === "planarMove"
          ? buildPlanarMoveTool(
              base,
              entry.face,
              entry.normal,
              distance,
            )
          : unwrap(
              extrude(
                entry.face as unknown as Parameters<typeof extrude>[0],
                scale(entry.normal, distance),
              ),
            );
      try {
        const next = unwrap(distance > 0 ? fuse(solid, tool) : cut(solid, tool));
        if (solid !== base) solid.delete();
        solid = next;
      } finally {
        tool.delete();
      }
    }

    if (isEmpty(solid)) {
      throw new Error("The offset removes the whole body.");
    }
    if (getSolids(solid).length !== 1) {
      throw new Error("The offset did not produce a single body.");
    }
    if (!isValid(solid)) {
      throw new Error("The offset did not produce a valid closed body.");
    }
    // A boolean splits same-domain faces at the old boundary. Unify them so a
    // simple offset does not grow the face count (a cube stays six faces). Work
    // on an isolated copy so the cached prefix stays usable for the next
    // preview/edit. If the merge cannot validate, keep the boolean result.
    const merged = mergeSameDomain(solid);
    if (merged) {
      if (
        isValid(merged) &&
        getFaces(merged).length <= getFaces(solid).length
      ) {
        if (solid !== base) solid.delete();
        solid = merged;
      } else {
        merged.delete();
      }
    }
    const before = unwrap(measureVolume(base));
    const after = unwrap(measureVolume(solid));
    if (Math.abs(after - before) < 1e-6) {
      throw new Error("The offset did not change the body.");
    }

    const remap = remapRolesByGeometry(base, solid, baseRoles);
    const roles = transferOffsetRoles(
      solid,
      remap,
      baseRoles,
      selected,
      distance,
      feature.featureId,
    );
    return { solid, roles };
  } catch (error) {
    if (solid !== base) solid.delete();
    throw error;
  }
}

/** Carry a moved face's role onto the face the boolean created at its new plane. */
type MutableRoleTable = Map<string, Map<string, number[]>>;

function transferOffsetRoles(
  post: Solid,
  remap: RoleRemap,
  baseRoles: RoleTable,
  selected: ReadonlyArray<{ face: Parameters<typeof captureHint>[0]; normal: Vec3; center: Vec3; hash: number }>,
  distance: number,
  featureId: string,
): RoleTable {
  const next: MutableRoleTable = new Map();
  for (const [origin, roleMap] of remap.roles) {
    const copy = new Map<string, number[]>();
    for (const [role, hashes] of roleMap) copy.set(role, [...hashes]);
    next.set(origin, copy);
  }
  const claimed = new Set(remap.claimed);
  const postFaces = getFaces(post) as Array<Parameters<typeof captureHint>[0]>;

  for (const entry of selected) {
    const owners: Array<{ origin: string; role: string }> = [];
    for (const [origin, roleMap] of baseRoles) {
      for (const [role, hashes] of roleMap) {
        if (hashes.includes(entry.hash)) owners.push({ origin, role });
      }
    }
    if (owners.length === 0) continue;

    const predicted = add(entry.center, scale(entry.normal, distance));
    const expectedPlane = dot(entry.normal, predicted);
    let best: { hash: number; score: number } | null = null;
    for (const candidate of postFaces) {
      const hash = getHashCode(candidate);
      if (claimed.has(hash)) continue;
      const type = String(faceGeomType(candidate as Face)).toUpperCase();
      if (!type.includes("PLANE")) continue;
      const center = faceCenter(candidate as Face);
      if (
        Math.abs(dot(unit(normalAt(candidate as Face, center)), entry.normal)) <
        0.999
      ) {
        continue;
      }
      // The moved plane is the hard identity; the outline may grow or shrink
      // when a slanted neighbour is followed, so area is not a filter.
      if (Math.abs(dot(entry.normal, center) - expectedPlane) > 0.05) {
        continue;
      }
      const delta = add(center, scale(predicted, -1));
      const score = Math.hypot(delta[0], delta[1], delta[2]);
      if (!best || score < best.score) best = { hash, score };
    }
    if (!best) continue;
    for (const owner of owners) {
      const roleMap = next.get(owner.origin) ?? new Map<string, number[]>();
      const hashes = roleMap.get(owner.role) ?? [];
      if (!hashes.includes(best.hash)) hashes.push(best.hash);
      roleMap.set(owner.role, hashes);
      next.set(owner.origin, roleMap);
    }
    claimed.add(best.hash);
  }

  const featureRoles = new Map<string, number[]>();
  let anonymous = 0;
  for (const face of postFaces) {
    const hash = getHashCode(face);
    if (claimed.has(hash)) continue;
    featureRoles.set(`offset:face_${anonymous++}`, [hash]);
    claimed.add(hash);
  }
  if (featureRoles.size > 0) next.set(featureId, featureRoles);
  return next;
}

function unit(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 0 ? [value[0] / length, value[1] / length, value[2] / length] : [0, 0, 1];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function scale(value: Vec3, factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * Hollow the current body, removing `faces` as openings. OCCT offsets the
 * remaining faces inward by `thickness`; the outer faces keep their roles, and
 * the new inner/rim faces are named under the feature so the step highlight and
 * downstream picks work.
 */
function buildShellFeature(
  feature: KernelShellFeature,
  base: Solid,
  baseRoles: RoleTable,
): { solid: Solid; roles: RoleTable } {
  const thickness = feature.thickness;
  if (!Number.isFinite(thickness) || thickness <= 0) {
    throw new Error("Shell thickness must be greater than zero.");
  }
  if (feature.faces.length === 0) {
    throw new Error("Select at least one face to open.");
  }

  const openFaces: Face[] = [];
  for (const ref of feature.faces) {
    const resolved = resolveFaceOnSolid(base, baseRoles, ref);
    if ("broken" in resolved) {
      throw new Error(
        "The selected face no longer exists on the current body; reselect it or remove the shell.",
      );
    }
    openFaces.push(resolved.face as Face);
  }

  const result = unwrap(
    shellWithEvolution(base as ValidSolid, openFaces, thickness),
  );
  // OCCT silently returns a *larger* solid when the wall is thicker than the
  // body can absorb (e.g. 50 mm on a 12 mm plate). A shell only removes
  // material and never grows the body, so reject that result explicitly.
  const before = getBounds(base);
  const after = getBounds(result.shape as Solid);
  const grew =
    unwrap(measureVolume(result.shape as Solid)) >=
    unwrap(measureVolume(base)) - 1e-6;
  const outside =
    after.xMin < before.xMin - 1e-3 ||
    after.xMax > before.xMax + 1e-3 ||
    after.yMin < before.yMin - 1e-3 ||
    after.yMax > before.yMax + 1e-3 ||
    after.zMin < before.zMin - 1e-3 ||
    after.zMax > before.zMax + 1e-3;
  if (grew || outside) {
    throw new Error("The shell thickness is too large for this body.");
  }
  const remap = remapRolesByGeometry(base, result.shape as Solid, baseRoles);
  const roles = adoptShellFaces(
    result.shape as Solid,
    remap,
    feature.featureId,
  );
  return { solid: result.shape as Solid, roles };
}

/** Name the inner and rim faces a shell generated under its feature step. */
function adoptShellFaces(
  post: Solid,
  remap: RoleRemap,
  featureId: string,
): RoleTable {
  const claimed = new Set(remap.claimed);
  const featureRoles = new Map<string, number[]>();
  let anonymous = 0;
  for (const face of getFaces(post) as Array<Parameters<typeof captureHint>[0]>) {
    const hash = getHashCode(face);
    if (claimed.has(hash)) continue;
    featureRoles.set(`shell:face_${anonymous++}`, [hash]);
    claimed.add(hash);
  }
  if (featureRoles.size === 0) return remap.roles;
  const next = new Map(remap.roles);
  next.set(featureId, featureRoles);
  return next;
}

/**
 * Resolve one face ref on a solid, with the same exact-role-first and
 * geometric-fallback policy the projected references use.
 */
function resolveFaceOnSolid(
  solid: Solid,
  roles: RoleTable,
  ref: TopoRef,
):
  | { face: Parameters<typeof captureHint>[0] }
  | { broken: "deleted" | "ambiguous" | "not-found" } {
  try {
    const resolved = resolveRef(
      {
        origin: ref.source,
        role: ref.role,
        hint: {
          entityType: "face",
          ...(ref.hint.normal ? { normal: ref.hint.normal } : {}),
          ...(ref.hint.centroid ? { centroid: ref.hint.centroid } : {}),
          ...(ref.hint.area !== undefined ? { area: ref.hint.area } : {}),
        },
      },
      roles,
      solid,
    );
    let face: Parameters<typeof captureHint>[0] | null =
      "face" in resolved ? resolved.face : null;
    if (face) {
      const hint = captureHint(face);
      if (
        !hint.normal ||
        !hintAgrees(ref, {
          normal: hint.normal,
          centroid: hint.centroid,
          area: hint.area,
        })
      ) {
        face = null;
      }
    }
    if (!face) {
      const fallback = matchFaceByHint(solid, ref);
      if (!fallback) {
        return { broken: "face" in resolved ? "ambiguous" : resolved.reason };
      }
      face = fallback;
    }
    return { face };
  } catch {
    return { broken: "not-found" };
  }
}

/** Resolve an edge as the shared boundary of its two recorded faces. */
function resolveEdgeOnSolid(
  solid: Solid,
  roles: RoleTable,
  ref: EdgeRef,
): ResolvedEdge | { broken: string } {
  const a = resolveFaceOnSolid(solid, roles, ref.faces[0]);
  const b = resolveFaceOnSolid(solid, roles, ref.faces[1]);
  if ("broken" in a || "broken" in b) {
    return {
      broken:
        "The selected edge no longer exists on the current body; reselect it or remove the fillet.",
    };
  }
  const candidates: Edge[] = [];
  const seen = new Set<number>();
  for (const edge of sharedEdges(a.face as Face, b.face as Face)) {
    const hash = getHashCode(edge);
    if (seen.has(hash)) continue;
    seen.add(hash);
    candidates.push(edge);
  }
  if (candidates.length === 0) {
    return {
      broken:
        "The selected edge no longer exists on the current body; reselect it or remove the fillet.",
    };
  }
  if (candidates.length === 1) {
    return { edge: candidates[0]!, faces: [a.face as Face, b.face as Face] };
  }
  const edge = pickEdgeByHint(candidates, ref);
  if (!edge) {
    for (const candidate of candidates) candidate.delete();
    return {
      broken:
        "The selected edge is ambiguous on the current body; reselect a single edge.",
    };
  }
  for (const candidate of candidates) {
    if (candidate !== edge) candidate.delete();
  }
  return { edge, faces: [a.face as Face, b.face as Face] };
}

/** Pick the edge closest to the captured midpoint/length, or nothing on a tie. */
function pickEdgeByHint(edges: readonly Edge[], ref: EdgeRef): Edge | null {
  if (ref.hint.length === undefined && ref.hint.midpoint === undefined) {
    return null;
  }
  let best: Edge | null = null;
  let bestScore = Infinity;
  let secondScore = Infinity;
  for (const edge of edges) {
    let score = 0;
    if (ref.hint.length !== undefined) {
      score += Math.abs(curveLength(edge) - ref.hint.length);
    }
    if (ref.hint.midpoint) {
      const points = verticesOfEdge(edge).map((vertex) =>
        vertexPosition(vertex as Parameters<typeof vertexPosition>[0]),
      );
      if (points.length > 0) {
        const midpoint = points.reduce(
          (sum, point) => [
            sum[0] + point[0] / points.length,
            sum[1] + point[1] / points.length,
            sum[2] + point[2] / points.length,
          ],
          [0, 0, 0] as [number, number, number],
        );
        score += Math.hypot(
          midpoint[0] - ref.hint.midpoint[0],
          midpoint[1] - ref.hint.midpoint[1],
          midpoint[2] - ref.hint.midpoint[2],
        );
      }
    }
    if (score < bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = edge;
    } else if (score < secondScore) {
      secondScore = score;
    }
  }
  if (!best || secondScore - bestScore < 1e-6) return null;
  return best;
}

interface RoleRemap {
  roles: RoleTable;
  /** Pre-fillet face hash -> the result face that geometrically continues it. */
  faceMap: Map<number, Face | null>;
  /** Result face hashes already accounted for by a carried-over role. */
  claimed: Set<number>;
}

/**
 * Re-derive every existing face role on the filleted result. Fillets trim the
 * adjacent faces without reporting an evolution, so hash lineage is lost;
 * surface type + normal + sampled containment reattaches each old role to the
 * trimmed face it became.
 */
function remapRolesByGeometry(
  pre: Solid,
  post: Solid,
  roles: RoleTable,
): RoleRemap {
  type Face3D = Parameters<typeof captureHint>[0];
  const preFaces = getFaces(pre) as Face3D[];
  const postFaces = getFaces(post) as Face3D[];
  const faceMap = new Map<number, Face | null>();
  const claimed = new Set<number>();

  for (const preFace of preFaces) {
    const preHash = getHashCode(preFace);
    if (faceMap.has(preHash)) continue;
    const match = matchFaceGeometrically(preFace, postFaces);
    faceMap.set(preHash, match);
    if (match) claimed.add(getHashCode(match));
  }

  const next = new Map<string, Map<string, number[]>>();
  for (const [origin, originRoles] of roles) {
    const nextRoles = new Map<string, number[]>();
    for (const [role, hashes] of originRoles) {
      const mapped: number[] = [];
      for (const hash of hashes) {
        const face = faceMap.get(hash);
        if (!face) continue;
        const nextHash = getHashCode(face);
        if (!mapped.includes(nextHash)) mapped.push(nextHash);
      }
      if (mapped.length > 0) nextRoles.set(role, mapped);
    }
    next.set(origin, nextRoles);
  }
  return { roles: next, faceMap, claimed };
}

/** The result face that best continues a pre-face, or null if it vanished. */
function matchFaceGeometrically(
  preFace: Parameters<typeof captureHint>[0],
  candidates: ReadonlyArray<Parameters<typeof captureHint>[0]>,
): Face | null {
  const preHint = captureHint(preFace);
  const points = sampleFacePoints(preFace);
  if (points.length === 0) return null;
  let best: { face: Parameters<typeof captureHint>[0]; hits: number } | null =
    null;
  for (const candidate of candidates) {
    const hint = captureHint(candidate);
    if (preHint.surfaceType && hint.surfaceType) {
      if (String(preHint.surfaceType) !== String(hint.surfaceType)) continue;
    }
    if (preHint.normal && hint.normal) {
      const dot =
        preHint.normal[0] * hint.normal[0] +
        preHint.normal[1] * hint.normal[1] +
        preHint.normal[2] * hint.normal[2];
      if (dot < 0.9) continue;
    }
    let hits = 0;
    for (const point of points) {
      try {
        const projection = projectPointOnFace(candidate, point);
        if (!projection.ok || projection.value.distance > 0.05) continue;
        if (classifyPointOnFace(candidate, point, 0.05) === "out") continue;
        hits += 1;
      } catch {
        // Analytic projection can fail on exotic surfaces; skip the point.
      }
    }
    if (hits > 0 && (!best || hits > best.hits)) best = { face: candidate, hits };
  }
  return (best?.face as Face | undefined) ?? null;
}

/**
 * Name the faces an edge blend generated: the round/bevel between each
 * processed pair, plus anything still anonymous. They belong to the feature
 * step, so selecting it highlights them and downstream refs can point at them.
 */
function adoptBlendFaces(
  post: Solid,
  remap: RoleRemap,
  resolved: readonly ResolvedEdge[],
  featureId: string,
  kind: "fillet" | "chamfer",
): RoleTable {
  type Face3D = Parameters<typeof captureHint>[0];
  const claimed = new Set(remap.claimed);
  const featureRoles = new Map<string, number[]>();

  resolved.forEach((entry, index) => {
    const postA = remap.faceMap.get(getHashCode(entry.faces[0]));
    const postB = remap.faceMap.get(getHashCode(entry.faces[1]));
    if (!postA || !postB) return;
    const adjacentToA = new Set(
      adjacentFaces(post, postA).map((face) => getHashCode(face)),
    );
    const generate = adjacentFaces(post, postB)
      .map((face) => getHashCode(face))
      .filter((hash) => adjacentToA.has(hash) && !claimed.has(hash));
    if (generate.length === 0) return;
    featureRoles.set(`${kind}:round_${index}`, generate);
    for (const hash of generate) claimed.add(hash);
  });

  let anonymous = 0;
  for (const face of getFaces(post) as Face3D[]) {
    const hash = getHashCode(face);
    if (claimed.has(hash)) continue;
    featureRoles.set(`${kind}:face_${anonymous++}`, [hash]);
    claimed.add(hash);
  }

  if (featureRoles.size === 0) return remap.roles;
  const next = new Map(remap.roles);
  next.set(featureId, featureRoles);
  return next;
}

function buildRevolveSolid(params: RevolveParams): Solid {
  if (!Number.isFinite(params.angle) || params.angle < 1 || params.angle > 360) {
    throw new Error("Revolve angle must be between 1° and 360°.");
  }
  if (params.regions.length === 0) {
    throw new Error("Select at least one profile region.");
  }
  for (const region of params.regions) validateRegion(region);

  const angle =
    (params.angle * Math.PI) / 180 * (params.direction === "cw" ? -1 : 1);
  const axis: [number, number, number] = [
    params.axis.direction[0],
    params.axis.direction[1],
    0,
  ];
  const at: [number, number, number] = [
    params.axis.at[0],
    params.axis.at[1],
    0,
  ];

  return withScope((scope) => {
    const solids = params.regions.map((region) => {
      const outerWire = scope.track(toWire(region.outer));
      const holeWires = region.holes.map((hole) => scope.track(toWire(hole)));
      const profile = scope.track(unwrap(face(outerWire)));
      const withHoles =
        holeWires.length > 0
          ? scope.track(addHoles(profile, holeWires))
          : profile;
      return scope.track(
        unwrap(
          revolve(withHoles as unknown as Parameters<typeof revolve>[0], {
            axis,
            at,
            angle,
          }),
        ) as Solid,
      );
    });
    const solid =
      solids.length === 1 ? solids[0]! : scope.track(unwrap(fuseAll(solids)));
    const local = unwrap(clone(solid));
    if (!params.frame) return local;
    const moved = unwrap(applyMatrix(local, frameMatrix(params.frame)));
    local.delete();
    return moved;
  });
}

function buildSolid(params: ExtrudeParams, base: Solid | null): Solid {
  if (
    params.end !== "throughAll" &&
    (!Number.isFinite(params.height) || params.height <= 0)
  ) {
    throw new Error("Extrude height must be greater than zero.");
  }
  if (params.regions.length === 0) {
    throw new Error("Select at least one profile region.");
  }
  for (const region of params.regions) validateRegion(region);

  const frame = params.frame;
  let startZ = 0;
  let totalHeight = params.height;
  if (params.end === "throughAll") {
    if (!base) throw new Error("Through-all needs an existing body to cut.");
    const extent = frame
      ? extentAlongFrame(base, frame)
      : { min: getBounds(base).zMin, max: getBounds(base).zMax };
    const span = Math.max(extent.max - extent.min, 1);
    const margin = Math.max(5, span * 0.1);
    startZ = extent.min - margin;
    totalHeight = span + margin * 2;
  } else if (params.symmetric) {
    startZ = -params.height / 2;
    totalHeight = params.height;
  }

  return withScope((scope) => {
    const solids = params.regions.map((region) => {
      const outerWire = scope.track(toWire(region.outer));
      const holeWires = region.holes.map((hole) => scope.track(toWire(hole)));
      const profile = scope.track(unwrap(face(outerWire)));
      const withHoles =
        holeWires.length > 0 ? scope.track(addHoles(profile, holeWires)) : profile;
      const placed =
        startZ === 0
          ? withHoles
          : scope.track(translate(withHoles, [0, 0, startZ]));
      return scope.track(unwrap(extrude(placed, [0, 0, totalHeight])));
    });
    const solid =
      solids.length === 1
        ? solids[0]!
        : scope.track(unwrap(fuseAll(solids)));
    // The scope disposes the inputs and the original solid; the caller owns the
    // clone independently, which is what the prefix cache retains.
    const local = unwrap(clone(solid));
    if (!frame) return local;
    const moved = unwrap(applyMatrix(local, frameMatrix(frame)));
    local.delete();
    return moved;
  });
}

function frameMatrix(frame: PlaneFrame): Matrix4x4 {
  const { origin, normal, xAxis, yAxis } = frame;
  return [
    [xAxis[0], yAxis[0], normal[0], origin[0]],
    [xAxis[1], yAxis[1], normal[1], origin[1]],
    [xAxis[2], yAxis[2], normal[2], origin[2]],
    [0, 0, 0, 1],
  ];
}

/** Body extent along the thread's plane normal, relative to its origin. */
function extentAlongFrame(
  solid: Solid,
  frame: PlaneFrame,
): { min: number; max: number } {
  const bounds = getBounds(solid);
  const { origin, normal } = frame;
  let min = Infinity;
  let max = -Infinity;
  for (const x of [bounds.xMin, bounds.xMax]) {
    for (const y of [bounds.yMin, bounds.yMax]) {
      for (const z of [bounds.zMin, bounds.zMax]) {
        const distance =
          (x - origin[0]) * normal[0] +
          (y - origin[1]) * normal[1] +
          (z - origin[2]) * normal[2];
        if (distance < min) min = distance;
        if (distance > max) max = distance;
      }
    }
  }
  return Number.isFinite(min) && Number.isFinite(max)
    ? { min, max }
    : { min: 0, max: 1 };
}

/** Mesh the diff language for a previewed join/cut/intersect. */
function buildBooleanDiff(
  before: Solid,
  tool: Solid,
  after: Solid,
  operation: "join" | "cut" | "intersect",
): BodyDiff | null {
  let added: Solid | null = null;
  let removed: Solid | null = null;
  let ghost: Solid | null = null;
  let ghostA: Solid | null = null;
  let ghostB: Solid | null = null;
  try {
    if (operation === "join") {
      added = unwrap(cut(tool, before)) as Solid;
    } else if (operation === "cut") {
      removed = unwrap(cut(before, after)) as Solid;
      ghost = unwrap(cut(tool, after)) as Solid;
    } else {
      ghostA = unwrap(cut(before, after)) as Solid;
      ghostB = unwrap(cut(tool, after)) as Solid;
      if (isEmpty(ghostA)) {
        ghost = ghostB;
        ghostB = null;
      } else if (isEmpty(ghostB)) {
        ghost = ghostA;
        ghostA = null;
      } else {
        ghost = unwrap(fuse(ghostA, ghostB)) as Solid;
      }
    }
    const result: BodyDiff = {
      added: added && !isEmpty(added) ? diffMesh(added) : null,
      removed: removed && !isEmpty(removed) ? diffMesh(removed) : null,
      ghost: ghost && !isEmpty(ghost) ? diffMesh(ghost) : null,
    };
    return result.added || result.removed || result.ghost ? result : null;
  } catch {
    return null;
  } finally {
    added?.delete();
    removed?.delete();
    ghost?.delete();
    ghostA?.delete();
    ghostB?.delete();
  }
}

/**
 * Mesh the two sides of an offset preview: material the result adds over the
 * prefix and material it removes. Empty sides are omitted.
 */
function buildOffsetDiff(before: Solid, after: Solid): BodyDiff | null {
  let added: Solid | null = null;
  let removed: Solid | null = null;
  try {
    added = unwrap(cut(after, before)) as Solid;
    removed = unwrap(cut(before, after)) as Solid;
    const result: BodyDiff = {
      added: diffMesh(added),
      removed: diffMesh(removed),
    };
    return result.added || result.removed ? result : null;
  } catch {
    return null;
  } finally {
    added?.delete();
    removed?.delete();
  }
}

function diffMesh(solid: Solid): DiffMesh | null {
  try {
    if (isEmpty(solid)) return null;
    clearMeshCache();
    const mesh = shape(solid).mesh({ tolerance: 0.05 });
    const data = toBufferGeometryData(mesh);
    if (data.index.length === 0) return null;
    return {
      positions: data.position,
      normals: data.normal,
      indices: data.index,
    };
  } catch {
    return null;
  }
}

function meshSolid(solid: Solid, roles: RoleTable): BodyMesh {
  // A cached solid may still own mesh arrays whose buffers were transferred to
  // the main thread on a previous request. Force a fresh tessellation.
  clearMeshCache();
  const mesh = shape(solid).mesh({ tolerance: 0.05 });
  const data = toBufferGeometryData(mesh);
  const edgeMesh = shape(solid).meshEdges({ tolerance: 0.05 });
  const volume = unwrap(measureVolume(solid));
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < data.position.length; i += 3) {
    const x = data.position[i]!;
    const y = data.position[i + 1]!;
    const z = data.position[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const bodies = getSolids(solid).length;
  const shells = getShells(solid).length;
  const valid = isValid(solid);
  const refs = topoRefs(solid, roles);
  const edgeRefs = topoEdgeRefs(solid, refs);
  const faceGroups = mesh.faceGroups.map((group) => {
    const ref = refs.get(group.faceId);
    return {
      start: group.start,
      count: group.count,
      faceId: group.faceId,
      origin: group.origin,
      ...(ref ? { ref } : {}),
    };
  });
  const faceKeys = new Set(
    faceGroups.map((group) =>
      group.ref ? faceRefKey(group.ref) : `face:${group.faceId}`,
    ),
  );

  // Drop periodic/seam edges (no ref) and the edge between two same-domain
  // faces that now share one ref. Normalise the kept groups to segment units
  // so the viewer's heuristics stay unambiguous.
  const totalSegments = Math.floor(edgeMesh.lines.length / 6);
  const originalMaxEnd = edgeMesh.edgeGroups.length
    ? Math.max(...edgeMesh.edgeGroups.map((group) => group.start + group.count))
    : 0;
  const originalUnit: "segment" | "vertex" =
    edgeMesh.edgeGroups.length > 0 && originalMaxEnd > totalSegments
      ? "vertex"
      : "segment";
  const edgePositions: number[] = [];
  const edgeGroups: typeof edgeMesh.edgeGroups = [];
  let segmentStart = 0;
  for (const group of edgeMesh.edgeGroups) {
    const ref = edgeRefs.get(group.edgeId);
    const seam =
      !ref ||
      (ref.faces[0].source === ref.faces[1].source &&
        ref.faces[0].role === ref.faces[1].role);
    if (seam) continue;
    const range =
      originalUnit === "segment"
        ? { start: group.start * 2, count: group.count * 2 }
        : { start: group.start, count: group.count };
    for (let index = range.start; index < range.start + range.count; index += 1) {
      edgePositions.push(
        edgeMesh.lines[index * 3]!,
        edgeMesh.lines[index * 3 + 1]!,
        edgeMesh.lines[index * 3 + 2]!,
      );
    }
    const count =
      originalUnit === "segment" ? group.count : Math.floor(group.count / 2);
    edgeGroups.push({
      ...group,
      start: segmentStart,
      count,
      ...(ref ? { ref } : {}),
    });
    segmentStart += count;
  }
  return {
    positions: data.position,
    normals: data.normal,
    indices: data.index,
    faceGroups,
    edgePositions: new Float32Array(edgePositions),
    edgeGroups,
    stats: {
      faces: faceKeys.size,
      edges: edgeGroups.length,
      triangles: data.index.length / 3,
      volume,
      buildMs: 0,
      bodies,
      shells,
      valid,
      bounds: [minX, minY, minZ, maxX, maxY, maxZ],
    },
  };
}

/**
 * Turn each BREP edge into a JSON-safe ref identified by its two face roles.
 * The mesh's `edgeId` is the same `getHashCode(edge)` the kernel uses, verified
 * against `meshEdges` edge groups.
 */
function topoEdgeRefs(
  solid: Solid,
  faceRefs: ReadonlyMap<number, TopoRef>,
): Map<number, EdgeRef> {
  const refs = new Map<number, EdgeRef>();
  try {
    for (const edge of getEdges(solid)) {
      const faces = facesOfEdge(solid, edge);
      if (faces.length !== 2) continue;
      const a = faceRefs.get(getHashCode(faces[0]!));
      const b = faceRefs.get(getHashCode(faces[1]!));
      if (!a || !b) continue;
      const vertices = verticesOfEdge(edge).map((vertex) =>
        vertexPosition(vertex as Parameters<typeof vertexPosition>[0]),
      );
      const midpoint =
        vertices.length > 0
          ? vertices.reduce(
              (sum, point) => [
                sum[0] + point[0] / vertices.length,
                sum[1] + point[1] / vertices.length,
                sum[2] + point[2] / vertices.length,
              ],
              [0, 0, 0] as [number, number, number],
            )
          : undefined;
      refs.set(getHashCode(edge), {
        kind: "edge",
        faces: [a, b],
        hint: {
          entityType: "edge",
          ...(Number.isFinite(curveLength(edge))
            ? { length: curveLength(edge) }
            : {}),
          ...(midpoint
            ? { midpoint: [midpoint[0], midpoint[1], midpoint[2]] }
            : {}),
        },
      });
    }
  } catch {
    // Edge refs are additive metadata; a role failure must never break the mesh.
  }
  return refs;
}

/** Radius and inward/outward sign for a full cylindrical hole/boss wall. */
function cylinderHint(
  face: Parameters<typeof captureHint>[0],
): { radius?: number; radialSign?: 1 | -1 } {
  const type = String(faceGeomType(face as Face)).toUpperCase();
  if (!type.includes("CYL")) return {};
  const axis = faceAxis(face as Face);
  if (!axis) return {};
  const vertex = getVertices(face as Face)[0];
  if (!vertex) return {};
  const point = vertexPosition(vertex);
  const relative: Vec3 = [
    point[0] - axis.origin[0],
    point[1] - axis.origin[1],
    point[2] - axis.origin[2],
  ];
  const axial = dot(relative, axis.direction);
  const radial: Vec3 = [
    relative[0] - axis.direction[0] * axial,
    relative[1] - axis.direction[1] * axial,
    relative[2] - axis.direction[2] * axial,
  ];
  const radius = Math.hypot(radial[0], radial[1], radial[2]);
  if (!(radius > 1e-9)) return {};
  const normal = normalAt(face as Face, point);
  return {
    radius,
    radialSign: dot(normal, scale(radial, 1 / radius)) >= 0 ? 1 : -1,
  };
}

/** Same analytic surface: a split face that `unifySameDomain` left behind. */
function sameDomainFace(
  a: Parameters<typeof captureHint>[0],
  b: Parameters<typeof captureHint>[0],
): boolean {
  const typeA = String(faceGeomType(a as Face)).toUpperCase();
  const typeB = String(faceGeomType(b as Face)).toUpperCase();
  if (typeA.includes("CYL") && typeB.includes("CYL")) {
    const ca = cylinderHint(a);
    const cb = cylinderHint(b);
    if (
      ca.radius === undefined ||
      cb.radius === undefined ||
      Math.abs(ca.radius - cb.radius) > 1e-3 ||
      ca.radialSign !== cb.radialSign
    ) {
      return false;
    }
    const axisA = faceAxis(a as Face);
    const axisB = faceAxis(b as Face);
    if (!axisA || !axisB) return false;
    const directionA = unit(axisA.direction);
    const directionB = unit(axisB.direction);
    if (Math.abs(dot(directionA, directionB)) < 0.999) return false;
    const relative: Vec3 = [
      axisB.origin[0] - axisA.origin[0],
      axisB.origin[1] - axisA.origin[1],
      axisB.origin[2] - axisA.origin[2],
    ];
    const axial = dot(relative, directionA);
    const radial: Vec3 = [
      relative[0] - directionA[0] * axial,
      relative[1] - directionA[1] * axial,
      relative[2] - directionA[2] * axial,
    ];
    return Math.hypot(radial[0], radial[1], radial[2]) < 1e-3;
  }
  if (typeA.includes("PLANE") && typeB.includes("PLANE")) {
    const hintA = captureHint(a);
    const hintB = captureHint(b);
    if (
      !hintA.normal ||
      !hintB.normal ||
      !hintA.centroid ||
      !hintB.centroid ||
      Math.abs(dot(unit(hintA.normal), unit(hintB.normal))) < 0.999
    ) {
      return false;
    }
    const relative: Vec3 = [
      hintB.centroid[0] - hintA.centroid[0],
      hintB.centroid[1] - hintA.centroid[1],
      hintB.centroid[2] - hintA.centroid[2],
    ];
    return Math.abs(dot(unit(hintA.normal), relative)) < 1e-3;
  }
  return false;
}

/** Turn the propagated role table into JSON-safe refs for the final body. */
function topoRefs(solid: Solid, roles: RoleTable): Map<number, TopoRef> {
  const refs = new Map<number, TopoRef>();
  try {
    type Face3D = Parameters<typeof captureHint>[0];
    const faceByHash = new Map<number, Face3D>();
    for (const face of getFaces(solid)) {
      faceByHash.set(getHashCode(face), face as Face3D);
    }
    for (const [source, originRoles] of roles) {
      for (const [role, hashes] of originRoles) {
        for (const hash of hashes) {
          const face = faceByHash.get(hash);
          if (!face) continue;
          const hint = captureHint(face);
          const ref = createRef(source, role, face);
          refs.set(hash, {
            source: ref.origin,
            kind: "face",
            role: ref.role,
            hint: {
              entityType: "face",
              ...(hint.surfaceType
                ? { surfaceType: String(hint.surfaceType) }
                : {}),
              ...(hint.normal
                ? { normal: [hint.normal[0], hint.normal[1], hint.normal[2]] }
                : {}),
              ...(hint.centroid
                ? {
                    centroid: [
                      hint.centroid[0],
                      hint.centroid[1],
                      hint.centroid[2],
                    ],
                  }
                : {}),
              ...(hint.area !== undefined ? { area: hint.area } : {}),
              ...cylinderHint(face),
            },
          });
        }
      }
    }
    // `unifySameDomain` occasionally leaves one same-domain cylindrical face
    // split after a planar offset. Coalesce adjacent same-surface faces so the
    // two groups share one ref, the seam edge is hidden, and the face count is
    // the logical one. The larger face supplies the canonical role.
    const parent = new Map<number, number>();
    for (const hash of faceByHash.keys()) parent.set(hash, hash);
    const find = (hash: number): number => {
      const up = parent.get(hash);
      if (up === undefined || up === hash) {
        parent.set(hash, hash);
        return hash;
      }
      const root = find(up);
      parent.set(hash, root);
      return root;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const edge of getEdges(solid)) {
      const faces = facesOfEdge(solid, edge);
      if (faces.length !== 2) continue;
      const a = faces[0]!;
      const b = faces[1]!;
      if (
        !sameDomainFace(a as unknown as Face, b as unknown as Face)
      ) {
        continue;
      }
      union(getHashCode(a), getHashCode(b));
    }
    const groups = new Map<number, number[]>();
    for (const hash of faceByHash.keys()) {
      const root = find(hash);
      const list = groups.get(root) ?? [];
      list.push(hash);
      groups.set(root, list);
    }
    for (const hashes of groups.values()) {
      if (hashes.length < 2) continue;
      let canonical: number | null = null;
      let canonicalArea = -Infinity;
      for (const hash of hashes) {
        const ref = refs.get(hash);
        if (!ref) continue;
        const area = captureHint(faceByHash.get(hash)!).area ?? 0;
        if (area > canonicalArea) {
          canonical = hash;
          canonicalArea = area;
        }
      }
      if (canonical === null) continue;
      const ref = refs.get(canonical)!;
      for (const hash of hashes) refs.set(hash, ref);
    }
  } catch {
    // Refs are additive metadata; a role failure must never break the mesh.
  }
  return refs;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PrefixEntry {
  solid: Solid;
  /** Stable face roles, propagated through each boolean with `updateRoles`. */
  roles: RoleTable;
}

class SolidCache {
  private readonly entries = new Map<string, PrefixEntry>();
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get(key: string): PrefixEntry | undefined {
    return this.entries.get(key);
  }

  set(
    key: string,
    entry: PrefixEntry,
    protectedKeys: ReadonlySet<string>,
  ): void {
    const existing = this.entries.get(key);
    if (existing?.solid === entry.solid) return;
    if (existing && !protectedKeys.has(key)) existing.solid.delete();
    this.entries.set(key, entry);
    this.trim(protectedKeys);
  }

  clear(): void {
    for (const entry of this.entries.values()) entry.solid.delete();
    this.entries.clear();
  }

  trim(protectedKeys: ReadonlySet<string>): void {
    while (this.entries.size > this.limit) {
      let victim: string | null = null;
      for (const key of this.entries.keys()) {
        if (!protectedKeys.has(key)) {
          victim = key;
          break;
        }
      }
      if (victim === null) return;
      const entry = this.entries.get(victim);
      this.entries.delete(victim);
      entry?.solid.delete();
    }
  }
}

const solidCache = new SolidCache(24);

function toWire(loop: ProfileLoop): ClosedWire & PlanarWire {
  if (loop.kind === "circle") {
    const [cx, cy] = loop.center;
    const wire = unwrap(wireLoop([circle(loop.radius, { at: [cx, cy, 0] })]));
    return asPlanar(wire);
  }

  if (loop.kind === "path") {
    const edges = loop.segments.map((segment) => {
      if (segment.kind === "line") {
        return line([segment.a[0], segment.a[1], 0], [segment.b[0], segment.b[1], 0]);
      }
      return threePointArc(
        [segment.start[0], segment.start[1], 0],
        [segment.mid[0], segment.mid[1], 0],
        [segment.end[0], segment.end[1], 0],
      );
    });
    if (edges.length < 2) {
      throw new Error("A profile loop needs at least two edges.");
    }
    return asPlanar(unwrap(wireLoop(edges)));
  }

  if (loop.points.length < 3) {
    throw new Error("A profile loop needs at least three points.");
  }

  const points = counterClockwise(loop.points);
  const edges = points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    return line([point[0], point[1], 0], [next[0], next[1], 0]);
  });
  return asPlanar(unwrap(wireLoop(edges)));
}

/**
 * OCCT silently produces the wrong solid when a hole crosses the outer
 * boundary (it keeps the hole's cylinder instead of the plate). Catch that
 * here with a clear message instead of showing broken geometry.
 */
function validateRegion(region: ProfileRegion): void {
  const outer = region.outer;
  if (outer.kind === "circle") {
    for (const hole of region.holes) {
      if (hole.kind === "circle") {
        const gap = Math.hypot(
          hole.center[0] - outer.center[0],
          hole.center[1] - outer.center[1],
        );
        if (gap + hole.radius >= outer.radius - 1e-6) {
          throw new Error(
            `Hole Ø${(hole.radius * 2).toFixed(1)} crosses the outer circle (clearance ${(outer.radius - gap - hole.radius).toFixed(1)} mm).`,
          );
        }
        continue;
      }
      for (const point of hole.points) {
        const distance = Math.hypot(
          point[0] - outer.center[0],
          point[1] - outer.center[1],
        );
        if (distance >= outer.radius - 1e-6) {
          throw new Error("A hole crosses the outer circle.");
        }
      }
    }
    return;
  }

  for (const hole of region.holes) {
    if (hole.kind !== "circle") {
      for (const point of hole.points) {
        if (!pointInPolygon(point, outer.points)) {
          throw new Error("A hole is outside the profile boundary.");
        }
      }
      continue;
    }
    const { center, radius } = hole;
    if (!pointInPolygon(center, outer.points)) {
      throw new Error(
        `Hole Ø${(radius * 2).toFixed(1)} at (${center[0].toFixed(1)}, ${center[1].toFixed(1)}) is outside the profile boundary.`,
      );
    }
    let clearance = Infinity;
    for (let i = 0; i < outer.points.length; i++) {
      const a = outer.points[i]!;
      const b = outer.points[(i + 1) % outer.points.length]!;
      clearance = Math.min(clearance, distanceToSegment(center, a, b));
    }
    if (clearance <= radius + 1e-6) {
      throw new Error(
        `Hole Ø${(radius * 2).toFixed(1)} at (${center[0].toFixed(1)}, ${center[1].toFixed(1)}) crosses the profile boundary (clearance ${clearance.toFixed(1)} mm).`,
      );
    }
  }
}

function pointInPolygon(point: readonly [number, number], polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function distanceToSegment(
  point: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq),
  );
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

/**
 * Every loop we build lies in z = 0 by construction, so closedness implies
 * planarity. The `PlanarWire` brand is a type-level only proof.
 */
function asPlanar(wire: ClosedWire): ClosedWire & PlanarWire {
  return wire as ClosedWire & PlanarWire;
}

function counterClockwise(points: readonly (readonly [number, number])[]) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!;
    const next = points[(i + 1) % points.length]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area < 0 ? [...points].reverse() : [...points];
}
