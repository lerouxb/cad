import type { WorldPlane } from "../core/doc/types";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface SupportPopoverProps {
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onCancel: () => void;
  onApply: () => void;
  /** A current body-face pick, used as the sketch support when planar. */
  faceLabel?: string;
  faceSupported?: boolean;
  /** World plane used when no face is picked. */
  plane: WorldPlane;
  onPlane: (plane: WorldPlane) => void;
}

/**
 * New sketches are created from an explicit support choice, not a header action
 * that silently uses XY. Datum planes land next in M4.
 */
export function SupportPopover({
  position,
  onMove,
  onCancel,
  onApply,
  faceLabel,
  faceSupported = false,
  plane,
  onPlane,
}: SupportPopoverProps) {
  const face = Boolean(faceLabel);
  const hint = face
    ? faceSupported
      ? "sketch on the selected planar face"
      : "this face is curved; cancel and pick a world plane"
    : "world planes; datum planes arrive next in M4";
  return (
    <StagePopover
      kicker="new feature"
      title="Sketch"
      testId="support-popover"
      position={position}
      onMove={onMove}
      hint={hint}
      summary={face ? "planar face · selected" : `world plane · ${plane}`}
      cancel={{ label: "cancel", onClick: onCancel, testId: "support-cancel" }}
      primary={{
        label: "sketch",
        onClick: onApply,
        testId: "new-sketch",
        disabled: face && !faceSupported,
      }}
    >
      {faceLabel ? (
        <div className="feature-row">
          <span className="detail-key">selected face</span>
          <span className="detail-value">{faceLabel}</span>
        </div>
      ) : null}
      <div className="feature-row">
        <span className="detail-key">support</span>
        <span className="seg" role="group" aria-label="Sketch support">
          {face ? (
            <button
              className="is-selected"
              type="button"
              disabled={!faceSupported}
            >
              face
            </button>
          ) : (
            (["XY", "XZ", "YZ"] as const).map((candidate) => (
              <button
                key={candidate}
                className={candidate === plane ? "is-selected" : undefined}
                type="button"
                onClick={() => onPlane(candidate)}
                aria-pressed={candidate === plane}
                data-testid={`support-${candidate.toLowerCase()}`}
              >
                {candidate}
              </button>
            ))
          )}
        </span>
      </div>
    </StagePopover>
  );
}
