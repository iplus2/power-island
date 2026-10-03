// Approved rules plus deliberately provisional balance / input / map defaults.
export const CONFIG = {
  tickMs: 200,
  worldSize: 200,
  entityRadius: 2,
  interactionRadius: 8,
  initialPlayerPower: 1,
  respawnPower: 1,
  playerReserve: 1,
  initialCorePower: 50,
  coreReserve: 40,
  buildingReserve: 1,
  plantProductionTicks: 10,
  otherProductionTicks: 50,
  sprintCost: 10,
  sprintMultiplier: 1.5,
  sprintTicks: 5,
  timeoutMs: 30_000,
  // Playtest values, not new agreed balance rules:
  baseSpeed: 20,
  minSpeed: 5,
  speedPowerScale: 60,
  vision: { player: 16, core: 30, plant: 18, fort: 22 },
  plantCount: 12,
  fortCount: 6,
  // User requested a reasonable random range; 10–50 is the prototype example.
  neutralInitialPowerMin: 10,
  neutralInitialPowerMax: 50,
  buildingSpacing: 11,
  corePlacementSpacing: 6,
  diagonalTeams: true,
  doublePressMs: 260,
  holdMs: 480,
  inputLeaseMs: 600,
} as const;
export function normalSpeed(power: number) {
  return (
    CONFIG.minSpeed +
    (CONFIG.baseSpeed - CONFIG.minSpeed) /
      (1 + Math.max(0, power - 1) / CONFIG.speedPowerScale)
  );
}
