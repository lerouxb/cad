import { StagePopover, type PopoverPosition } from "./StagePopover";

interface SupportPopoverProps {
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onCancel: () => void;
  onApply: () => void;
  /** A current body-face pick, acknowledged even though face support is M4. */
  faceLabel?: string;
}

/**
 * New sketches are created from an explicit support choice, not a header action
 * that silently uses XY. World XZ/YZ and planar faces land with M4.
 */
export function SupportPopover({
  position,
  onMove,
  onCancel,
  onApply,
  faceLabel,
}: SupportPopoverProps) {
  return (
    <StagePopover
      kicker="new feature"
      title="Sketch"
      testId="support-popover"
      position={position}
      onMove={onMove}
      hint={
        faceLabel
          ? "face supports arrive with M4; choose a world plane for now"
          : "world XZ/YZ and planar faces arrive with M4"
      }
      summary="world plane · XY"
      cancel={{ label: "cancel", onClick: onCancel, testId: "support-cancel" }}
      primary={{ label: "sketch", onClick: onApply, testId: "new-sketch" }}
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
          <button className="is-selected" type="button">
            XY
          </button>
          <button type="button" disabled title="Arrives with M4">
            XZ
          </button>
          <button type="button" disabled title="Arrives with M4">
            YZ
          </button>
        </span>
      </div>
    </StagePopover>
  );
}
