import {
  OcctWasmAdapter,
  addHoles,
  assignRoles,
  applyMatrix,
  captureHint,
  circle,
  clearMeshCache,
  clone,
  createRef,
  curveLength,
  curvePointAt,
  cutWithEvolution,
  extrude,
  face,
  fuseAll,
  fuseWithEvolution,
  getBounds,
  getCurveType,
  getEdges,
  getFaces,
  getHashCode,
  innerWires,
  line,
  measureVolume,
  outerWire,
  registerKernel,
  resolveRef,
  shape,
  threePointArc,
  toBufferGeometryData,
  translate,
  updateRoles,
  unwrap,
  wireLoop,
  withScope,
  type ClosedWire,
  type Matrix4x4,
  type PlanarWire,
  type RoleTable,
  type Solid,
} from "brepjs";
import { OcctKernel } from "occt-wasm";
import type { PlaneFrame } from "../core/types";
import type {
  BodyMesh,
  ExtrudeParams,
  FeatureBuildStatus,
  KernelFeature,
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
      tool.delete();
      // A boolean of two solids is a solid; brepjs's widest overload returns
      // Shape3D, so narrow it here before caching.
      const resultSolid = result.shape as Solid;
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
    if (!("face" in resolved)) return { broken: resolved.reason };
    const face = resolved.face;
    const hint = captureHint(face as Parameters<typeof captureHint>[0]);
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
      confidence: resolved.confidence,
    };
  } catch {
    return null;
  }
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

  const refs = topoRefs(solid, roles);
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
    edgeGroups: edgeMesh.edgeGroups.map((group) => ({
      start: group.start,
      count: group.count,
      edgeId: group.edgeId,
    })),
    stats: {
      faces: mesh.faceGroups.length,
      edges: edgeMesh.edgeGroups.length,
      triangles: data.index.length / 3,
      volume,
      buildMs: 0,
      bounds: [minX, minY, minZ, maxX, maxY, maxZ],
    },
  };
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
