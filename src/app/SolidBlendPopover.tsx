import { formatLength } from "../core/format";
import { edgeRefKey, type EdgeRef } from "../core/kernel/protocol";
import { MeasureField } from "./MeasureField";
import { countLabel, InputRow, PickList } from "./PickRows";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface SolidBlendPopoverProps {
  kind: "fillet" | "chamfer";
  value: number;
  /** Adaptive quick-adjust ceiling from the selected edges and body. */
  max: number;
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
  max,
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
    ? `R ${formatLength(value)} mm · ${edgeSummary}`
    : `${formatLength(value)} mm · ${edgeSummary}`;
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
      <InputRow
        label="edges"
        value={countLabel(edgeCount)}
        valueTestId={`${prefix}-edges`}
      />
      <PickList
        rows={edges.map((edge, index) => ({
          id: edgeRefKey(edge),
          label: `Edge ${index + 1}`,
          detail:
            edge.hint.length === undefined
              ? "—"
              : `${formatLength(edge.hint.length)} mm`,
        }))}
        onRemove={onRemoveEdge}
        removeTestId={`${kind}-remove-edge`}
        testId={`${prefix}-edge-list`}
      />

      <MeasureField
        label={valueLabel}
        value={value}
        min={0.1}
        max={max}
        onChange={onValue}
        onEnd={onValueEnd}
        testId={`${prefix}-${valueLabel}`}
        sliderTestId={`${prefix}-${valueLabel}-slider`}
        ariaLabel={`${title} ${valueLabel} in millimetres`}
      />
    </StagePopover>
  );
}
