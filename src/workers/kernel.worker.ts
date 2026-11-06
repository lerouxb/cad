import {
  OcctWasmAdapter,
  addHoles,
  adjacentFaces,
  assignRoles,
  applyMatrix,
  captureHint,
  chamferWithEvolution,
  circle,
  classifyPointOnFace,
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
  facesOfEdge,
  filletWithEvolution,
  fuseAll,
  fuseWithEvolution,
  getBounds,
  getCurveType,
  getEdges,
  getFaces,
  getHashCode,
  getShells,
  getSolids,
  innerWires,
  isValid,
  line,
  measureVolume,
  outerWire,
  registerKernel,
  projectPointOnFace,
  resolveRef,
  shape,
  shellWithEvolution,
  sharedEdges,
  threePointArc,
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
  type Solid,
  type ValidSolid,
} from "brepjs";
import { OcctKernel } from "occt-wasm";
import type { PlaneFrame } from "../core/types";
import type {
  BodyMesh,
  EdgeRef,
  ExtrudeParams,
  FeatureBuildStatus,
  KernelEdgeBlendFeature,
  KernelFeature,
  KernelShellFeature,
  KernelRequest,
  ProfileRegion,
  KernelResponse,
  ProfileLoop,
  TopoRef,
} from "../core/kernel/protocol";

// This file only runs inside a dedicated worker.
declare const self: DedicatedWorkerGlobalScope;

let kernelReady: Promise<void> | null = null;

function ensureKernel(): Promise<void> {
  kernelReady ??= (async () => {
    const kernel = await OcctKernel.init();
    registerKernel("occt-wasm", OcctWasmAdapter.fromKernel(kernel));
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
    reply(
      { type: "result", gen: request.gen, mesh, features: built.features },
      [
        mesh.positions.buffer as ArrayBuffer,
        mesh.normals.buffer as ArrayBuffer,
        mesh.indices.buffer as ArrayBuffer,
        mesh.edgePositions.buffer as ArrayBuffer,
      ],
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

function buildFeatures(features: KernelFeature[]): {
  mesh: BodyMesh | null;
  features: FeatureBuildStatus[];
} {
  const statuses: FeatureBuildStatus[] = [];
  const protectedKeys = new Set<string>();
  const pending: Array<PrefixEntry & { key: string }> = [];
  let base: Solid | null = null;
  let baseKey: string | null = null;
  let baseRoles: RoleTable = new Map();
  let cacheInvalid = false;

  for (const feature of features) {
    const cached = solidCache.get(feature.cacheKey);
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
      feature.kind === "shell"
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
            : buildEdgeBlendFeature(feature, base, baseRoles);
        base = result.solid;
        baseRoles = result.roles;
        baseKey = feature.cacheKey;
        protectedKeys.add(feature.cacheKey);
        pending.push({
          key: feature.cacheKey,
          solid: result.solid,
          roles: result.roles,
        });
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
      if (feature.params.end === "throughAll" && feature.operation !== "cut") {
        throw new Error("Through-all is only available for a cut extrude.");
      }
      tool = buildSolid(feature.params, base);
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
        if (feature.operation === "cut") {
          tool.delete();
          cacheInvalid = true;
          statuses.push({
            featureId: feature.featureId,
            status: "error",
            cached: false,
            message: "Nothing exists to cut.",
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
          [feature.featureId, assignRoles(tool, "extrude")],
        ]);
        baseKey = feature.cacheKey;
        protectedKeys.add(feature.cacheKey);
        pending.push({
          key: feature.cacheKey,
          solid: tool,
          roles: baseRoles,
        });
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
        [feature.featureId, assignRoles(tool, "extrude")],
      ]);
      const result = unwrap(
        feature.operation === "cut"
          ? cutWithEvolution(base, tool)
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
      pending.push({
        key: feature.cacheKey,
        solid: resultSolid,
        roles,
      });
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
  faceMap: ReadonlyMap<number, Face | null>;
  /** Result face hashes already accounted for by a carried-over role. */
  claimed: ReadonlySet<number>;
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
  return {
    positions: data.position,
    normals: data.normal,
    indices: data.index,
    faceGroups: mesh.faceGroups.map((group) => {
      const ref = refs.get(group.faceId);
      return {
        start: group.start,
        count: group.count,
        faceId: group.faceId,
        origin: group.origin,
        ...(ref ? { ref } : {}),
      };
    }),
    edgePositions: edgeMesh.lines,
    edgeGroups: edgeMesh.edgeGroups.map((group) => {
      const ref = edgeRefs.get(group.edgeId);
      return {
        start: group.start,
        count: group.count,
        edgeId: group.edgeId,
        ...(ref ? { ref } : {}),
      };
    }),
    stats: {
      faces: mesh.faceGroups.length,
      edges: edgeMesh.edgeGroups.length,
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
            },
          });
        }
      }
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
