export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

/** A right-handed plane frame: local x/y lie in the plane, normal = x × y. */
export interface PlaneFrame {
  origin: Vec3;
  normal: Vec3;
  xAxis: Vec3;
  yAxis: Vec3;
}

/**
 * One edge of a mixed line/arc profile. Arcs are stored in counter-clockwise
 * start -> end order; `mid` is a point on the arc, for kernels that assemble a
 * three-point arc.
*/
export type ProfileSegment =
  | { kind: "line"; a: Vec2; b: Vec2 }
  | { kind: "arc"; center: Vec2; radius: number; start: Vec2; end: Vec2; mid: Vec2 };

/** A closed profile loop, in sketch-plane millimetres. */
export type ProfileLoop =
  | { kind: "polygon"; points: Vec2[] }
  | { kind: "circle"; center: Vec2; radius: number }
  /** `points` is a sampled polygon for bounds/validation; `segments` is exact. */
  | { kind: "path"; points: Vec2[]; segments: ProfileSegment[] };
