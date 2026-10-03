import { CONFIG } from "./config";
import type { Point, Building, Mode } from "./types";
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
export function inside(p: Point, polygon: Point[]) {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      yes = !yes;
  }
  return yes;
}
function segmentDistance(p: Point, a: Point, b: Point) {
  const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / d),
  );
  return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
export function validPoint(
  p: Point,
  polygon: Point[],
  margin: number = CONFIG.entityRadius,
) {
  return (
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    inside(p, polygon) &&
    polygon.every(
      (a, i) =>
        segmentDistance(p, a, polygon[(i + 1) % polygon.length]) >= margin,
    )
  );
}
export function inZone(p: Point, zone: number, mode: Mode) {
  if (mode === "1v1") return zone === 0 ? p.x < 100 : p.x >= 100;
  return (p.x >= 100 ? 1 : 0) + (p.y >= 100 ? 2 : 0) === zone;
}
export function generateMap(seed: number) {
  const random = rng(seed),
    phases = [random() * 6.28, random() * 6.28, random() * 6.28];
  const boundary = Array.from({ length: 96 }, (_, i) => {
    const a = (i / 96) * Math.PI * 2,
      r =
        82 +
        5 * Math.sin(3 * a + phases[0]) +
        3 * Math.sin(5 * a + phases[1]) +
        2 * Math.sin(7 * a + phases[2]);
    return { x: 100 + Math.cos(a) * r, y: 100 + Math.sin(a) * r };
  });
  const buildings: Building[] = [];
  for (let i = 0; i < CONFIG.plantCount + CONFIG.fortCount; i++) {
    let point: Point | undefined;
    for (let n = 0; n < 5000; n++) {
      const p = { x: 20 + random() * 160, y: 20 + random() * 160 };
      if (
        validPoint(p, boundary, 8) &&
        buildings.every((b) => distance(b, p) >= CONFIG.buildingSpacing)
      ) {
        point = p;
        break;
      }
    }
    if (!point) throw new Error("Unable to generate a valid building layout");
    buildings.push({
      ...point,
      id: `b${i}`,
      kind: i < CONFIG.plantCount ? "plant" : "fort",
      teamId: null,
      power:
        CONFIG.neutralInitialPowerMin +
        Math.floor(
          random() *
            (CONFIG.neutralInitialPowerMax - CONFIG.neutralInitialPowerMin + 1),
        ),
      productionTick: 0,
    });
  }
  return { boundary, buildings };
}
// Sweep in short substeps so a tick cannot leap across the island edge.
export function constrainMove(from: Point, to: Point, boundary: Point[]) {
  const steps = Math.max(1, Math.ceil(distance(from, to) / 0.5));
  let point = { ...from };
  for (let i = 1; i <= steps; i++) {
    const next = {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    };
    if (!validPoint(next, boundary)) break;
    point = next;
  }
  return point;
}
