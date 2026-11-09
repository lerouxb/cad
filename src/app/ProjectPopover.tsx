import { formatArea, formatLength } from "../core/format";
import type { EdgeRef, TopoRef } from "../core/kernel/protocol";
import { faceRefKey } from "../core/doc/datum";
import { edgeRefKey } from "../core/kernel/protocol";
import { countLabel, InputRow, PickList } from "./PickRows";
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
    : `${surface} · ${formatArea(face.hint.area)} mm²`;
}

function edgeDetail(edge: EdgeRef): string {
  return edge.hint.length === undefined
    ? "edge"
    : `${formatLength(edge.hint.length)} mm`;
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
      <InputRow
        label="faces"
        value={countLabel(faces.length)}
        valueTestId="project-faces"
      />
      <PickList
        rows={faces.map((face, index) => ({
          id: faceRefKey(face),
          label: `Face ${index + 1}`,
          detail: faceDetail(face),
        }))}
        onRemove={onRemoveFace}
        removeTestId="project-remove-face"
        testId="project-face-list"
      />

      <InputRow
        label="edges"
        value={countLabel(edges.length)}
        valueTestId="project-edges"
      />
      <PickList
        rows={edges.map((edge, index) => ({
          id: edgeRefKey(edge),
          label: `Edge ${index + 1}`,
          detail: edgeDetail(edge),
        }))}
        onRemove={onRemoveEdge}
        removeTestId="project-remove-edge"
        testId="project-edge-list"
      />
      {error ? (
        <p className="feature-error" data-testid="project-error">
          {error}
        </p>
      ) : null}
    </StagePopover>
  );
}
