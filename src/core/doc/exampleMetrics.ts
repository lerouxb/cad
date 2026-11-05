/**
 * The example part's dimensions, in one place.
 *
 * The example document, its sketch demo and the tests all derive from these
 * constants: resizing or re-centring the example is one edit here plus the
 * geometry that reads it, not a hunt through golden numbers in every suite.
 * Derived values stay explicit functions so a test states what it measures.
 */
import { DEMO_DEFAULTS } from "../sketch/demo";

export const EXAMPLE_PLATE = {
  width: DEMO_DEFAULTS.width,
  height: DEMO_DEFAULTS.height,
  /** The base extrude's height (the UI's "12 mm" plate). */
  thickness: 12,
  holeDiameter: DEMO_DEFAULTS.holeDiameter,
  /** The suppressed centre-pin extrude. */
  pinHeight: 20,
  /** The suppressed "Rounded plate" fillet radius. */
  filletRadius: 4,
  /** The suppressed "Beveled plate" chamfer distance. */
  chamferDistance: 4,
} as const;

/** Volume of the plate with its single through hole at `thickness`. */
export function examplePlateVolume(
  thickness: number = EXAMPLE_PLATE.thickness,
): number {
  const { width, height, holeDiameter } = EXAMPLE_PLATE;
  return (
    width * height * thickness -
    Math.PI * (holeDiameter / 2) ** 2 * thickness
  );
}

/**
 * Volume of the example plate after shelling it with the TOP face open: the
 * base plate minus the hollow, whose walls are `wall` thick. The through hole
 * becomes a tube, so the cavity's inner boundary is `holeRadius + wall`.
 */
export function exampleShelledPlateVolume(
  thickness: number = EXAMPLE_PLATE.thickness,
  wall = 2,
): number {
  const { width, height, holeDiameter } = EXAMPLE_PLATE;
  const holeRadius = holeDiameter / 2;
  const outer =
    width * height * thickness -
    Math.PI * holeRadius * holeRadius * thickness;
  const cavity =
    (width - 2 * wall) * (height - 2 * wall) * (thickness - wall) -
    Math.PI * (holeRadius + wall) ** 2 * (thickness - wall);
  return outer - cavity;
}

/** Volume of the plate's solid blank, before the hole is cut. */
export function exampleSolidPlateVolume(
  thickness: number = EXAMPLE_PLATE.thickness,
): number {
  return EXAMPLE_PLATE.width * EXAMPLE_PLATE.height * thickness;
}

/** The mesh bounds string the stage publishes, e.g. `-30,-20,0,30,20,12`. */
export function exampleBounds(
  top: number = EXAMPLE_PLATE.thickness,
): string {
  const x = EXAMPLE_PLATE.width / 2;
  const y = EXAMPLE_PLATE.height / 2;
  return `${-x},${-y},0,${x},${y},${top}`;
}

/** The four vertical plate-edge midpoints, in the order the doc builds them. */
export function exampleVerticalEdgeMidpoints(): Array<
  [number, number, number]
> {
  const x = EXAMPLE_PLATE.width / 2;
  const y = EXAMPLE_PLATE.height / 2;
  const z = EXAMPLE_PLATE.thickness / 2;
  return [
    [-x, -y, z],
    [x, -y, z],
    [x, y, z],
    [-x, y, z],
  ];
}
