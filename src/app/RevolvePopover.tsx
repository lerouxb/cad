import type { ExtrudeOperation, RevolveAxis } from "../core/doc/types";
import type { SketchCurve } from "../core/sketch/types";
import { MeasureField } from "./MeasureField";
import { OPERATION_LABELS, OperationRow } from "./OperationRow";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface RevolvePopoverProps {
  sketchName: string;
  profileCount: number;
  axis: RevolveAxis | null;
  axisCandidates: readonly SketchCurve[];
  angles: number;
  direction: "ccw" | "cw";
  operation: ExtrudeOperation;
  hasBase: boolean;
  isDraft: boolean;
  error?: string | null;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onAxis: (axis: RevolveAxis) => void;
  onAngle: (value: number) => void;
  onAngleEnd: () => void;
  onDirection: (direction: "ccw" | "cw") => void;
  onOperation: (operation: ExtrudeOperation) => void;
  onApply: () => void;
  onCancel: () => void;
}

function lineLabel(curve: SketchCurve, index: number): string {
  return `line ${index + 1}${curve.construction ? " · construction" : ""}`;
}

/**
 * The revolve form. A profile is selected before the chip starts the draft; the
 * axis is an explicit sketch line or the X/Y reference, never a silent default.
 */
export function RevolvePopover({
  sketchName,
  profileCount,
  axis,
  axisCandidates,
  angles,
  direction,
  operation,
  hasBase,
  isDraft,
  error,
  position,
  onMove,
  onAxis,
  onAngle,
  onAngleEnd,
  onDirection,
  onOperation,
  onApply,
  onCancel,
}: RevolvePopoverProps) {
  const axisLabel =
    axis === null
      ? "pick one"
      : axis.kind === "reference"
        ? axis.axis === "x"
          ? "X axis"
          : "Y axis"
        : (lineLabel(
            axisCandidates.find((curve) => curve.id === axis.curveId) ?? {
              id: axis.curveId,
              type: "line",
              a: "",
              b: "",
            },
            axisCandidates.findIndex((curve) => curve.id === axis.curveId),
          ) ?? "line");
  const summary = `${profileCount} profile${profileCount === 1 ? "" : "s"} · ${angles}° · ${OPERATION_LABELS[operation]}`;
  return (
    <StagePopover
      kicker={isDraft ? "new feature" : "revolve feature"}
      title="Revolve"
      testId="revolve-popover"
      position={position}
      onMove={onMove}
      hint={
        axis === null
          ? "pick an axis: a sketch line or X/Y"
          : "the profile must stay on one side of the axis"
      }
      summary={summary}
      cancel={{
        label: "cancel",
        onClick: onCancel,
        testId: "revolve-cancel",
      }}
      primary={{
        label: isDraft ? "revolve" : "apply",
        onClick: onApply,
        testId: "revolve-apply",
        disabled:
          profileCount === 0 ||
          axis === null ||
          !(angles >= 1 && angles <= 360) ||
          Boolean(error),
      }}
    >
      <div className="feature-row">
        <span className="detail-key">sketch</span>
        <span className="detail-value">{sketchName}</span>
      </div>

      <div className="feature-row">
        <span className="detail-key">profile</span>
        <span className="detail-value" data-testid="revolve-profiles">
          {profileCount} profile{profileCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="feature-row">
        <span className="detail-key">axis</span>
        <span className="detail-value" data-testid="revolve-axis">
          {axisLabel}
        </span>
      </div>

      <div className="sc-chip-row">
        <span className="tool-kicker">axis</span>
        <button
          className={`sc-chip${axis?.kind === "reference" && axis.axis === "x" ? " is-active" : ""}`}
          type="button"
          onClick={() => onAxis({ kind: "reference", axis: "x" })}
          data-testid="revolve-axis-x"
        >
          X
        </button>
        <button
          className={`sc-chip${axis?.kind === "reference" && axis.axis === "y" ? " is-active" : ""}`}
          type="button"
          onClick={() => onAxis({ kind: "reference", axis: "y" })}
          data-testid="revolve-axis-y"
        >
          Y
        </button>
        {axisCandidates.map((curve, index) => {
          const active =
            axis?.kind === "line" && axis.curveId === curve.id;
          return (
            <button
              className={`sc-chip${active ? " is-active" : ""}`}
              type="button"
              key={curve.id}
              onClick={() => onAxis({ kind: "line", curveId: curve.id })}
              data-testid={`revolve-axis-line-${index}`}
              title={lineLabel(curve, index)}
            >
              {lineLabel(curve, index)}
            </button>
          );
        })}
      </div>

      <MeasureField
        label="angle"
        value={angles}
        min={1}
        max={360}
        step={1}
        unit="°"
        onChange={onAngle}
        onEnd={onAngleEnd}
        testId="revolve-angle"
        sliderTestId="revolve-angle-slider"
        ariaLabel="Revolve angle in degrees"
      />

      {angles < 360 ? (
        <div className="feature-row">
          <span className="detail-key">direction</span>
          <span className="sc-chip-row">
            <button
              className={`sc-chip${direction === "ccw" ? " is-active" : ""}`}
              type="button"
              onClick={() => onDirection("ccw")}
              data-testid="revolve-ccw"
              aria-pressed={direction === "ccw"}
            >
              ccw
            </button>
            <button
              className={`sc-chip${direction === "cw" ? " is-active" : ""}`}
              type="button"
              onClick={() => onDirection("cw")}
              data-testid="revolve-cw"
              aria-pressed={direction === "cw"}
            >
              cw
            </button>
          </span>
        </div>
      ) : null}

      <div className="feature-row">
        <span className="detail-key">operation</span>
        <OperationRow
          value={operation}
          onChange={onOperation}
          hasBase={hasBase}
          testIdPrefix="revolve-operation"
        />
      </div>

      {error ? (
        <p className="feature-error" data-testid="revolve-error">
          {error}
        </p>
      ) : null}
    </StagePopover>
  );
}
