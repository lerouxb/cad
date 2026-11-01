import type { ExtrudeFeature, SketchFeature } from "../core/doc/types";
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
      ? `through all · ${feature.operation} · ${profiles}`
      : `${feature.height} mm · ${feature.operation}${
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

      <div className="feature-row">
        <span className="detail-key">distance</span>
        <span className="feature-control">
          <input
            className="slider feature-slider"
            type="range"
            min={1}
            max={100}
            step={1}
            value={Math.min(feature.height, 100)}
            onChange={(event) => onHeight(Number(event.target.value))}
            onPointerUp={onHeightEnd}
            onKeyUp={onHeightEnd}
            disabled={feature.end === "throughAll"}
            data-testid="height-slider"
            aria-label="Extrude height"
          />
          <input
            className="detail-input feature-number"
            type="number"
            min="0.1"
            step="0.1"
            value={feature.height}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0) onHeight(value);
            }}
            onBlur={onHeightEnd}
            disabled={feature.end === "throughAll"}
            aria-label="Extrude height in millimetres"
            data-testid="extrude-height"
          />
          <span className="detail-value">mm</span>
        </span>
      </div>

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

      <label className="feature-row">
        <span className="detail-key">operation</span>
        <select
          className="detail-select"
          value={feature.operation}
          onChange={(event) =>
            onOperation(event.target.value as ExtrudeFeature["operation"])
          }
          aria-label="Extrude operation"
          data-testid="extrude-operation"
        >
          <option value="new">new</option>
          <option value="join">join</option>
          <option value="cut">cut</option>
        </select>
      </label>

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
          <option value="throughAll">through all</option>
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
