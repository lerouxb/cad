import type { BodyStats } from "../core/kernel/protocol";
import { StagePopover, type PopoverPosition } from "./StagePopover";

/**
 * Default printer envelope. A document/profile setting can replace this later;
 * the check is informational, it does not gate the export (a slicer can split).
 */
export const BUILD_VOLUME_MM = [220, 220, 250] as const;

interface ExportPopoverProps {
  stats: BodyStats;
  /** Suggested file name, e.g. `Example.stl`. */
  fileName: string;
  /** Which action is in flight, if any. */
  busy: "stl" | "step" | null;
  error: string | null;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onExport: (format: "stl" | "step") => void;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `≈ ${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `≈ ${Math.round(bytes / 1024)} KB`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * The export page from mockup 05: the body it will produce, real health checks,
 * the binary STL size, and one quiet export action. The mesh is generated from
 * the B-rep at export time; nothing here is a frozen snapshot.
 */
export function ExportPopover({
  stats,
  fileName,
  busy,
  error,
  position,
  onMove,
  onExport,
  onClose,
}: ExportPopoverProps) {
  const dims = [
    stats.bounds[3] - stats.bounds[0],
    stats.bounds[4] - stats.bounds[1],
    stats.bounds[5] - stats.bounds[2],
  ];
  const fits = dims.every(
    (size, index) => size <= BUILD_VOLUME_MM[index]! + 1e-6,
  );
  const healthy = stats.valid;
  const stlBytes = 84 + 50 * stats.triangles;
  const bodyCount = plural(stats.bodies, "body");
  const shellCount = plural(stats.shells, "shell");

  return (
    <StagePopover
      kicker="export"
      title="Export STL"
      testId="export-page"
      position={position}
      onMove={onMove}
      hint="The mesh is generated from the exact B-rep when you export. Sketches and history stay in the .cad file."
      summary={
        busy
          ? "generating…"
          : `${fileName} · ${formatBytes(stlBytes)}`
      }
      cancel={{
        label: "close",
        onClick: onClose,
        testId: "export-page-close",
      }}
      secondary={{
        label: busy === "step" ? "exporting…" : "export STEP",
        onClick: () => onExport("step"),
        testId: "export-page-step",
        disabled: !healthy || busy !== null,
      }}
      primary={{
        label: busy === "stl" ? "exporting…" : "export STL →",
        onClick: () => onExport("stl"),
        testId: "export-page-stl",
        disabled: !healthy || busy !== null,
      }}
    >
      <div className="feature-row">
        <span className="detail-key">body</span>
        <span className="detail-value" data-testid="export-page-body">
          {bodyCount} · {healthy ? "watertight" : "invalid"}
        </span>
      </div>
      <div className="feature-row">
        <span className="detail-key">volume</span>
        <span className="detail-value">
          {stats.volume.toFixed(1)} mm³
        </span>
      </div>
      <div className="feature-row">
        <span className="detail-key">triangles</span>
        <span className="detail-value">
          {stats.triangles.toLocaleString("en-US")}
        </span>
      </div>
      <div className="feature-row">
        <span className="detail-key">units</span>
        <span className="detail-value">millimetres</span>
      </div>
      <div className="feature-row">
        <span className="detail-key">scale</span>
        <span className="detail-value">1:1</span>
      </div>
      <div className="feature-row">
        <span className="detail-key">file</span>
        <span className="detail-value" data-testid="export-page-size">
          {formatBytes(stlBytes)}
        </span>
      </div>

      <div className="export-checks">
        <span
          className={`export-check${fits ? "" : " is-warn"}`}
          data-testid="export-page-fit"
          data-fits={fits}
        >
          {fits ? "fits" : "larger than"} {BUILD_VOLUME_MM.join(" × ")} mm build
          volume
        </span>
        <span
          className={`export-check${healthy ? "" : " is-warn"}`}
          data-testid="export-page-checks"
          data-valid={stats.valid}
        >
          {shellCount} ·{" "}
          {healthy ? "no open edges · outward normals" : "check open edges and normals"}
        </span>
        {error ? (
          <span className="export-check is-warn" data-testid="export-page-error">
            {error}
          </span>
        ) : null}
      </div>
    </StagePopover>
  );
}
