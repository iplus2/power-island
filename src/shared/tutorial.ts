// Fixed layout; lesson-specific starting assets use the normal game rules.
export const TUTORIAL = {
  seed: 175,
  suggestedCore: { x: 45, y: 100 },
  firstPlant: "b0",
  enemyCore: { x: 145, y: 150 },
  enemyCorePower: 100,
  firstFort: "b14",
  chasePower: 20,
  chaseDistance: 14,
} as const;

export const TUTORIAL_PARTS = [
  {
    part: 1,
    title: "Core & basic controls",
    description: "Deploy, move, and practice all three transfers.",
  },
  {
    part: 2,
    title: "Attack",
    description: "Capture a Plant, collect its production, and capture a Fort.",
  },
  {
    part: 3,
    title: "Chase",
    description: "Sprint to catch a moving opponent and defeat them.",
  },
  {
    part: 4,
    title: "Front line",
    description: "Find the enemy Core, build a foothold, and finish the match.",
  },
] as const;
