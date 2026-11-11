import type { WorldPlane } from "../core/doc/types";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface SupportPopoverProps {
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onCancel: () => void;
  onApply: () => void;
  /** A current body-face pick, used as the sketch support when planar. */
  faceLabel?: string;
  /** Surface type + area for the selected face row. */
  faceDetail?: string;
  faceSupported?: boolean;
  /** Sketch on the opposite side of the picked face. */
  faceFlipped?: boolean;
  onFlipFace?: () => void;
  /** World plane used when no face is picked. */
  plane: WorldPlane;
  onPlane: (plane: WorldPlane) => void;
  /** Existing datum planes, selectable as a support. */
  datums?: ReadonlyArray<{ id: string; name: string; detail?: string }>;
  datumId?: string | null;
  onDatum?: (id: string | null) => void;
}

/**
 * New sketches are created from an explicit support choice, not a header action
 * that silently uses XY. Existing datum planes are listed alongside world planes.
 */
export function SupportPopover({
  position,
  onMove,
  onCancel,
  onApply,
  faceLabel,
  faceDetail,
  faceSupported = false,
  faceFlipped = false,
  onFlipFace,
  plane,
  onPlane,
  datums = [],
  datumId = null,
  onDatum,
}: SupportPopoverProps) {
  const face = Boolean(faceLabel);
  const datum = datums.find((candidate) => candidate.id === datumId) ?? null;
  const hint = face
    ? faceSupported
      ? "sketch on the selected planar face"
      : "this face is curved; cancel and pick a world plane"
    : "pick a world plane or an existing datum plane";
  return (
    <StagePopover
      kicker="new feature"
      title="Sketch"
      testId="support-popover"
      position={position}
      onMove={onMove}
      hint={hint}
      summary={
        face
          ? `planar face · ${faceFlipped ? "flipped" : "outward"}`
          : datum
            ? `datum plane · ${datum.name}`
            : `world plane · ${plane}`
      }
      cancel={{ label: "cancel", onClick: onCancel, testId: "support-cancel" }}
      primary={{
        label: "sketch",
        onClick: onApply,
        testId: "new-sketch",
        disabled: face && !faceSupported,
      }}
    >
      {faceLabel ? (
        <div className="feature-row">
          <span className="detail-key">selected face</span>
          <span className="detail-value">
            {faceLabel}
            {faceDetail ? ` · ${faceDetail}` : ""}
          </span>
          {onFlipFace ? (
            <button
              className={`text-action${faceFlipped ? " is-primary" : ""}`}
              type="button"
              onClick={onFlipFace}
              aria-pressed={faceFlipped}
              data-testid="flip-face"
            >
              {faceFlipped ? "flipped" : "flip side"}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="feature-row">
        <span className="detail-key">support</span>
        <span className="seg" role="group" aria-label="Sketch support">
          {face ? (
            <button
              className="is-selected"
              type="button"
              disabled={!faceSupported}
            >
              face
            </button>
          ) : (
            (["XY", "XZ", "YZ"] as const).map((candidate) => (
              <button
                key={candidate}
                className={candidate === plane ? "is-selected" : undefined}
                type="button"
                onClick={() => onPlane(candidate)}
                aria-pressed={candidate === plane}
                data-testid={`support-${candidate.toLowerCase()}`}
              >
                {candidate}
              </button>
            ))
          )}
        </span>
      </div>
      {!face && datums.length > 0 && onDatum ? (
        <label className="feature-row">
          <span className="detail-key">datum</span>
          <select
            className="detail-select"
            value={datumId ?? ""}
            onChange={(event) => onDatum(event.target.value || null)}
            aria-label="Datum plane support"
            data-testid="support-datum"
          >
            <option value="">none</option>
            {datums.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
                {candidate.detail ? ` · ${candidate.detail}` : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </StagePopover>
  );
}
