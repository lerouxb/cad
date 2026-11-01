import type { ConstraintAction } from "../core/sketch/constraints";
import { StagePopover, type PopoverPosition } from "./StagePopover";

export interface SelectionInfo {
  id: string;
  kind: string;
  label: string;
  detail: string;
}

type ConstructionState = "none" | "mixed" | "all" | null;

interface SelectionPopoverProps {
  info: readonly SelectionInfo[];
  actions: readonly ConstraintAction[];
  construction: ConstructionState;
  onConstraint: (action: ConstraintAction) => void;
  onConstruction: () => void;
  onDelete: () => void;
  deletable: boolean;
  onOpenFillet?: () => void;
  dimension?: {
    label: string;
    onSelect: () => void;
    onRadius?: () => void;
  };
  trim?: { onClick: () => void };
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
}

function selectionTitle(info: readonly SelectionInfo[]): string {
  if (info.length === 0) return "Selection";
  if (info.length === 1) return info[0]!.label;
  const kinds = new Set(info.map((item) => item.kind));
  if (kinds.size === 1) {
    const kind = info[0]!.kind;
    if (kind === "line") return `${info.length} lines`;
    if (kind === "point") return `${info.length} points`;
    if (kind === "circle") return `${info.length} circles`;
    if (kind === "arc") return `${info.length} arcs`;
  }
  return `${info.length} selected`;
}

/**
 * The selection palette from the interaction contract: immediate constraint
 * chips, the selected items as a readout, and one quiet delete action. It is
 * draggable; the body is click-through so it never steals canvas picks.
 */
export function SelectionPopover({
  info,
  actions,
  construction,
  onConstraint,
  onConstruction,
  onDelete,
  deletable,
  onOpenFillet,
  dimension,
  trim,
  position,
  onMove,
}: SelectionPopoverProps) {
  return (
    <StagePopover
      kicker="selection"
      title={selectionTitle(info)}
      testId="selection-panel"
      dataCount={info.length}
      className="selection-popover"
      position={position}
      onMove={onMove}
      hint={actions.length > 0 ? "constraints apply immediately" : undefined}
      summary={`${info.length} selected`}
      destructive={{
        label: "delete",
        onClick: onDelete,
        testId: "delete-selection",
        disabled: !deletable,
      }}
    >
      <div className="selection-list">
        {info.map((item) => (
          <div className="selection-item" key={item.id} data-selection-id={item.id}>
            <span>{item.label}</span>
            <span className="mono">{item.detail}</span>
          </div>
        ))}
      </div>
      {actions.length > 0 ||
      construction !== null ||
      onOpenFillet ||
      dimension ||
      trim ? (
        <div className="sc-chip-row">
          {actions.map((action) => (
            <button
              key={action.id ?? action.type}
              className={`sc-chip${action.applied ? " is-on" : ""}`}
              type="button"
              onClick={() => onConstraint(action)}
              aria-pressed={action.applied === true}
              data-testid={`constraint-${action.type}`}
            >
              {action.label}
            </button>
          ))}
          {construction !== null ? (
            <button
              className="sc-chip"
              type="button"
              onClick={onConstruction}
              aria-pressed={construction === "all"}
              data-testid="toggle-construction"
            >
              {construction === "all" ? "Make normal" : "Construction"}
            </button>
          ) : null}
          {onOpenFillet ? (
            <button
              className="sc-chip"
              type="button"
              onClick={onOpenFillet}
              data-testid="open-fillet"
            >
              fillet
            </button>
          ) : null}
          {dimension ? (
            <button
              className="sc-chip"
              type="button"
              onClick={dimension.onSelect}
              data-testid="tool-dimension"
            >
              {dimension.label}
            </button>
          ) : null}
          {dimension?.onRadius ? (
            <button
              className="sc-chip"
              type="button"
              onClick={dimension.onRadius}
              data-testid="dimension-radius"
            >
              radius
            </button>
          ) : null}
          {trim ? (
            <button
              className="sc-chip"
              type="button"
              onClick={trim.onClick}
              data-testid="tool-trim"
            >
              trim
            </button>
          ) : null}
        </div>
      ) : null}
    </StagePopover>
  );
}
