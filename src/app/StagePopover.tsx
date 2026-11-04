import {
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export interface PopoverPosition {
  x: number;
  y: number;
}

export interface PopoverAction {
  label: string;
  onClick: () => void;
  testId?: string;
  disabled?: boolean;
}

interface StagePopoverProps {
  kicker: string;
  title: string;
  testId: string;
  position: PopoverPosition;
  onMove: (position: PopoverPosition) => void;
  children: ReactNode;
  hint?: string;
  summary: string;
  primary?: PopoverAction;
  /** A second footer action, before cancel (e.g. fillet + chamfer). */
  secondary?: PopoverAction;
  cancel?: PopoverAction;
  destructive?: PopoverAction;
  className?: string;
  dataCount?: number;
}

/**
 * The one floating surface from the studies: kicker + title in a draggable
 * header, rows in the body, a quiet hint, and one footer with the summary on
 * the left and actions on the right.
 */
export function StagePopover({
  kicker,
  title,
  testId,
  position,
  onMove,
  children,
  hint,
  summary,
  primary,
  secondary,
  cancel,
  destructive,
  className,
  dataCount,
}: StagePopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const root = rootRef.current;
    const parent = root?.parentElement;
    if (!root || !parent) return;
    const rect = root.getBoundingClientRect();
    drag.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    const root = rootRef.current;
    const parent = root?.parentElement;
    if (!start || !root || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    const maxX = Math.max(8, parentRect.width - root.offsetWidth - 8);
    const maxY = Math.max(8, parentRect.height - root.offsetHeight - 8);
    onMove({
      x: Math.max(8, Math.min(maxX, event.clientX - parentRect.left - start.x)),
      y: Math.max(8, Math.min(maxY, event.clientY - parentRect.top - start.y)),
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      ref={rootRef}
      className={`stage-popover${className ? ` ${className}` : ""}`}
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label={`${title} · ${kicker}`}
      data-testid={testId}
      data-count={dataCount}
    >
      <div
        className="stage-popover-head"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="stage-popover-head-top">
          <span className="stage-popover-kicker">{kicker}</span>
          <span className="stage-popover-grip" aria-hidden="true">
            drag
          </span>
        </div>
        <span className="stage-popover-title">{title}</span>
      </div>

      <div className="stage-popover-body">{children}</div>

      {hint ? <div className="stage-popover-hint">{hint}</div> : null}

      <div className="stage-popover-foot">
        <span className="stage-popover-summary">{summary}</span>
        <span className="stage-popover-actions">
          {destructive ? (
            <button
              className="text-action is-quiet stage-popover-destructive"
              type="button"
              onClick={destructive.onClick}
              disabled={destructive.disabled}
              data-testid={destructive.testId}
            >
              {destructive.label}
            </button>
          ) : null}
          {secondary ? (
            <button
              className="text-action is-quiet"
              type="button"
              onClick={secondary.onClick}
              disabled={secondary.disabled}
              data-testid={secondary.testId}
            >
              {secondary.label}
            </button>
          ) : null}
          {cancel ? (
            <button
              className="text-action is-quiet"
              type="button"
              onClick={cancel.onClick}
              disabled={cancel.disabled}
              data-testid={cancel.testId}
            >
              {cancel.label}
            </button>
          ) : null}
          {primary ? (
            <button
              className="text-action is-primary"
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled}
              data-testid={primary.testId}
            >
              {primary.label}
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
