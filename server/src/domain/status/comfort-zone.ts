// The NASA-STD-3001 Vol 2 Rev F temperature + humidity zone [V2 6012], Figure 6.2-2, as a
// point-in-polygon test on (°C, %RH). This approximates NASA's chart (SPEC §6.5).

export interface ZonePoint {
  tempC: number;
  rhPct: number;
}

/** The four corners from SPEC §6.5, counterclockwise on (°C, %RH). */
export const COMFORT_ZONE: readonly ZonePoint[] = [
  { tempC: 19.1, rhPct: 25 },
  { tempC: 27, rhPct: 25 },
  { tempC: 25.7, rhPct: 75 },
  { tempC: 18, rhPct: 75 },
];

/** Twice the signed area of (a, b, c); positive when c is left of a→b. */
function cross(a: ZonePoint, b: ZonePoint, c: ZonePoint): number {
  return (b.tempC - a.tempC) * (c.rhPct - a.rhPct) - (b.rhPct - a.rhPct) * (c.tempC - a.tempC);
}

/** Inside or on the edge of a convex polygon given counterclockwise. */
export function insideConvexPolygon(point: ZonePoint, polygon: readonly ZonePoint[]): boolean {
  return polygon.every((corner, i) => cross(corner, polygon[(i + 1) % polygon.length], point) >= 0);
}

/** Convex hull, counterclockwise (Andrew's monotone chain). */
function convexHull(points: readonly ZonePoint[]): ZonePoint[] {
  const sorted = [...points].sort((a, b) => a.tempC - b.tempC || a.rhPct - b.rhPct);
  const half = (ordered: readonly ZonePoint[]) => {
    const chain: ZonePoint[] = [];
    for (const p of ordered) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 0) chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/**
 * The zone grown by a margin: every point within `marginC` and `marginRhPct` of some point in
 * the zone. For a convex zone that is the hull of the corners moved by ± each margin.
 */
export function zoneWithMargin(zone: readonly ZonePoint[], marginC: number, marginRhPct: number): ZonePoint[] {
  const shifted = zone.flatMap((corner) =>
    [-1, 1].flatMap((dt) => [-1, 1].map((dh) => ({ tempC: corner.tempC + dt * marginC, rhPct: corner.rhPct + dh * marginRhPct }))));
  return convexHull(shifted);
}

export function insideComfortZone(point: ZonePoint): boolean {
  return insideConvexPolygon(point, COMFORT_ZONE);
}

/** Inside the zone, or outside it by no more than `marginC` and no more than `marginRhPct`. */
export function withinComfortZoneMargin(point: ZonePoint, marginC: number, marginRhPct: number): boolean {
  return insideConvexPolygon(point, zoneWithMargin(COMFORT_ZONE, marginC, marginRhPct));
}
