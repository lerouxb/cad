import type {
  BodyMesh,
  FeatureBuildStatus,
  KernelFeature,
  KernelRequest,
  KernelResponse,
} from "./protocol";

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

  dispose(): void {
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
    }
  }

  private post(message: KernelRequest): void {
    this.worker.postMessage(message);
  }
}
