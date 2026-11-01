import {
  OcctWasmAdapter,
  addHoles,
  circle,
  clearMeshCache,
  clone,
  cut,
  extrude,
  face,
  fuse,
  fuseAll,
  line,
  measureVolume,
  registerKernel,
  shape,
  threePointArc,
  toBufferGeometryData,
  unwrap,
  wireLoop,
  withScope,
  type ClosedWire,
  type PlanarWire,
  type Solid,
} from "brepjs";
import { OcctKernel } from "occt-wasm";
import type {
  BodyMesh,
  ExtrudeParams,
  FeatureBuildStatus,
  KernelFeature,
  KernelRequest,
  ProfileRegion,
  KernelResponse,
  ProfileLoop,
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
  const pending: { key: string; solid: Solid }[] = [];
  let base: Solid | null = null;
  let baseKey: string | null = null;
  let cacheInvalid = false;

  for (const feature of features) {
    const cached = solidCache.get(feature.cacheKey);
    if (cached) {
      base = cached;
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
      tool = buildSolid(feature.params);
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
        baseKey = feature.cacheKey;
        protectedKeys.add(feature.cacheKey);
        pending.push({ key: feature.cacheKey, solid: tool });
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

      const result = unwrap(
        feature.operation === "cut" ? cut(base, tool) : fuse(base, tool),
      );
      tool.delete();
      base = result;
      baseKey = feature.cacheKey;
      protectedKeys.add(feature.cacheKey);
      pending.push({ key: feature.cacheKey, solid: result });
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
  const mesh = base ? meshSolid(base) : null;

  if (cacheInvalid) {
    // A transient boolean failure must not leave downstream prefix solids that
    // were built as if the failed feature had been skipped. Dispose everything
    // and force a clean retry next time.
    for (const entry of pending) entry.solid.delete();
    solidCache.clear();
  } else {
    for (const entry of pending) solidCache.set(entry.key, entry.solid, protectedKeys);
    solidCache.trim(protectedKeys);
  }

  return { mesh, features: statuses };
}

/** Build one tool solid and return an independently owned clone. */
function buildSolid(params: ExtrudeParams): Solid {
  if (!Number.isFinite(params.height) || params.height <= 0) {
    throw new Error("Extrude height must be greater than zero.");
  }
  if (params.regions.length === 0) {
    throw new Error("Select at least one profile region.");
  }
  for (const region of params.regions) validateRegion(region);

  return withScope((scope) => {
    const solids = params.regions.map((region) => {
      const outerWire = scope.track(toWire(region.outer));
      const holeWires = region.holes.map((hole) => scope.track(toWire(hole)));
      const profile = scope.track(unwrap(face(outerWire)));
      const withHoles =
        holeWires.length > 0 ? scope.track(addHoles(profile, holeWires)) : profile;
      return scope.track(unwrap(extrude(withHoles, [0, 0, params.height])));
    });
    const solid =
      solids.length === 1
        ? solids[0]!
        : scope.track(unwrap(fuseAll(solids)));
    // The scope disposes the inputs and the original solid; the caller owns the
    // clone independently, which is what the prefix cache retains.
    return unwrap(clone(solid));
  });
}

function meshSolid(solid: Solid): BodyMesh {
  // A cached solid may still own mesh arrays whose buffers were transferred to
  // the main thread on a previous request. Force a fresh tessellation.
  clearMeshCache();
  const mesh = shape(solid).mesh({ tolerance: 0.05 });
  const data = toBufferGeometryData(mesh);
  const edgeMesh = shape(solid).meshEdges({ tolerance: 0.05 });
  const volume = unwrap(measureVolume(solid));

  return {
    positions: data.position,
    normals: data.normal,
    indices: data.index,
    faceGroups: mesh.faceGroups.map((group) => ({
      start: group.start,
      count: group.count,
      faceId: group.faceId,
      origin: group.origin,
    })),
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
    },
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class SolidCache {
  private readonly entries = new Map<string, Solid>();
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  get(key: string): Solid | undefined {
    return this.entries.get(key);
  }

  set(key: string, solid: Solid, protectedKeys: ReadonlySet<string>): void {
    const existing = this.entries.get(key);
    if (existing === solid) return;
    if (existing && !protectedKeys.has(key)) existing.delete();
    this.entries.set(key, solid);
    this.trim(protectedKeys);
  }

  clear(): void {
    for (const solid of this.entries.values()) solid.delete();
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
      const solid = this.entries.get(victim);
      this.entries.delete(victim);
      solid?.delete();
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
