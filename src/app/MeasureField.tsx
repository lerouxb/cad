interface MeasureFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Slider and number step; millimetres use 0.1. */
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  /** Pointer-up / key-up / blur: ends one drag or edit gesture. */
  onEnd?: () => void;
  /** Number input test id; the slider defaults to `${testId}-slider`. */
  testId: string;
  sliderTestId?: string;
  ariaLabel: string;
  sliderAriaLabel?: string;
  /** Omit to allow the number field to type outside the slider range. */
  numberMin?: number;
}

/**
 * The one feature-length control: a quick range slider with an exact number
 * field and a unit. Extrude distance, fillet radius, chamfer distance, datum
 * offset and the sketch corner fillet all use it, so a parameter is never a
 * slider in one form and a bare number in another.
 */
export function MeasureField({
  label,
  value,
  min,
  max,
  step = 0.1,
  unit = "mm",
  disabled = false,
  onChange,
  onEnd,
  testId,
  sliderTestId = `${testId}-slider`,
  ariaLabel,
  sliderAriaLabel = ariaLabel,
  numberMin = min,
}: MeasureFieldProps) {
  const update = (raw: string): void => {
    const next = Number(raw);
    if (Number.isFinite(next)) onChange(next);
  };
  // A typed value may sit outside the quick-adjust range (e.g. a failed
  // radius); the slider still renders, clamped, without changing the number.
  const sliderValue = Math.min(max, Math.max(min, value));

  return (
    <div className="feature-row">
      <span className="detail-key">{label}</span>
      <span className="feature-control">
        <input
          className="slider feature-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          onChange={(event) => update(event.target.value)}
          onPointerUp={onEnd}
          onKeyUp={onEnd}
          disabled={disabled}
          data-testid={sliderTestId}
          aria-label={sliderAriaLabel}
        />
        <input
          className="detail-input feature-number"
          type="number"
          min={numberMin}
          step={step}
          value={value}
          onChange={(event) => update(event.target.value)}
          onBlur={onEnd}
          disabled={disabled}
          data-testid={testId}
          aria-label={ariaLabel}
        />
        <span className="detail-value">{unit}</span>
      </span>
    </div>
  );
}
