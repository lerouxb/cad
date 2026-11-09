import { formatArea, formatEditable } from "../core/format";
import type { SketchRegion } from "../core/sketch/loops";
import type { ExtrudeOperation, RevolveAxis } from "../core/doc/types";
import type { SketchCurve } from "../core/sketch/types";
import { MeasureField } from "./MeasureField";
import { OPERATION_LABELS, OperationRow } from "./OperationRow";
import { countLabel, InputRow, PickList } from "./PickRows";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface RevolvePopoverProps {
  sketchName: string;
  profiles: readonly SketchRegion[];
  axis: RevolveAxis | null;
  axisCandidates: readonly SketchCurve[];
  axisPicking: boolean;
  /** The stage the form is currently picking on. */
  mode: "model" | "sketch";
  angles: number;
  direction: "ccw" | "cw";
  operation: ExtrudeOperation;
  hasBase: boolean;
  isDraft: boolean;
  error?: string | null;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onSelectProfiles: () => void;
  onRemoveProfile: (index: number) => void;
  onPickAxis: () => void;
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
 * The axis row enters a candidate pick instead of listing every line as chips.
 */
export function RevolvePopover({
  sketchName,
  profiles,
  axis,
  axisCandidates,
  axisPicking,
  mode,
  angles,
  direction,
  operation,
  hasBase,
  isDraft,
  error,
  position,
  onMove,
  onSelectProfiles,
  onRemoveProfile,
  onPickAxis,
  onAngle,
  onAngleEnd,
  onDirection,
  onOperation,
  onApply,
  onCancel,
}: RevolvePopoverProps) {
  const profileCount = profiles.length;
  const axisIndex =
    axis?.kind === "line"
      ? axisCandidates.findIndex((curve) => curve.id === axis.curveId)
      : -1;
  const axisLost = axis?.kind === "line" && axisIndex < 0;
  const axisLabel =
    axis === null
      ? "pick one"
      : axis.kind === "reference"
        ? axis.axis === "x"
          ? "X axis"
          : "Y axis"
        : axisLost
          ? "lost · line removed"
          : lineLabel(axisCandidates[axisIndex]!, axisIndex);
  const hint = axisPicking
    ? "click a sketch line or the X/Y reference · Esc exits the pick"
    : axisLost
      ? "the stored axis line was deleted; pick another axis"
      : profileCount === 0
        ? "pick at least one profile with select"
        : axis === null
          ? "pick an axis: a sketch line or X/Y"
          : "the profile must stay on one side of the axis";
  const summary = `${formatEditable(angles)}° · ${OPERATION_LABELS[operation]} · ${profileCount} profile${profileCount === 1 ? "" : "s"}`;
  return (
    <StagePopover
      kicker={isDraft ? "new feature" : "revolve feature"}
      title="Revolve"
      testId="revolve-popover"
      position={position}
      onMove={onMove}
      hint={hint}
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

      <InputRow
        label="profile"
        value={countLabel(profileCount)}
        valueTestId="revolve-profiles"
        action={{
          label: mode === "sketch" ? "pick in sketch" : "select",
          onClick: onSelectProfiles,
          testId: "revolve-select-profiles",
          active: false,
        }}
      />
      <PickList
        rows={profiles.map((profile, index) => ({
          id: profile.id,
          label: `Profile ${index + 1}`,
          detail: `${formatArea(profile.area)} mm²`,
        }))}
        onRemove={onRemoveProfile}
        removeTestId="revolve-remove-profile"
        testId="revolve-profile-list"
      />

      <InputRow
        label="axis"
        value={axisLabel}
        valueTestId="revolve-axis"
        action={{
          label: "pick",
          onClick: onPickAxis,
          testId: "revolve-axis-pick",
          active: axisPicking,
        }}
      />

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
