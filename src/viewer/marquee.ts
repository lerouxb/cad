/**
 * Screen-space marquee tests for the 3D stage.
 *
 * The semantics mirror the sketch's profile selection: a box selects what is
 * fully enclosed, a lasso selects what it touches or crosses. Keeping the
 * projection out of this module makes the rules plain data and unit-testable.
 */

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface ScreenBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boxBetween(a: ScreenPoint, b: ScreenPoint): ScreenBox {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

export function boxIsEmpty(box: ScreenBox, tolerance = 3): boolean {
  return (
    box.maxX - box.minX < tolerance || box.maxY - box.minY < tolerance
  );
}

export function pointInBox(point: ScreenPoint, box: ScreenBox): boolean {
  return (
    point.x >= box.minX &&
    point.x <= box.maxX &&
    point.y >= box.minY &&
    point.y <= box.maxY
  );
}

/** Window selection: every vertex of the projected polyline is inside. */
export function polylineInBox(
  points: readonly ScreenPoint[],
  box: ScreenBox,
): boolean {
  return points.length >= 2 && points.every((point) => pointInBox(point, box));
}

/**
 * Even-odd containment. Points exactly on the boundary count as inside, which
 * is what a "touched" lasso should report.
 */
export function pointInPolygon(
  polygon: readonly ScreenPoint[],
  point: ScreenPoint,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    if (pointOnSegment(a, b, point)) return true;
    const straddles = a.y > point.y !== b.y > point.y;
    if (
      straddles &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function orientation(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(
  a: ScreenPoint,
  b: ScreenPoint,
  point: ScreenPoint,
): boolean {
  return (
    Math.abs(orientation(a, b, point)) < 1e-9 &&
    point.x >= Math.min(a.x, b.x) - 1e-9 &&
    point.x <= Math.max(a.x, b.x) + 1e-9 &&
    point.y >= Math.min(a.y, b.y) - 1e-9 &&
    point.y <= Math.max(a.y, b.y) + 1e-9
  );
}

function segmentsCross(
  a1: ScreenPoint,
  a2: ScreenPoint,
  b1: ScreenPoint,
  b2: ScreenPoint,
): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (o1 * o2 < 0 && o3 * o4 < 0) return true;
  return (
    (Math.abs(o1) < 1e-9 && pointOnSegment(a1, a2, b1)) ||
    (Math.abs(o2) < 1e-9 && pointOnSegment(a1, a2, b2)) ||
    (Math.abs(o3) < 1e-9 && pointOnSegment(b1, b2, a1)) ||
    (Math.abs(o4) < 1e-9 && pointOnSegment(b1, b2, a2))
  );
}

/**
 * Crossing selection: any vertex inside the lasso, or any part of the
 * polyline crossing the lasso boundary.
 */
export function polylineTouchesPolygon(
  points: readonly ScreenPoint[],
  polygon: readonly ScreenPoint[],
): boolean {
  if (points.length < 2 || polygon.length < 3) return false;
  if (points.some((point) => pointInPolygon(polygon, point))) return true;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    for (let j = 0; j < polygon.length; j += 1) {
      const c = polygon[j]!;
      const d = polygon[(j + 1) % polygon.length]!;
      if (segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

/** Vertices of any triangle fan, for a closed lasso path. */
export function polygonIsEmpty(
  polygon: readonly ScreenPoint[],
  tolerance = 3,
): boolean {
  if (polygon.length < 3) return true;
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  return (
    Math.max(...xs) - Math.min(...xs) < tolerance &&
    Math.max(...ys) - Math.min(...ys) < tolerance
  );
}
