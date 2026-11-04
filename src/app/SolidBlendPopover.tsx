import { edgeRefKey, type EdgeRef } from "../core/kernel/protocol";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface SolidBlendPopoverProps {
  kind: "fillet" | "chamfer";
  value: number;
  edges: readonly EdgeRef[];
  isDraft: boolean;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onValue: (value: number) => void;
  onValueEnd: () => void;
  onRemoveEdge: (index: number) => void;
  onApply: () => void;
  onCancel: () => void;
}

/**
 * The 3D fillet/chamfer form. Same chrome as every other feature popover: drag
 * the header, one footer summary, quiet cancel and a primary apply. Value
 * edits rebuild live; applying commits.
 */
export function SolidBlendPopover({
  kind,
  value,
  edges,
  isDraft,
  position,
  onMove,
  onValue,
  onValueEnd,
  onRemoveEdge,
  onApply,
  onCancel,
}: SolidBlendPopoverProps) {
  const edgeCount = edges.length;
  const edgeSummary = `${edgeCount} edge${edgeCount === 1 ? "" : "s"}`;
  const isFillet = kind === "fillet";
  const prefix = isFillet ? "fillet-feature" : "chamfer-feature";
  const valueLabel = isFillet ? "radius" : "distance";
  const title = isFillet ? "Fillet" : "Chamfer";
  const summary = isFillet
    ? `R ${value} mm · ${edgeSummary}`
    : `${value} mm · ${edgeSummary}`;
  return (
    <StagePopover
      kicker={isDraft ? "new feature" : `${kind} feature`}
      title={title}
      testId={`${prefix}-popover`}
      position={position}
      onMove={onMove}
      hint="click edges in the model to add or remove them"
      summary={summary}
      cancel={{
        label: "cancel",
        onClick: onCancel,
        testId: `${prefix}-cancel`,
      }}
      primary={{
        label: isDraft ? kind : "apply",
        onClick: onApply,
        testId: `${prefix}-apply`,
        disabled: edgeCount === 0 || !(value > 0),
      }}
    >
      <label className="feature-row">
        <span className="detail-key">{valueLabel}</span>
        <span className="feature-control">
          <input
            className="detail-input feature-number"
            type="number"
            min="0.1"
            step="0.1"
            value={value}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next > 0) onValue(next);
            }}
            onBlur={onValueEnd}
            aria-label={`${title} ${valueLabel} in millimetres`}
            data-testid={`${prefix}-${valueLabel}`}
          />
          <span className="detail-value">mm</span>
        </span>
      </label>

      <div className="feature-row">
        <span className="detail-key">edges</span>
        <span className="detail-value" data-testid={`${prefix}-edges`}>
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
              data-testid={`${kind}-remove-edge-${index}`}
            >
              remove
            </button>
          </div>
        ))}
      </div>
    </StagePopover>
  );
}
