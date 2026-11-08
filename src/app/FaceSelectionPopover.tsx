import type { TopoRef } from "../core/kernel/protocol";
import { faceRefKey } from "../core/doc/datum";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface FaceSelectionPopoverProps {
  faces: readonly TopoRef[];
  onShell: () => void;
  onOffset: () => void;
  /** One planar face can start a sketch; a face is a support, not a profile. */
  onNewSketch?: () => void;
  canNewSketch?: boolean;
  onClear: () => void;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
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
 * Model-mode face selection palette. Faces are the input to the shell (and
 * later offset), so the action lives in the footer like the edge palette.
 */
export function FaceSelectionPopover({
  faces,
  onShell,
  onOffset,
  onNewSketch,
  canNewSketch = false,
  onClear,
  position,
  onMove,
}: FaceSelectionPopoverProps) {
  const count = faces.length;
  return (
    <StagePopover
      kicker="selection"
      title={`${count} face${count === 1 ? "" : "s"}`}
      testId="face-selection-popover"
      dataCount={count}
      // The selected refs are the authoritative multi-face state.
      dataAttributes={{ "data-face-refs": JSON.stringify(faces) }}
      position={position}
      onMove={onMove}
      hint="Shift adds or removes a face"
      summary={`${count} face${count === 1 ? "" : "s"}`}
      cancel={{
        label: "clear",
        onClick: onClear,
        testId: "clear-face-selection",
      }}
    >
      <div className="selection-list">
        {faces.map((face, index) => (
          <div
            className="selection-item"
            key={faceRefKey(face)}
            data-face-role={face.role}
          >
            <span>Face {index + 1}</span>
            <span className="mono">{faceDetail(face)}</span>
          </div>
        ))}
      </div>
      <div className="sc-chip-row">
        <span className="tool-kicker">feature</span>
        {onNewSketch && canNewSketch ? (
          <button
            className="sc-chip"
            type="button"
            onClick={onNewSketch}
            data-testid="face-new-sketch"
          >
            new sketch
          </button>
        ) : null}
        <button
          className="sc-chip"
          type="button"
          onClick={onOffset}
          data-testid="start-offset-face"
        >
          offset face
        </button>
        <button
          className="sc-chip"
          type="button"
          onClick={onShell}
          data-testid="start-shell"
        >
          shell…
        </button>
      </div>
    </StagePopover>
  );
}
