import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/server/engine";
import { TUTORIAL } from "../src/shared/tutorial";
import { attackCost } from "../src/shared/rules";

function tutorial(place = true) {
  const e = new Engine("LESSON", "1v1", TUTORIAL.seed);
  e.addPlayer("learner", "Explorer", 0);
  e.setupTutorial("learner", 0);
  if (place) e.place("learner", 40, 100); // Deliberately not the suggested spot.
  return e;
}
function capture(e: Engine, id: string) {
  const p = e.player("learner")!,
    b = e.match.buildings.find((b) => b.id === id)!;
  p.x = b.x;
  p.y = b.y;
  p.power = attackCost(b) + 1;
  e.actions.set(p.id, { playerId: p.id, targetId: id, kind: "attack" });
  e.step(e.match.tick * 200);
  assert.equal(p.power, 1);
}
test("Tutorial uses seed 175, ordinary placement and production; annotations do not reveal hidden entities or Power", () => {
  const e = tutorial(false);
  const initial = e.snapshot("learner", 0);
  assert.equal(initial.tutorial?.stage, "place");
  assert.equal(
    initial.buildings.some((b) => b.kind === "core"),
    false,
  );
  assert.ok(initial.buildings.every((b) => b.power === undefined));
  const enemyPlant = e.match.buildings.find(
    (b) => b.id === e.tutorial!.enemyPlantId,
  )!;
  assert.equal(enemyPlant.power, 1);
  assert.equal(enemyPlant.id, "b4");
  assert.equal(
    e.match.buildings.find(
      (b) => b.id === e.player(e.tutorial!.opponentId)!.coreId,
    )!.power,
    100,
  );
  assert.equal(enemyPlant.teamId, 1);
  e.place("learner", 40, 100);
  assert.equal(e.snapshot("learner").tutorial?.stage, "withdraw");
  const opponent = e.player(e.tutorial!.opponentId)!;
  const original = { x: opponent.x, y: opponent.y, power: opponent.power };
  for (let i = 0; i < 10; i++) e.step(i * 200);
  assert.equal(enemyPlant.power, 2);
  assert.deepEqual(
    { x: opponent.x, y: opponent.y, power: opponent.power },
    original,
  );
  const core = e.match.buildings.find(
    (b) => b.id === e.player("learner")!.coreId,
  )!;
  e.actions.set("learner", {
    playerId: "learner",
    targetId: core.id,
    kind: "half",
  });
  e.step(2000);
  assert.equal(e.player("learner")!.power, 11);
  assert.equal(core.power, 40);
  assert.equal(e.snapshot("learner").tutorial?.stage, "firstPlant");
  capture(e, "b5"); // Any Plant, not the marked b0.
  const view = e.snapshot("learner");
  assert.equal(view.tutorial?.stage, "frontier");
  assert.ok(view.tutorial!.markers.some((m) => m.label === "Enemy Core"));
  assert.ok(view.tutorial!.markers.every((m) => !("power" in m)));
  assert.equal(
    view.buildings.some((b) => b.id === opponent.coreId),
    false,
  );
  assert.equal(
    view.buildings.some((b) => b.id === enemyPlant.id),
    false,
  );
});
test("Any second Plant advances tutorial; Fort storage and Core attack use ordinary costs", () => {
  const e = tutorial();
  capture(e, e.tutorial!.enemyPlantId); // Enemy Plant may even be captured first.
  assert.equal(e.snapshot("learner").tutorial?.stage, "frontier");
  assert.ok(
    e.snapshot("learner").tutorial!.markers.some((m) => m.label === "Plant"),
  );
  capture(e, "b5");
  assert.equal(e.snapshot("learner").tutorial?.stage, "expand");
  capture(e, "b14"); // Any Fort, not just the suggested one near the enemy Core.
  assert.equal(e.snapshot("learner").tutorial?.stage, "core");
  const fort = e.match.buildings.find((b) => b.id === "b14")!;
  const p = e.player("learner")!;
  p.power = 11;
  e.actions.set(p.id, { playerId: p.id, targetId: fort.id, kind: "deposit" });
  e.step(1000);
  assert.equal(fort.power, 11);
  assert.equal(p.power, 1);
  const enemyCore = e.player(e.tutorial!.opponentId)!.coreId!;
  capture(e, enemyCore);
  assert.equal(e.match.phase, "finished");
  assert.equal(e.match.result!.winner, 0);
  assert.equal(e.snapshot("learner").tutorial?.stage, "complete");
  e.rematch();
  assert.equal(e.match.seed, TUTORIAL.seed);
  assert.equal(e.match.phase, "placement");
  assert.equal(e.tutorial!.plants.size, 0);
  assert.equal(
    e.match.buildings.find((b) => b.id === e.tutorial!.enemyPlantId)!.power,
    1,
  );
});
test("Tutorial can finish before any suggested capture; reconnect restores the human host", () => {
  const e = tutorial();
  e.disconnect("learner", 0);
  assert.equal(e.hostId, undefined);
  e.reconnect("learner", 200);
  assert.equal(e.hostId, "learner");
  capture(e, e.player(e.tutorial!.opponentId)!.coreId!);
  assert.equal(e.match.phase, "finished");
  assert.equal(e.match.result!.winner, 0);
  assert.equal(e.tutorial!.plants.size, 0);
  const ordinary = new Engine("NORMAL", "1v1", TUTORIAL.seed);
  ordinary.addPlayer("normal", "Normal", 0);
  assert.equal("tutorial" in ordinary.snapshot("normal"), false);
});
