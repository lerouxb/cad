import type { ExtrudeFeature, SketchFeature } from "../core/doc/types";
import { MeasureField } from "./MeasureField";
import { OPERATION_LABELS, OperationRow } from "./OperationRow";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface FeaturePopoverProps {
  feature: ExtrudeFeature;
  sketches: readonly SketchFeature[];
  regionCount: number;
  mode: "model" | "sketch";
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onCancel: () => void;
  onApply: () => void;
  onHeight: (height: number) => void;
  onHeightEnd: () => void;
  onSketchChange?: (sketchId: string) => void;
  onToggleSymmetric: () => void;
  onOperation: (operation: ExtrudeFeature["operation"]) => void;
  hasBase?: boolean;
  onEnd: (end: ExtrudeFeature["end"]) => void;
  onSelectProfiles: () => void;
  /** Popover chrome. Drafts use the same form with different wording/test ids. */
  kicker?: string;
  title?: string;
  testId?: string;
  primaryLabel?: string;
  primaryDisabled?: boolean;
  primaryTestId?: string;
  cancelTestId?: string;
  showSketchRow?: boolean;
  hint?: string;
  summaryOverride?: string;
}

/**
 * Extrude form used by both the feature editor and the new-extrude draft. The
 * surrounding popover chrome (drag, footer, actions) lives in `StagePopover`.
 */
export function FeaturePopover({
  feature,
  sketches,
  regionCount,
  mode,
  position,
  onMove,
  onCancel,
  onApply,
  onHeight,
  onHeightEnd,
  onSketchChange,
  onToggleSymmetric,
  onOperation,
  hasBase = true,
  onEnd,
  onSelectProfiles,
  kicker = "extrude feature",
  title,
  testId = "feature-popover",
  primaryLabel = "apply",
  primaryDisabled = false,
  primaryTestId = "feature-popover-apply",
  cancelTestId = "feature-popover-cancel",
  showSketchRow = true,
  hint = "changes rebuild live · cancel reverts",
  summaryOverride,
}: FeaturePopoverProps) {
  const profiles = `${regionCount} region${regionCount === 1 ? "" : "s"}`;
  const summary =
    summaryOverride ??
    (feature.end === "throughAll"
      ? `through all · ${OPERATION_LABELS[feature.operation]} · ${profiles}`
      : `${feature.height} mm · ${OPERATION_LABELS[feature.operation]}${
          feature.symmetric ? " · symmetric" : ""
        } · ${profiles}`);

  return (
    <StagePopover
      kicker={kicker}
      title={title ?? feature.name}
      testId={testId}
      position={position}
      onMove={onMove}
      hint={hint}
      summary={summary}
      cancel={{ label: "cancel", onClick: onCancel, testId: cancelTestId }}
      primary={{
        label: primaryLabel,
        onClick: onApply,
        testId: primaryTestId,
        disabled: primaryDisabled,
      }}
    >
      {showSketchRow && onSketchChange ? (
        <label className="feature-row">
          <span className="detail-key">sketch</span>
          <select
            className="detail-select"
            value={feature.sketchId}
            onChange={(event) => onSketchChange(event.target.value)}
            aria-label="Extrude source sketch"
            data-testid="extrude-sketch"
          >
            {sketches.map((sketch) => (
              <option key={sketch.id} value={sketch.id}>
                {sketch.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <MeasureField
        label="distance"
        value={feature.height}
        min={0.1}
        max={100}
        disabled={feature.end === "throughAll"}
        onChange={onHeight}
        onEnd={onHeightEnd}
        testId="extrude-height"
        sliderTestId="height-slider"
        ariaLabel="Extrude height in millimetres"
        sliderAriaLabel="Extrude height"
      />

      <div className="feature-row">
        <span className="detail-key">direction</span>
        <button
          className={`text-action${feature.symmetric ? " is-primary" : ""}`}
          type="button"
          onClick={onToggleSymmetric}
          aria-pressed={feature.symmetric}
          data-testid="extrude-symmetric"
        >
          {feature.symmetric ? "symmetric" : "one side"}
        </button>
      </div>

      <div className="feature-row">
        <span className="detail-key">operation</span>
        <OperationRow
          value={feature.operation}
          onChange={onOperation}
          hasBase={hasBase}
          testIdPrefix="extrude-operation"
        />
      </div>

      <label className="feature-row">
        <span className="detail-key">end</span>
        <select
          className="detail-select"
          value={feature.end}
          onChange={(event) =>
            onEnd(event.target.value as ExtrudeFeature["end"])
          }
          aria-label="Extrude end condition"
          data-testid="extrude-end"
        >
          <option value="blind">blind</option>
          <option value="throughAll" disabled={feature.operation !== "cut"}>
            through all
          </option>
        </select>
      </label>

      <div className="feature-row">
        <span className="detail-key">profile</span>
        <span className="detail-value">
          {regionCount} region{regionCount === 1 ? "" : "s"}
        </span>
        <button
          className="text-action"
          type="button"
          onClick={onSelectProfiles}
          data-testid="popover-select-profiles"
        >
          {mode === "sketch" ? "pick in sketch" : "select profiles"}
        </button>
      </div>
    </StagePopover>
  );
}
