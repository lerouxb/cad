import { edgeRefKey, type EdgeRef } from "../core/kernel/protocol";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface SolidFilletPopoverProps {
  radius: number;
  edges: readonly EdgeRef[];
  isDraft: boolean;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onRadius: (radius: number) => void;
  onRadiusEnd: () => void;
  onRemoveEdge: (index: number) => void;
  onApply: () => void;
  onCancel: () => void;
}

/**
 * The 3D fillet form. Same chrome as every other feature popover: drag the
 * header, one footer summary, quiet cancel and a primary apply. Radius edits
 * rebuild live; applying commits.
 */
export function SolidFilletPopover({
  radius,
  edges,
  isDraft,
  position,
  onMove,
  onRadius,
  onRadiusEnd,
  onRemoveEdge,
  onApply,
  onCancel,
}: SolidFilletPopoverProps) {
  const edgeCount = edges.length;
  const edgeSummary = `${edgeCount} edge${edgeCount === 1 ? "" : "s"}`;
  return (
    <StagePopover
      kicker={isDraft ? "new feature" : "fillet feature"}
      title="Fillet"
      testId="fillet-feature-popover"
      position={position}
      onMove={onMove}
      hint="click edges in the model to add or remove them"
      summary={`R ${radius} mm · ${edgeSummary}`}
      cancel={{
        label: "cancel",
        onClick: onCancel,
        testId: "fillet-feature-cancel",
      }}
      primary={{
        label: isDraft ? "fillet" : "apply",
        onClick: onApply,
        testId: "fillet-feature-apply",
        disabled: edgeCount === 0 || !(radius > 0),
      }}
    >
      <label className="feature-row">
        <span className="detail-key">radius</span>
        <span className="feature-control">
          <input
            className="detail-input feature-number"
            type="number"
            min="0.1"
            step="0.1"
            value={radius}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value) && value > 0) onRadius(value);
            }}
            onBlur={onRadiusEnd}
            aria-label="Fillet radius in millimetres"
            data-testid="fillet-feature-radius"
          />
          <span className="detail-value">mm</span>
        </span>
      </label>

      <div className="feature-row">
        <span className="detail-key">edges</span>
        <span className="detail-value" data-testid="fillet-feature-edges">
          {edgeSummary}
        </span>
      </div>

      <div className="selection-list">
        {edges.map((edge, index) => (
          <div className="selection-item" key={edgeRefKey(edge)}>
            <span>Edge {index + 1}</span>
            <span className="mono">
              {edge.hint.length === undefined
                ? "—"
                : `${edge.hint.length.toFixed(1)} mm`}
            </span>
            <button
              className="text-action is-quiet"
              type="button"
              onClick={() => onRemoveEdge(index)}
              data-testid={`fillet-remove-edge-${index}`}
            >
              remove
            </button>
          </div>
        ))}
      </div>
    </StagePopover>
  );
}
