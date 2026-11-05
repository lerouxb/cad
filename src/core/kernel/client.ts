import type {
  BodyMesh,
  ExportFormat,
  FeatureBuildStatus,
  KernelFeature,
  KernelRequest,
  KernelResponse,
} from "./protocol";
import type { TopoRef } from "./protocol";
import type { Vec3 } from "../types";

export interface KernelClientHandlers {
  onReady?: () => void;
  onMesh?: (
    mesh: BodyMesh,
    roundTripMs: number,
    features: FeatureBuildStatus[],
  ) => void;
  onError?: (message: string, features?: FeatureBuildStatus[]) => void;
}

/**
 * Main-thread handle for the OCCT worker.
 *
 * Rebuilds are "latest wins": while a build is in flight, newer requests
 * replace each other, and stale results are dropped. That keeps a slider drag
 * from queueing dozens of booleans.
 */
export class KernelClient {
  private worker: Worker;
  private handlers: KernelClientHandlers;
  private ready = false;
  private inFlight = false;
  private pending: KernelFeature[] | null = null;
  private latestGen = 0;
  private sentAt = 0;
  private boundaryRequests = new Map<
    number,
    {
      resolve: (value: {
        normal: Vec3;
        centroid: Vec3;
        loops: Vec3[][];
        confidence: "exact" | "geometric-fallback";
      }) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextBoundaryId = 1;
  private exportRequests = new Map<
    number,
    {
      resolve: (data: ArrayBuffer) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextExportId = 1;

  constructor(handlers: KernelClientHandlers = {}) {
    this.handlers = handlers;
    this.worker = new Worker(new URL("../../workers/kernel.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<KernelResponse>) => {
      this.receive(event.data);
    };
    this.worker.onerror = (event) => {
      this.handlers.onError?.(event.message || "The geometry worker crashed.");
    };
    this.post({ type: "init" });
  }

  /** Rebuild the ordered solid feature list. Latest request wins. */
  rebuild(features: readonly KernelFeature[]): void {
    this.pending = [...features];
    this.latestGen += 1;
    this.pump();
  }

  /**
   * Resolve the boundary of a face on a cached prefix solid. Used to keep
   * projected sketch references attached to the body that produced the face,
   * rather than to downstream geometry.
   */
  requestFaceBoundary(
    cacheKey: string,
    ref: TopoRef,
  ): Promise<{
    normal: Vec3;
    centroid: Vec3;
    loops: Vec3[][];
    confidence: "exact" | "geometric-fallback";
  }> {
    const requestId = this.nextBoundaryId++;
    return new Promise((resolve, reject) => {
      this.boundaryRequests.set(requestId, { resolve, reject });
      this.post({ type: "faceBoundary", requestId, cacheKey, ref });
    });
  }

  /**
   * Export the cached prefix solid as a file. The caller passes the final
   * feature's cacheKey from the rendered rebuild, so the file always matches
   * the body on screen (not a stale or in-flight mesh).
   */
  exportSolid(format: ExportFormat, cacheKey: string): Promise<ArrayBuffer> {
    const requestId = this.nextExportId++;
    return new Promise((resolve, reject) => {
      this.exportRequests.set(requestId, { resolve, reject });
      this.post({
        type: "export",
        requestId,
        format,
        cacheKey,
      });
    });
  }

  dispose(): void {
    for (const pending of this.exportRequests.values()) {
      pending.reject(new Error("The geometry worker was disposed."));
    }
    this.exportRequests.clear();
    this.worker.terminate();
  }

  private pump(): void {
    if (!this.ready || this.inFlight || !this.pending) return;
    const features = this.pending;
    this.pending = null;
    this.inFlight = true;
    this.sentAt = performance.now();
    this.post({ type: "rebuild", gen: this.latestGen, features });
  }

  private receive(message: KernelResponse): void {
    switch (message.type) {
      case "ready":
        this.ready = true;
        this.handlers.onReady?.();
        this.pump();
        break;
      case "result": {
        this.inFlight = false;
        if (message.gen === this.latestGen) {
          this.handlers.onMesh?.(
            message.mesh,
            performance.now() - this.sentAt,
            message.features,
          );
        }
        this.pump();
        break;
      }
      case "error":
        this.inFlight = false;
        this.handlers.onError?.(message.message, message.features);
        this.pump();
        break;
      case "faceBoundary": {
        const pending = this.boundaryRequests.get(message.requestId);
        if (!pending) break;
        this.boundaryRequests.delete(message.requestId);
        if (message.ok && message.normal && message.centroid && message.loops) {
          pending.resolve({
            normal: message.normal,
            centroid: message.centroid,
            loops: message.loops,
            confidence: message.confidence ?? "exact",
          });
        } else {
          pending.reject(
            new Error(message.message ?? "The face boundary could not be resolved."),
          );
        }
        break;
      }
      case "exported": {
        const pending = this.exportRequests.get(message.requestId);
        if (!pending) break;
        this.exportRequests.delete(message.requestId);
        pending.resolve(message.data);
        break;
      }
      case "exportError": {
        const pending = this.exportRequests.get(message.requestId);
        if (!pending) break;
        this.exportRequests.delete(message.requestId);
        pending.reject(new Error(message.message));
        break;
      }
    }
  }

  private post(message: KernelRequest): void {
    this.worker.postMessage(message);
  }
}
