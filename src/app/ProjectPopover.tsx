import type { TopoRef } from "../core/kernel/protocol";
import { faceRefKey } from "../core/doc/datum";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface ProjectPopoverProps {
  faces: readonly TopoRef[];
  busy: boolean;
  error?: string | null;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
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
 * Project picked body faces into the active sketch as fixed reference loops.
 * This is a sketch edit, not a history feature.
 */
export function ProjectPopover({
  faces,
  busy,
  error,
  position,
  onMove,
  onRemoveFace,
  onApply,
  onCancel,
}: ProjectPopoverProps) {
  const count = faces.length;
  return (
    <StagePopover
      kicker="project"
      title="Project faces"
      testId="project-popover"
      position={position}
      onMove={onMove}
      hint="click faces on the body; Shift adds or removes"
      summary={`${count} face${count === 1 ? "" : "s"} · project`}
      cancel={{ label: "cancel", onClick: onCancel, testId: "project-cancel" }}
      primary={{
        label: busy ? "projecting…" : "project",
        onClick: onApply,
        testId: "project-apply",
        disabled: count === 0 || busy,
      }}
    >
      <div className="selection-list">
        {faces.map((face, index) => (
          <div className="selection-item" key={faceRefKey(face)}>
            <span>Face {index + 1}</span>
            <span className="mono">{faceDetail(face)}</span>
            <button
              className="text-action is-quiet"
              type="button"
              onClick={() => onRemoveFace(index)}
              data-testid={`project-remove-face-${index}`}
            >
              remove
            </button>
          </div>
        ))}
      </div>
      {error ? (
        <p className="feature-error" data-testid="project-error">
          {error}
        </p>
      ) : null}
    </StagePopover>
  );
}
