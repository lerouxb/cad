import { StagePopover, type PopoverPosition } from "./StagePopover";

interface FilletPopoverProps {
  radius: number;
  onRadius: (radius: number) => void;
  onApply: () => void;
  onCancel: () => void;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
}

/** A two-line corner fillet is an operation: one value and a commit pair. */
export function FilletPopover({
  radius,
  onRadius,
  onApply,
  onCancel,
  position,
  onMove,
}: FilletPopoverProps) {
  return (
    <StagePopover
      kicker="sketch tool"
      title="corner fillet"
      testId="fillet-popover"
      position={position}
      onMove={onMove}
      hint="trims the two lines and adds a tangent arc"
      summary={`R ${radius} mm · 2 lines`}
      cancel={{ label: "cancel", onClick: onCancel, testId: "fillet-cancel" }}
      primary={{
        label: "fillet",
        onClick: onApply,
        testId: "constraint-fillet",
      }}
    >
      <label className="feature-row">
        <span className="detail-key">radius</span>
        <span className="feature-control">
          <input
            className="detail-input feature-number"
            type="number"
            min="0.5"
            step="1"
            value={radius}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0) onRadius(value);
            }}
            aria-label="Fillet radius"
            data-testid="fillet-radius"
          />
          <span className="detail-value">mm</span>
        </span>
      </label>
    </StagePopover>
  );
}
