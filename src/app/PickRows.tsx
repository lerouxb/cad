import type { ReactNode } from "react";

export interface PickRow {
  id: string;
  label: string;
  detail: string;
}

interface InputAction {
  label: string;
  onClick: () => void;
  testId?: string;
  /** The button is the active pick mode (e.g. `pick` while picking). */
  active?: boolean;
}

/**
 * The shared input row from PICKS.md: the family on the left, the count/value in
 * the middle, and at most one stage action on the right.
 */
export function InputRow({
  label,
  value,
  action,
  testId,
  valueTestId,
  children,
}: {
  label: string;
  value: ReactNode;
  action?: InputAction;
  testId?: string;
  valueTestId?: string;
  children?: ReactNode;
}) {
  return (
    <div className="feature-row" data-testid={testId}>
      <span className="detail-key">{label}</span>
      <span className="detail-value" data-testid={valueTestId}>
        {value}
      </span>
      {action ? (
        <button
          className={`text-action${action.active ? " is-primary" : ""}`}
          type="button"
          onClick={action.onClick}
          aria-pressed={action.active}
          data-testid={action.testId}
        >
          {action.label}
        </button>
      ) : null}
      {children}
    </div>
  );
}

/**
 * The shared input list: one `Kind N` row per picked item with a mono detail and
 * a per-item remove. Empty inputs render no list at all.
 */
export function PickList({
  rows,
  onRemove,
  removeTestId,
  testId,
}: {
  rows: readonly PickRow[];
  onRemove: (index: number) => void;
  /** `${prefix}-${index}` becomes the remove button's test id. */
  removeTestId: string;
  testId?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="selection-list" data-testid={testId} data-count={rows.length}>
      {rows.map((row, index) => (
        <div className="selection-item" key={row.id}>
          <span>{row.label}</span>
          <span className="mono">{row.detail}</span>
          <button
            className="text-action is-quiet"
            type="button"
            onClick={() => onRemove(index)}
            data-testid={`${removeTestId}-${index}`}
          >
            remove
          </button>
        </div>
      ))}
    </div>
  );
}

export function countLabel(count: number): string {
  return `${count} selected`;
}
