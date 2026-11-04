import { edgeRefKey, type EdgeRef } from "../core/kernel/protocol";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface BodySelectionPopoverProps {
  edges: readonly EdgeRef[];
  onFillet: () => void;
  onChamfer: () => void;
  onClear: () => void;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
}

function edgeLabel(index: number): string {
  return `Edge ${index + 1}`;
}

function edgeDetail(edge: EdgeRef): string {
  if (edge.hint.length === undefined) return "—";
  return `${edge.hint.length.toFixed(1)} mm`;
}

/**
 * Model-mode selection palette. Edges are the first multi-selectable body
 * thing; the action lives in the footer, never in a status line.
 */
export function BodySelectionPopover({
  edges,
  onFillet,
  onChamfer,
  onClear,
  position,
  onMove,
}: BodySelectionPopoverProps) {
  const count = edges.length;
  return (
    <StagePopover
      kicker="selection"
      title={`${count} edge${count === 1 ? "" : "s"}`}
      testId="body-selection-popover"
      dataCount={count}
      // The selected refs are the authoritative multi-edge state; tests read
      // this instead of inferring selection from hover or pick badges.
      dataAttributes={{ "data-edge-refs": JSON.stringify(edges) }}
      position={position}
      onMove={onMove}
      hint="Shift adds or removes an edge"
      summary={`${count} edge${count === 1 ? "" : "s"}`}
      cancel={{ label: "clear", onClick: onClear, testId: "clear-body-selection" }}
      secondary={{
        label: "chamfer",
        onClick: onChamfer,
        testId: "start-chamfer",
      }}
      primary={{ label: "fillet", onClick: onFillet, testId: "start-fillet" }}
    >
      <div className="selection-list">
        {edges.map((edge, index) => (
          <div
            className="selection-item"
            key={edgeRefKey(edge)}
            data-edge-role={edge.faces[0].role}
          >
            <span>{edgeLabel(index)}</span>
            <span className="mono">{edgeDetail(edge)}</span>
          </div>
        ))}
      </div>
    </StagePopover>
  );
}
