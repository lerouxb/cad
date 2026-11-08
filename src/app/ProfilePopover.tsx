import { formatArea } from "../core/format";
import type { SketchRegion } from "../core/sketch/loops";
import { StagePopover, type PopoverPosition } from "./StagePopover";

interface ProfilePopoverProps {
  regions: readonly SketchRegion[];
  hasMaterial: boolean;
  hasVoids: boolean;
  onAll: () => void;
  onVoids: () => void;
  onAuto: () => void;
  onExtrude: () => void;
  onRevolve: () => void;
  onClear: () => void;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
}

/**
 * The profile family popover (SELECTION.md §6). Selecting a filled region
 * selects the profile; `extrude…` is the feature chip that starts the draft.
 */
export function ProfilePopover({
  regions,
  hasMaterial,
  hasVoids,
  onAll,
  onVoids,
  onAuto,
  onExtrude,
  onRevolve,
  onClear,
  position,
  onMove,
}: ProfilePopoverProps) {
  const count = regions.length;
  return (
    <StagePopover
      kicker="selection"
      title={`${count} profile${count === 1 ? "" : "s"}`}
      testId="profile-popover"
      dataCount={count}
      className="selection-popover"
      position={position}
      onMove={onMove}
      hint="select profiles first; the feature chips start the draft"
      summary={`${count} profile${count === 1 ? "" : "s"}`}
      cancel={{ label: "clear", onClick: onClear, testId: "profile-clear" }}
    >
      <div className="selection-list">
        {regions.map((region, index) => (
          <div
            className="selection-item"
            key={region.id}
            data-profile-region={region.id}
          >
            <span>Profile {index + 1}</span>
            <span className="mono">
              {formatArea(region.area)} mm² · {region.kind}
            </span>
          </div>
        ))}
      </div>
      <div className="sc-chip-row">
        <span className="tool-kicker">regions</span>
        {hasMaterial ? (
          <button
            className="sc-chip"
            type="button"
            onClick={onAll}
            data-testid="profile-all"
          >
            all
          </button>
        ) : null}
        {hasVoids ? (
          <button
            className="sc-chip"
            type="button"
            onClick={onVoids}
            data-testid="profile-voids"
          >
            voids
          </button>
        ) : null}
        <button
          className="sc-chip"
          type="button"
          onClick={onAuto}
          data-testid="profile-auto"
        >
          auto
        </button>
      </div>
      <div className="sc-chip-row">
        <span className="tool-kicker">feature</span>
        <button
          className="sc-chip"
          type="button"
          onClick={onExtrude}
          disabled={count === 0}
          data-testid="profile-extrude"
        >
          extrude…
        </button>
        <button
          className="sc-chip"
          type="button"
          onClick={onRevolve}
          disabled={count === 0}
          data-testid="profile-revolve"
        >
          revolve…
        </button>
      </div>
    </StagePopover>
  );
}
