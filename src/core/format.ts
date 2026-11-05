/**
 * Display formatting for measurements.
 *
 * Values are formatted exactly once, at render. Rounding a number to a string
 * first and re-rounding that string for another surface is what made a 56.2499
 * reference dimension read `56.2` on the sketch and `56.3` in its editor:
 * 56.2499 -> "56.25" -> 56.3 while the label rounds the raw value to 56.2.
 * Keep the measurement numeric and call one of these at the point of display.
 */

/** Readouts: whole millimetres, otherwise one decimal. */
export function formatLength(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

/** Editable fields: up to two decimals, trailing zeros trimmed. */
export function formatEditable(value: number): string {
  return String(Math.round(value * 100) / 100);
}
