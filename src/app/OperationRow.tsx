import type { ExtrudeOperation } from "../core/doc/types";

export const OPERATION_LABELS: Record<ExtrudeOperation, string> = {
  new: "new body",
  join: "join",
  cut: "cut",
  intersect: "intersect",
};

interface OperationRowProps {
  value: ExtrudeOperation;
  onChange: (operation: ExtrudeOperation) => void;
  /** Cut/intersect need a body; the other two remain available. */
  hasBase: boolean;
  /** Test id prefix; the option id is `${prefix}-${operation}`. */
  testIdPrefix: string;
}

/** The one four-operation segmented row from BOOLEANS.md. */
export function OperationRow({
  value,
  onChange,
  hasBase,
  testIdPrefix,
}: OperationRowProps) {
  const options: ExtrudeOperation[] = ["new", "join", "cut", "intersect"];
  return (
    <div className="seg" role="group" aria-label="Operation">
      {options.map((operation) => {
        const needsBase = operation === "cut" || operation === "intersect";
        return (
          <button
            key={operation}
            className={`seg-option${value === operation ? " is-active" : ""}`}
            type="button"
            disabled={needsBase && !hasBase}
            aria-pressed={value === operation}
            title={
              needsBase && !hasBase
                ? "cut and intersect need a body"
                : undefined
            }
            onClick={() => onChange(operation)}
            data-testid={`${testIdPrefix}-${operation}`}
          >
            {OPERATION_LABELS[operation]}
          </button>
        );
      })}
    </div>
  );
}
