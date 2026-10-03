import { CONFIG } from "./config";
import { distance } from "./map";
import type { Building, Player, Point, Match, Command } from "./types";
export function attackCost(target: Building | Player) {
  return Math.ceil(
    target.power *
      ("kind" in target ? (target.kind === "plant" ? 0.6 : 1) : 0.5),
  );
}
export function transfer(player: Player, building: Building, kind: Command) {
  const reserve =
    building.kind === "core" ? CONFIG.coreReserve : CONFIG.buildingReserve;
  const available = Math.max(0, building.power - reserve);
  const amount =
    kind === "deposit"
      ? Math.max(0, player.power - CONFIG.playerReserve)
      : kind === "half"
        ? Math.min(Math.floor(building.power / 2), available)
        : available;
  if (kind === "deposit") {
    player.power -= amount;
    building.power += amount;
  } else {
    player.power += amount;
    building.power -= amount;
  }
  return amount;
}
export function visionSources(match: Match, teamId: number) {
  return [
    ...match.players
      .filter((p) => p.alive && p.teamId === teamId && p.coreId)
      .map((p) => ({ x: p.x, y: p.y, radius: CONFIG.vision.player })),
    ...match.buildings
      .filter((b) => b.teamId === teamId)
      .map((b) => ({ x: b.x, y: b.y, radius: CONFIG.vision[b.kind] })),
  ];
}
export function visible(match: Match, teamId: number, target: Point) {
  return visionSources(match, teamId).some(
    (s) => distance(s, target) <= s.radius,
  );
}
export function eligible(
  match: Match,
  player: Player,
  target: Player | Building,
) {
  if (!player.alive || !player.coreId) return false;
  if (
    !("kind" in target) &&
    (!target.alive ||
      target.teamId === player.teamId ||
      target.power >= player.power)
  )
    return false;
  return (
    distance(player, target) <= CONFIG.interactionRadius &&
    visible(match, player.teamId, target)
  );
}
export function nearest(match: Match, player: Player) {
  return [...match.buildings, ...match.players]
    .filter((t) => eligible(match, player, t))
    .sort(
      (a, b) =>
        distance(player, a) - distance(player, b) || a.id.localeCompare(b.id),
    )[0];
}
