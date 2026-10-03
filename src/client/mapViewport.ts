import type { Point } from "../shared/types";
export type MapViewport = { left: number; top: number; size: number };
// Fit the complete public coastline, never the currently visible entities.
// This is presentation only: world positions, geometry and rules stay unchanged.
export function islandViewport(boundary: Point[]): MapViewport {
  if (!boundary.length) return { left: 0, top: 0, size: 200 };
  const xs = boundary.map((p) => p.x),
    ys = boundary.map((p) => p.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs);
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const size = Math.min(200, Math.max(maxX - minX, maxY - minY) + 8);
  return {
    left: Math.max(0, Math.min(200 - size, (minX + maxX - size) / 2)),
    top: Math.max(0, Math.min(200 - size, (minY + maxY - size) / 2)),
    size,
  };
}
export function mapPoint(
  client: Point,
  rect: { left: number; top: number; width: number; height: number },
  view: MapViewport,
): Point {
  return {
    x: view.left + ((client.x - rect.left) / rect.width) * view.size,
    y: view.top + ((client.y - rect.top) / rect.height) * view.size,
  };
}
