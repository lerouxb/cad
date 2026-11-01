export type GridStep = number | "auto";

/**
 * Pick a readable grid step for the current zoom.
 *
 * The sketch grid is the snap grid, so it must stay legible in both screen and
 * model units. We choose a "nice" 1/2/5 × 10ⁿ step whose minor cells are at
 * least `minPixels` on screen, preferring the smallest step that fits under
 * `maxPixels`. This keeps a 0.1 mm part and a 10 m part equally usable.
 */
export function niceGridStep(
  pxPerMm: number,
  minPixels = 16,
  maxPixels = 40,
): number {
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) return 10;
  const minMm = minPixels / pxPerMm;
  const maxMm = maxPixels / pxPerMm;
  const exponent = Math.floor(Math.log10(minMm));
  const base = Math.pow(10, exponent);
  const mantissas = [1, 2, 5, 10];

  for (const mantissa of mantissas) {
    const step = mantissa * base;
    if (step >= minMm && step <= maxMm) return step;
  }
  for (const mantissa of mantissas) {
    const step = mantissa * base;
    if (step >= minMm) return step;
  }
  return 10;
}

/** Human-readable step for the stage foot, without trailing zeros. */
export function formatGridStep(step: number): string {
  if (!Number.isFinite(step) || step <= 0) return "—";
  return String(Number(step.toPrecision(3)));
}
