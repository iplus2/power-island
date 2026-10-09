import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/server/engine";
import { TUTORIAL } from "../src/shared/tutorial";
import { attackCost } from "../src/shared/rules";
import { distance, generateMap } from "../src/shared/map";
import { CONFIG } from "../src/shared/config";
import type { Command, TutorialPart } from "../src/shared/types";

function tutorial(part: TutorialPart = 1, place = true) {
  const e = new Engine("LESSON", "1v1", TUTORIAL.seed);
  e.addPlayer("learner", "Explorer", 0);
  e.setupTutorial("learner", 0, part);
  if (part === 1 && place) e.place("learner", 40, 100);
  return e;
}
function action(e: Engine, id: string, kind: Command, power?: number) {
  const p = e.player("learner")!;
  const target = e.match.buildings.find((b) => b.id === id) ?? e.player(id)!;
  p.x = target.x;
  p.y = target.y;
  if (power !== undefined) p.power = power;
  e.actions.set(p.id, { playerId: p.id, targetId: id, kind });
  e.step(e.match.tick * 200);
}
function capture(e: Engine, id: string) {
  action(
    e,
    id,
    "attack",
    attackCost(e.match.buildings.find((b) => b.id === id)!) + 1,
  );
}
function core(e: Engine) {
  return e.player("learner")!.coreId!;
}

test("Part 1 preserves seeded neutrals and private placement, requires move/single/double/hold in order including zero max", () => {
  const e = tutorial(1, false);
  const view = e.snapshot("learner", 0);
  assert.equal(view.tutorial?.stage, "place");
  assert.ok(
    view.buildings.every((b) => b.power === undefined && b.teamId === null),
  );
  assert.deepEqual(
    e.match.buildings.filter((b) => b.kind !== "core"),
    generateMap(175).buildings,
  );
  assert.equal(
    e.match.buildings.find((b) => b.ownerId === e.tutorial!.opponentId)!.power,
    100,
  );
  e.place("learner", 40, 100);
  assert.equal(e.tutorial!.stage, "move");
  action(e, core(e), "half"); // An early transfer does not skip movement.
  assert.equal(e.tutorial!.stage, "move");
  action(e, core(e), "deposit");
  e.input("learner", { x: 1, y: 0 }, 0);
  e.step(0);
  e.step(200);
  assert.equal(e.tutorial!.stage, "half");
  action(e, core(e), "max");
  assert.equal(e.tutorial!.stage, "half");
  action(e, core(e), "deposit");
  action(e, core(e), "half");
  assert.equal(e.tutorial!.stage, "max");
  assert.equal(e.player("learner")!.power, 11);
  action(e, core(e), "max");
  assert.equal(e.player("learner")!.power, 11);
  assert.equal(e.tutorial!.stage, "deposit");
  action(e, core(e), "deposit");
  assert.equal(e.match.phase, "finished");
  assert.equal(e.match.result!.winner, 0);
  e.nextTutorial();
  assert.equal(e.tutorial!.part, 2);
  assert.equal(e.match.phase, "playing");
  assert.equal(e.match.seed, 175);
  assert.equal(e.tutorial!.stage, "firstPlant");
});

test("Part 2 starts with 45, carries 6, spends 5 on seeded Plant; Plant capture immediately merges collection and Fort guidance", () => {
  const e = tutorial(2);
  assert.equal(e.match.buildings.find((b) => b.id === core(e))!.power, 45);
  e.player("learner")!.power = 1;
  action(e, core(e), "half");
  assert.equal(e.player("learner")!.power, 6);
  action(e, TUTORIAL.firstPlant, "attack");
  assert.equal(e.player("learner")!.power, 1);
  assert.equal(e.tutorial!.stage, "fort");
  action(e, TUTORIAL.firstPlant, "half");
  assert.equal(
    e.tutorial!.stage,
    "fort",
    "A zero withdrawal does not stall the merged task",
  );
  for (let i = 0; i < 130; i++) e.step(e.match.tick * 200);
  action(e, TUTORIAL.firstPlant, "max");
  assert.equal(e.tutorial!.stage, "fort");
  assert.ok(e.player("learner")!.power > 12);
  action(e, TUTORIAL.firstFort, "attack");
  assert.equal(e.match.phase, "finished");
  assert.equal(
    e.match.buildings.find((b) => b.id === TUTORIAL.firstFort)!.power,
    1,
  );
});

test("All parts use normal Core victory without tutorial attack restrictions; reconnect and fixed retry retain the selected part", () => {
  for (const part of [1, 2, 3, 4] as const) {
    const e = tutorial(part);
    e.disconnect("learner", 0);
    e.reconnect("learner", 200);
    assert.equal(e.hostId, "learner");
    capture(e, e.player(e.tutorial!.opponentId)!.coreId!);
    assert.equal(e.match.phase, "finished");
    assert.equal(e.match.result?.winner, 0);
    e.rematch();
    assert.equal(e.tutorial!.part, part);
    assert.equal(e.match.phase, part === 1 ? "placement" : "playing");
  }
  const ordinary = new Engine("NORMAL", "1v1", TUTORIAL.seed);
  ordinary.addPlayer("normal", "Normal", 0);
  assert.equal("tutorial" in ordinary.snapshot("normal"), false);
});

