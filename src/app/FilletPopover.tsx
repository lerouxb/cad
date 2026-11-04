import { MeasureField } from "./MeasureField";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface FilletPopoverProps {
  radius: number;
  /** Adaptive quick-adjust ceiling from the two selected lines. */
  maxRadius: number;
  onRadius: (radius: number) => void;
  onApply: () => void;
  onCancel: () => void;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
}

/** A two-line corner fillet is an operation: one value and a commit pair. */
export function FilletPopover({
  radius,
  maxRadius,
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
      <MeasureField
        label="radius"
        value={radius}
        min={0.1}
        max={maxRadius}
        onChange={onRadius}
        testId="fillet-radius"
        sliderTestId="fillet-radius-slider"
        ariaLabel="Fillet radius"
      />
    </StagePopover>
  );
}
