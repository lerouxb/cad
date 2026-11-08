import type { EdgeRef, TopoRef } from "../core/kernel/protocol";
import { faceRefKey } from "../core/doc/datum";
import { edgeRefKey } from "../core/kernel/protocol";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface ProjectPopoverProps {
  faces: readonly TopoRef[];
  edges: readonly EdgeRef[];
  busy: boolean;
  error?: string | null;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onRemoveFace: (index: number) => void;
  onRemoveEdge: (index: number) => void;
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

function edgeDetail(edge: EdgeRef): string {
  return edge.hint.length === undefined
    ? "edge"
    : `edge · ${Math.round(edge.hint.length)} mm`;
}

/**
 * Project picked body faces and edges into the active sketch as fixed
 * references. This is a sketch edit, not a history feature.
 */
export function ProjectPopover({
  faces,
  edges,
  busy,
  error,
  position,
  onMove,
  onRemoveFace,
  onRemoveEdge,
  onApply,
  onCancel,
}: ProjectPopoverProps) {
  const count = faces.length + edges.length;
  return (
    <StagePopover
      kicker="project"
      title="Project geometry"
      testId="project-popover"
      position={position}
      onMove={onMove}
      hint="click faces or edges on the body; Shift adds or removes"
      summary={`${count} selected · project`}
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
        {edges.map((edge, index) => (
          <div className="selection-item" key={edgeRefKey(edge)}>
            <span>Edge {index + 1}</span>
            <span className="mono">{edgeDetail(edge)}</span>
            <button
              className="text-action is-quiet"
              type="button"
              onClick={() => onRemoveEdge(index)}
              data-testid={`project-remove-edge-${index}`}
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
