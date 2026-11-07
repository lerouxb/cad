import type { MeasureResult } from "../core/kernel/protocol";
import { formatLength } from "../core/format";
import type { BodyPick } from "../viewer/Viewport";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface MeasurePopoverProps {
  /** The face/edge picks to measure; empty means the whole body. */
  targets: readonly BodyPick[];
  result: MeasureResult | null;
  busy: boolean;
  error: string | null;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onClear: () => void;
  onClose: () => void;
}

function mm(value: number): string {
  return `${formatLength(value)} mm`;
}

/** A coordinate at one decimal, without negative zero or float fuzz. */
function coordinate(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return formatLength(Object.is(rounded, -0) ? 0 : rounded);
}

function targetLabel(pick: BodyPick, index: number): string {
  if (pick.kind === "face") {
    const surface = pick.ref?.hint.surfaceType?.toLowerCase() ?? "face";
    return `Face ${index + 1} · ${surface}`;
  }
  return `Edge ${index + 1}`;
}

/**
 * The measure readout. It is a mode, not a selection: up to two faces/edges,
 * measured exactly by the kernel, with the body's own properties when nothing
 * is picked. Never in the document.
 */
export function MeasurePopover({
  targets,
  result,
  busy,
  error,
  position,
  onMove,
  onClear,
  onClose,
}: MeasurePopoverProps) {
  const count = targets.length;
  const summary = busy
    ? "measuring…"
    : error
      ? "measurement failed"
      : count === 0
        ? "whole body"
        : `${count} target${count === 1 ? "" : "s"}`;
  const has = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value);

  return (
    <StagePopover
      kicker="measure"
      title="Measure"
      testId="measure-popover"
      dataCount={count}
      dataAttributes={{
        "data-targets": JSON.stringify(
          targets.map((target) =>
            target.kind === "face"
              ? { kind: "face", ref: target.ref }
              : { kind: "edge", ref: target.edgeRef },
          ),
        ),
      }}
      position={position}
      onMove={onMove}
      hint="click a face or edge; up to two. Click a picked one again to remove it."
      summary={summary}
      destructive={{
        label: "clear",
        onClick: onClear,
        testId: "measure-clear",
        disabled: count === 0,
      }}
      cancel={{ label: "close", onClick: onClose, testId: "measure-close" }}
    >
      {targets.length > 0 ? (
        <div className="selection-list" data-testid="measure-targets">
          {targets.map((target, index) => (
            <div className="selection-item" key={target.id}>
              <span>{targetLabel(target, index)}</span>
              <span className="mono">
                {target.kind === "edge" && target.edgeRef?.hint.length !== undefined
                  ? mm(target.edgeRef.hint.length)
                  : target.ref?.hint.area !== undefined
                    ? `${formatLength(target.ref.hint.area)} mm²`
                    : "—"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {has(result?.volume) ? (
        <div className="feature-row">
          <span className="detail-key">volume</span>
          <span className="detail-value" data-testid="measure-volume">
            {formatLength(result.volume)} mm³
          </span>
        </div>
      ) : null}
      {has(result?.area) ? (
        <div className="feature-row">
          <span className="detail-key">
            {count === 0 ? "surface area" : "area"}
          </span>
          <span className="detail-value" data-testid="measure-area">
            {formatLength(result.area)} mm²
          </span>
        </div>
      ) : null}
      {has(result?.perimeter) ? (
        <div className="feature-row">
          <span className="detail-key">perimeter</span>
          <span className="detail-value" data-testid="measure-perimeter">
            {mm(result.perimeter)}
          </span>
        </div>
      ) : null}
      {has(result?.length) ? (
        <div className="feature-row">
          <span className="detail-key">length</span>
          <span className="detail-value" data-testid="measure-length">
            {mm(result.length)}
          </span>
        </div>
      ) : null}
      {has(result?.radius) ? (
        <div className="feature-row">
          <span className="detail-key">radius</span>
          <span className="detail-value" data-testid="measure-radius">
            {mm(result.radius)}
          </span>
        </div>
      ) : null}
      {has(result?.distance) ? (
        <div className="feature-row">
          <span className="detail-key">distance</span>
          <span className="detail-value" data-testid="measure-distance">
            {mm(result.distance)}
          </span>
        </div>
      ) : null}
      {has(result?.angle) ? (
        <div className="feature-row">
          <span className="detail-key">angle</span>
          <span className="detail-value" data-testid="measure-angle">
            {formatLength(result.angle)}°
          </span>
        </div>
      ) : null}
      {result?.centerOfMass ? (
        <div className="feature-row">
          <span className="detail-key">centre</span>
          <span className="detail-value mono" data-testid="measure-center">
            {result.centerOfMass.map(coordinate).join(", ")} mm
          </span>
        </div>
      ) : null}
      {error ? (
        <span className="export-check is-warn" data-testid="measure-error">
          {error}
        </span>
      ) : null}
    </StagePopover>
  );
}
