import {
  OcctWasmAdapter,
  addHoles,
  circle,
  extrude,
  face,
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
} from "brepjs";
import { OcctKernel } from "occt-wasm";
import type {
  BodyMesh,
  ExtrudeParams,
  KernelRequest,
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
    const mesh = buildBody(request.params);
    mesh.stats.buildMs = performance.now() - started;
    reply(
      { type: "result", gen: request.gen, mesh },
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

function buildBody(params: ExtrudeParams): BodyMesh {
  if (params.height <= 0) throw new Error("Extrude height must be greater than zero.");
  validateProfile(params);

  return withScope((scope) => {
    const outerWire = scope.track(toWire(params.outer));
    const holeWires = params.holes.map((hole) => scope.track(toWire(hole)));
    const profile = scope.track(unwrap(face(outerWire)));
    const withHoles =
      holeWires.length > 0 ? scope.track(addHoles(profile, holeWires)) : profile;
    const solid = scope.track(unwrap(extrude(withHoles, [0, 0, params.height])));

    // Meshing returns plain typed arrays; everything kernel-side stays in scope.
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
  });
}

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
function validateProfile(params: ExtrudeParams): void {
  const outer = params.outer;
  if (outer.kind === "circle") {
    for (const hole of params.holes) {
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

  for (const hole of params.holes) {
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