test("Part 3 AI flees/approaches using normal speed; one 8-tick sprint catches it and a normal player attack completes", () => {
  const e = tutorial(3);
  const p = e.player("learner")!,
    enemy = e.player(e.tutorial!.opponentId)!;
  assert.equal(enemy.power, 20);
  assert.equal(e.match.buildings.find((b) => b.id === core(e))!.power, 100);
  action(e, core(e), "half");
  assert.equal(p.power, 51);
  assert.equal(e.tutorial!.stage, "chase");
  // No sprint: the lighter opponent stays beyond interaction range.
  for (let i = 0; i < 15; i++) {
    const gap = distance(p, enemy);
    e.input(
      p.id,
      { x: (enemy.x - p.x) / gap, y: (enemy.y - p.y) / gap },
      e.match.tick * 200,
    );
    e.step(e.match.tick * 200);
    assert.ok(distance(p, enemy) > CONFIG.interactionRadius);
    assert.ok(e.snapshot(p.id).players.some((q) => q.id === enemy.id));
  }
  let sprints = 0;
  for (let i = 0; i < 15 && distance(p, enemy) > 7.5; i++) {
    const gap = distance(p, enemy);
    const sprint = p.sprintTicks <= 1 && sprints < 2;
    if (sprint) sprints++;
    e.input(
      p.id,
      { x: (enemy.x - p.x) / gap, y: (enemy.y - p.y) / gap, sprint },
      e.match.tick * 200,
    );
    e.step(e.match.tick * 200);
  }
  assert.ok(distance(p, enemy) <= CONFIG.interactionRadius);
  assert.equal(sprints, 1);
  assert.equal(p.power, 41);
  e.actions.set(p.id, { playerId: p.id, targetId: enemy.id, kind: "attack" });
  e.step(e.match.tick * 200);
  assert.equal(p.power, 31);
  assert.equal(e.match.phase, "finished");
  assert.equal(
    enemy.power,
    1,
    "Normal player defeat still respawns the opponent",
  );
});

test("Part 4 owns closest assets at 1, discovers Core through shared building vision and counts earlier captures", () => {
  const e = tutorial(4),
    t = e.tutorial!,
    p = e.player("learner")!;
  const owned = e.match.buildings.filter(
    (b) => b.kind !== "core" && b.teamId !== null,
  );
  assert.equal(
    owned.filter((b) => b.teamId === 0 && b.kind === "plant").length,
    3,
  );
  assert.equal(
    owned.filter((b) => b.teamId === 1 && b.kind === "plant").length,
    1,
  );
  assert.equal(
    owned.filter((b) => b.teamId === 1 && b.kind === "fort").length,
    1,
  );
  assert.ok(owned.every((b) => b.power === 1));
  assert.ok(
    e.match.buildings
      .filter((b) => b.kind === "core")
      .every((b) => b.power === 100),
  );
  assert.deepEqual(e.snapshot(p.id).tutorial!.markers, []);
  capture(e, t.enemyFortId!);
  assert.ok(distance(p, TUTORIAL.enemyCore) > CONFIG.vision.player);
  assert.equal(
    t.stage,
    "enemyPlant",
    "The captured Fort provides shared vision of the Core",
  );
  assert.equal(
    e.match.buildings.find((b) => b.id === t.enemyFortId)!.teamId,
    0,
  );
  p.x = TUTORIAL.suggestedCore.x;
  p.y = TUTORIAL.suggestedCore.y;
  e.step(600);
  assert.equal(
    t.stage,
    "enemyPlant",
    "Discovery stays completed after walking away",
  );
  assert.ok(e.snapshot(p.id).tutorial!.markers.every((m) => !("power" in m)));
  capture(e, "b4");
  assert.equal(t.stage, "enemyPlant", "A different Plant is not the objective");
  capture(e, t.enemyPlantId!);
  assert.equal(
    t.stage,
    "core",
    "The earlier Fort capture counts without replaying an event",
  );
  capture(e, e.player(t.opponentId)!.coreId!);
  assert.equal(e.match.phase, "finished");
  assert.throws(() => e.nextTutorial(), /not available/);
});

test("Part 2 accepts out-of-order Fort capture and needs no Plant withdrawal event", () => {
  const e = tutorial(2);
  capture(e, TUTORIAL.firstFort);
  assert.equal(e.match.phase, "playing");
  assert.equal(
    e.match.buildings.find((b) => b.id === TUTORIAL.firstFort)!.teamId,
    0,
  );
  capture(e, "b5");
  assert.equal(
    e.match.phase,
    "playing",
    "Unrelated capture is not the required Plant",
  );
  capture(e, TUTORIAL.firstPlant);
  assert.equal(e.match.phase, "finished");
  assert.equal(e.match.result?.winner, 0);
});

test("Part 3 can be won without Sprint by pursuing the opponent into the coastline", () => {
  const e = tutorial(3),
    p = e.player("learner")!,
    enemy = e.player(e.tutorial!.opponentId)!;
  action(e, core(e), "half");
  for (let i = 0; i < 100 && distance(p, enemy) > 5; i++) {
    const gap = distance(p, enemy);
    e.input(
      p.id,
      { x: (enemy.x - p.x) / gap, y: (enemy.y - p.y) / gap },
      e.match.tick * 200,
    );
    e.step(e.match.tick * 200);
  }
  assert.ok(distance(p, enemy) <= 5);
  assert.equal(p.power, 51);
  assert.equal(p.sprintTicks, 0);
  e.actions.set(p.id, { playerId: p.id, targetId: enemy.id, kind: "attack" });
  e.step(e.match.tick * 200);
  assert.equal(p.power, 41);
  assert.equal(enemy.power, 1);
  assert.equal(e.match.phase, "finished");
});
