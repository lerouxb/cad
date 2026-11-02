import { StagePopover, type PopoverPosition } from "./StagePopover";

interface SupportPopoverProps {
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onCancel: () => void;
  onApply: () => void;
  /** A current body-face pick, used as the sketch support when planar. */
  faceLabel?: string;
  faceSupported?: boolean;
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
  faceSupported = false,
}: SupportPopoverProps) {
  const face = Boolean(faceLabel);
  const hint = face
    ? faceSupported
      ? "sketch on the selected planar face"
      : "this face is curved; cancel and pick a world plane"
    : "world XZ/YZ and datum planes arrive with M4";
  return (
    <StagePopover
      kicker="new feature"
      title="Sketch"
      testId="support-popover"
      position={position}
      onMove={onMove}
      hint={hint}
      summary={face ? "planar face · selected" : "world plane · XY"}
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
            <>
              <button className="is-selected" type="button">
                XY
              </button>
              <button type="button" disabled title="Arrives with M4">
                XZ
              </button>
              <button type="button" disabled title="Arrives with M4">
                YZ
              </button>
            </>
          )}
        </span>
      </div>
    </StagePopover>
  );
}
