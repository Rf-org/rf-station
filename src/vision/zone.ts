// Pure floor-spot geometry (normalized 0..1 coords). No DOM, no side effects.

export type Point = [number, number];

export interface SpotPolygon {
  points: Point[];
}

/** Exact on-segment check so boundary points (e.g. a vertex) count as inside. */
function onSegment(p: Point, a: Point, b: Point): boolean {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  if ((bx - ax) * (py - ay) !== (by - ay) * (px - ax)) return false;
  return (
    px >= Math.min(ax, bx) && px <= Math.max(ax, bx) && py >= Math.min(ay, by) && py <= Math.max(ay, by)
  );
}

/** Ray-casting point-in-polygon. <3 points → false. Boundary counts as inside. */
export function pointInPolygon(p: Point, poly: SpotPolygon): boolean {
  const pts = poly.points;
  if (pts.length < 3) return false;
  const [x, y] = p;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (onSegment(p, pts[i], pts[j])) return true;
    // ponytail: boundary resolves via the onSegment shortcut above (ceiling: float jitter within ~1e-9 of an edge is still decided by the ray test).
    if ((yi > y) !== (yj > y) && x <= ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** True if ANY foot point is inside the spot. */
export function feetInSpot(feet: Point[], poly: SpotPolygon): boolean {
  return feet.some((f) => pointInPolygon(f, poly));
}
