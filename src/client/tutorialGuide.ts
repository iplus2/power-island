import type { TutorialStage } from "../shared/types";

export const tutorialGuide: Record<
  TutorialStage,
  { title: string; body: string }
> = {
  place: {
    title: "Establish your Core",
    body: "Place your Core at the marked spot. Click or tap once to preview, then again at the same spot to confirm.",
  },
  move: {
    title: "Move around your Core",
    body: "Use WASD or click / tap the map to move away from your Core. Then return close enough to interact.",
  },
  half: {
    title: "Single press: withdraw half",
    body: "Return to your Core. Press E once or tap Interact once to take half its Power, limited by the Core's 40-Power reserve.",
  },
  max: {
    title: "Double press: withdraw maximum",
    body: "Double press E or double tap Interact at your Core. This takes all available Power above its reserve. Practice the gesture even if nothing can be withdrawn.",
  },
  deposit: {
    title: "Hold: deposit Power",
    body: "Hold E or Interact at your Core to put your carried Power back. You keep 1 Power. Complete this transfer to finish Part 1.",
  },
  firstPlant: {
    title: "Capture your first Plant",
    body: "At your Core, press E or tap Interact to take Power. Use WASD or tap the map to reach the marked Plant. Press E or tap Interact to attack. A Plant costs half its stored Power; carry more than that cost.",
  },
  fort: {
    title: "Capture the Fort above",
    body: "Wait for your Plant to produce Power and collect it with E or Interact (double press / tap for the maximum), then move to the marked Fort above it. Press E or tap Interact to attack. A Fort costs all its stored Power; carry more than the cost.",
  },
  chase: {
    title: "Sprint to catch your opponent",
    body: "At your Core, press E or tap Interact to take Power. Your 20-Power opponent flees when you get close. Press Q or tap Sprint to catch them, then E or Interact to attack. Carry more than their Power; the attack costs half their Power, widening your advantage. Each sprint costs 10, so weigh the cost before chasing.",
  },
  frontier: {
    title: "Find the enemy Core",
    body: "Explore the island without markers. Travel light: leave stored Power in your buildings. Find the enemy Core to reveal the next objective.",
  },
  enemyPlant: {
    title: "Capture the front-line Plant",
    body: "Capture the marked enemy Plant with E or Interact. It becomes your forward source of Power. The attack costs half its stored Power.",
  },
  enemyFort: {
    title: "Build a forward reserve",
    body: "Capture Plants for production and the marked Fort to stockpile Power near the front line. Hold E or Interact to deposit. Forts defend your reserves better: at equal Power, they cost twice as much to capture as Plants.",
  },
  core: {
    title: "Destroy the enemy Core",
    body: "Collect Power from your buildings. Carry more than the enemy Core's full stored Power, then approach and press E or Interact to destroy it.",
  },
  complete: {
    title: "Tutorial finished",
    body: "Continue your training, or return Home.",
  },
};
