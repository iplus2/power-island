import type { TutorialStage } from "../shared/types";

export const tutorialGuide: Record<
  TutorialStage,
  { title: string; body: string }
> = {
  place: {
    title: "Establish your Core",
    body: "Place your Core at the marked spot, left of the first Plant. Click or tap once to preview, then again to confirm.",
  },
  withdraw: {
    title: "Take Power with you",
    body: "Near your Core, press E or tap Interact to withdraw Power. Carrying more makes you stronger, but slower.",
  },
  firstPlant: {
    title: "Capture your first Plant",
    body: "Move to the marked Plant and press E or tap Interact to attack. Carry more than the shown attack cost.",
  },
  frontier: {
    title: "Find the enemy Core",
    body: "Find the enemy Core and capture the marked Plant nearby. Enemy buildings can be captured too.",
  },
  expand: {
    title: "Build a forward reserve",
    body: "Capture Plants for production and a Fort to stockpile Power near the front line. Hold E or Interact to deposit. Forts defend your reserves better: at equal Power, they cost twice as much to capture as Plants.",
  },
  core: {
    title: "Destroy the enemy Core",
    body: "Double press E or double tap Interact to collect stored Power. Carry more than the enemy Core's attack cost, then attack to finish.",
  },
  complete: {
    title: "Practice finished",
    body: "Try a real match, or restart to explore another approach.",
  },
};
