export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

/** A closed profile loop, in sketch-plane millimetres. */
export type ProfileLoop =
  | { kind: "polygon"; points: Vec2[] }
  | { kind: "circle"; center: Vec2; radius: number };
