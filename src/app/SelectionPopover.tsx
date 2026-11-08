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
  /** The source face of the selected projected sketch reference. */
  onSourceFace?: () => void;
  onOpenFillet?: () => void;
  dimension?: {
    label: string;
    onSelect: () => void;
    onRadius?: () => void;
  };
  trim?: { onClick: () => void };
  /** Open the inline editor for the one selected dimension. */
  onEditDimension?: () => void;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
}

function selectionTitle(info: readonly SelectionInfo[]): string {
  if (info.length === 0) return "Selection";
  if (info.length === 1) return info[0]!.label;
  const counts = new Map<string, number>();
  for (const item of info) {
    counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(
      ([kind, count]) =>
        `${count} ${kind}${count === 1 ? "" : "s"}`,
    )
    .join(" + ");
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
  onSourceFace,
  onOpenFillet,
  dimension,
  trim,
  onEditDimension,
  position,
  onMove,
}: SelectionPopoverProps) {
  const hasDimension = info.some((item) => item.kind === "dimension");
  const hint = hasDimension
    ? actions.length > 0
      ? "constraints apply immediately · double-click a dimension label to edit"
      : "double-click a dimension label to edit; delete removes the whole set"
    : actions.length > 0
      ? "constraints apply immediately"
      : undefined;
  return (
    <StagePopover
      kicker="selection"
      title={selectionTitle(info)}
      testId="selection-panel"
      dataCount={info.length}
      className="selection-popover"
      position={position}
      onMove={onMove}
      hint={hint}
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
      onSourceFace ||
      onOpenFillet ||
      dimension ||
      trim ||
      onEditDimension ? (
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
          {onSourceFace ? (
            <button
              className="sc-chip"
              type="button"
              onClick={onSourceFace}
              data-testid="projection-source-face"
            >
              source face
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
          {onEditDimension ? (
            <button
              className="sc-chip"
              type="button"
              onClick={onEditDimension}
              data-testid="edit-dimension"
            >
              edit
            </button>
          ) : null}
        </div>
      ) : null}
    </StagePopover>
  );
}
