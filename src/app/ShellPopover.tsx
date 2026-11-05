import type { TopoRef } from "../core/kernel/protocol";
import { faceRefKey } from "../core/doc/datum";
import { MeasureField } from "./MeasureField";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface ShellPopoverProps {
  thickness: number;
  /** Adaptive quick-adjust ceiling from the body's shortest dimension. */
  max: number;
  /** The faces removed by the shell (the openings). */
  faces: readonly TopoRef[];
  isDraft: boolean;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onValue: (value: number) => void;
  onValueEnd: () => void;
  onRemoveFace: (index: number) => void;
  onApply: () => void;
  onCancel: () => void;
}

function faceDetail(face: TopoRef): string {
  const surface = face.hint.surfaceType
    ? face.hint.surfaceType.toLowerCase()
    : "face";
  return face.hint.area === undefined
    ? surface
    : `${surface} · ${Math.round(face.hint.area)} mm²`;
}

/**
 * The 3D shell form. Same chrome as the other feature popovers: one footer
 * summary, quiet cancel and a primary apply. Thickness edits rebuild live.
 */
export function ShellPopover({
  thickness,
  max,
  faces,
  isDraft,
  position,
  onMove,
  onValue,
  onValueEnd,
  onRemoveFace,
  onApply,
  onCancel,
}: ShellPopoverProps) {
  const count = faces.length;
  const faceSummary = `${count} open face${count === 1 ? "" : "s"}`;
  return (
    <StagePopover
      kicker={isDraft ? "new feature" : "shell feature"}
      title="Shell"
      testId="shell-feature-popover"
      position={position}
      onMove={onMove}
      hint="click faces in the model to open or close them"
      summary={`${thickness} mm · ${faceSummary}`}
      cancel={{
        label: "cancel",
        onClick: onCancel,
        testId: "shell-feature-cancel",
      }}
      primary={{
        label: isDraft ? "shell" : "apply",
        onClick: onApply,
        testId: "shell-feature-apply",
        disabled: count === 0 || !(thickness > 0),
      }}
    >
      <MeasureField
        label="thickness"
        value={thickness}
        min={0.1}
        max={max}
        onChange={onValue}
        onEnd={onValueEnd}
        testId="shell-feature-thickness"
        sliderTestId="shell-feature-thickness-slider"
        ariaLabel="Shell thickness in millimetres"
      />

      <div className="feature-row">
        <span className="detail-key">open faces</span>
        <span className="detail-value" data-testid="shell-feature-faces">
          {faceSummary}
        </span>
      </div>

      <div className="selection-list">
        {faces.map((face, index) => (
          <div className="selection-item" key={faceRefKey(face)}>
            <span>Face {index + 1}</span>
            <span className="mono">{faceDetail(face)}</span>
            <button
              className="text-action is-quiet"
              type="button"
              onClick={() => onRemoveFace(index)}
              data-testid={`shell-remove-face-${index}`}
            >
              remove
            </button>
          </div>
        ))}
      </div>
    </StagePopover>
  );
}
