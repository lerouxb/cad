import type { TopoRef } from "../core/kernel/protocol";
import { faceRefKey } from "../core/doc/datum";
import { MeasureField } from "./MeasureField";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface OffsetFacePopoverProps {
  /** Signed distance: positive is out along the face normal, negative is in. */
  distance: number;
  /** Adaptive quick-adjust ceiling from the body's shortest dimension. */
  max: number;
  faces: readonly TopoRef[];
  isDraft: boolean;
  /** The last preview failure, if the kernel rejected the current inputs. */
  error?: string | null;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  onValue: (value: number) => void;
  onValueEnd: () => void;
  onDirection: (direction: "out" | "in") => void;
  onRemoveFace: (index: number) => void;
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

/**
 * The 3D offset-face form. The face set is the input; distance and direction
 * are one signed move. The slider is positive and the direction row owns the
 * sign, matching the footer summary.
 */
export function OffsetFacePopover({
  distance,
  max,
  faces,
  isDraft,
  error,
  position,
  onMove,
  onValue,
  onValueEnd,
  onDirection,
  onRemoveFace,
  onApply,
  onCancel,
}: OffsetFacePopoverProps) {
  const count = faces.length;
  const magnitude = Math.abs(distance);
  const direction = distance < 0 ? "in" : "out";
  const signed = `${distance < 0 ? "−" : "+"}${magnitude.toFixed(1)}`;
  const summary = `${count} face${count === 1 ? "" : "s"} · ${signed} mm`;
  const cylinder = count === 1 ? faces[0] : undefined;
  const radius = cylinder?.hint.radius;
  const radialSign = cylinder?.hint.radialSign;
  const newRadius =
    radius !== undefined && radialSign !== undefined
      ? radius + distance * radialSign
      : null;
  return (
    <StagePopover
      kicker={isDraft ? "new feature" : "offset feature"}
      title={count === 1 ? "Offset face" : `Offset ${count} faces`}
      testId="offset-face-popover"
      position={position}
      onMove={onMove}
      hint="click faces in the model to add or remove them"
      summary={summary}
      cancel={{
        label: "cancel",
        onClick: onCancel,
        testId: "offset-face-cancel",
      }}
      primary={{
        label: isDraft ? "offset" : "apply",
        onClick: onApply,
        testId: "offset-face-apply",
        disabled: count === 0 || !(magnitude > 0) || Boolean(error),
      }}
    >
      <MeasureField
        label="distance"
        value={magnitude}
        min={0.1}
        max={max}
        onChange={onValue}
        onEnd={onValueEnd}
        testId="offset-face-distance"
        sliderTestId="offset-face-distance-slider"
        ariaLabel="Offset distance in millimetres"
      />

      <div className="feature-row">
        <span className="detail-key">direction</span>
        <span className="sc-chip-row">
          <button
            className={`sc-chip${direction === "out" ? " is-active" : ""}`}
            type="button"
            onClick={() => onDirection("out")}
            data-testid="offset-face-out"
            aria-pressed={direction === "out"}
          >
            out
          </button>
          <button
            className={`sc-chip${direction === "in" ? " is-active" : ""}`}
            type="button"
            onClick={() => onDirection("in")}
            data-testid="offset-face-in"
            aria-pressed={direction === "in"}
          >
            in
          </button>
        </span>
      </div>

      {error ? (
        <p className="feature-error" data-testid="offset-face-error">
          {error}
        </p>
      ) : null}

      {newRadius !== null && newRadius > 0 ? (
        <div className="feature-row">
          <span className="detail-key">result</span>
          <span className="detail-value" data-testid="offset-face-diameter">
            Ø {(radius! * 2).toFixed(1)} → {(newRadius * 2).toFixed(1)} mm
          </span>
        </div>
      ) : null}

      <div className="selection-list">
        {faces.map((face, index) => (
          <div className="selection-item" key={faceRefKey(face)}>
            <span>Face {index + 1}</span>
            <span className="mono">{faceDetail(face)}</span>
            <button
              className="text-action is-quiet"
              type="button"
              onClick={() => onRemoveFace(index)}
              data-testid={`offset-face-remove-${index}`}
            >
              remove
            </button>
          </div>
        ))}
      </div>
    </StagePopover>
  );
}
