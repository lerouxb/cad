import type { PlaneRef } from "../core/doc/types";
import { MeasureField } from "./MeasureField";
import { StagePopover, type PopoverPosition } from "./StagePopover";

export interface DatumPlaneDraft {
  /** Null while creating; the feature id while editing. */
  id: string | null;
  name?: string;
  kind: "offset" | "midplane";
  base: PlaneRef;
  second: PlaneRef;
  distance: number;
}

export interface DatumSupportOption {
  key: string;
  label: string;
  ref: PlaneRef;
}

interface DatumPlanePopoverProps {
  draft: DatumPlaneDraft;
  options: readonly DatumSupportOption[];
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onCancel: () => void;
  onApply: () => void;
  onKind: (kind: "offset" | "midplane") => void;
  onBase: (key: string) => void;
  onSecond: (key: string) => void;
  onDistance: (distance: number) => void;
}

function refKey(ref: PlaneRef): string {
  if (ref.kind === "world") return `world:${ref.plane}`;
  if (ref.kind === "face") return `face:${ref.ref.role}`;
  return `datum:${ref.featureId}`;
}

function optionLabel(options: readonly DatumSupportOption[], ref: PlaneRef): string {
  const key = refKey(ref);
  return options.find((option) => option.key === key)?.label ?? "unresolved";
}

/**
 * Datum-plane form. The same popover creates a new plane and edits an existing
 * history step; the geometry and its dependants rebuild only when applied.
 */
export function DatumPlanePopover({
  draft,
  options,
  position,
  onMove,
  onCancel,
  onApply,
  onKind,
  onBase,
  onSecond,
  onDistance,
}: DatumPlanePopoverProps) {
  const editing = draft.id !== null;
  const base = draft.base;
  const second = draft.second;
  const baseKey = options.some((option) => option.key === refKey(base))
    ? refKey(base)
    : "";
  const secondKey = options.some((option) => option.key === refKey(second))
    ? refKey(second)
    : "";

  const summary =
    draft.kind === "offset"
      ? `${draft.distance} mm · from ${optionLabel(options, base)}`
      : `${optionLabel(options, base)} / ${optionLabel(options, second)}`;

  return (
    <StagePopover
      kicker={editing ? "datum plane" : "new feature"}
      title={draft.name ?? "Datum plane"}
      testId={editing ? "datum-popover" : "datum-draft-popover"}
      position={position}
      onMove={onMove}
      hint="datum planes stay parametric to their base"
      summary={summary}
      cancel={{
        label: "cancel",
        onClick: onCancel,
        testId: editing ? "datum-popover-cancel" : "datum-cancel",
      }}
      primary={{
        label: editing ? "apply" : "plane",
        onClick: onApply,
        testId: editing ? "datum-popover-apply" : "datum-apply",
        disabled: !baseKey || (draft.kind === "midplane" && !secondKey),
      }}
    >
      <div className="feature-row">
        <span className="detail-key">type</span>
        <span className="seg" role="group" aria-label="Datum plane type">
          {(["offset", "midplane"] as const).map((kind) => (
            <button
              key={kind}
              className={draft.kind === kind ? "is-selected" : undefined}
              type="button"
              onClick={() => onKind(kind)}
              aria-pressed={draft.kind === kind}
              data-testid={`datum-kind-${kind}`}
            >
              {kind}
            </button>
          ))}
        </span>
      </div>

      <label className="feature-row">
        <span className="detail-key">
          {draft.kind === "offset" ? "base" : "first"}
        </span>
        <select
          className="detail-select"
          value={baseKey}
          onChange={(event) => onBase(event.target.value)}
          aria-label="Datum plane base"
          data-testid="datum-base"
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {draft.kind === "offset" ? (
        <MeasureField
          label="distance"
          value={draft.distance}
          min={-100}
          max={100}
          onChange={onDistance}
          testId="datum-distance"
          sliderTestId="datum-distance-slider"
          ariaLabel="Datum plane offset in millimetres"
        />
      ) : (
        <label className="feature-row">
          <span className="detail-key">second</span>
          <select
            className="detail-select"
            value={secondKey}
            onChange={(event) => onSecond(event.target.value)}
            aria-label="Datum plane second base"
            data-testid="datum-second"
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </StagePopover>
  );
}
