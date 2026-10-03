import { test } from "node:test";
import assert from "node:assert/strict";
import { Engine } from "../src/server/engine";
import { CONFIG, normalSpeed } from "../src/shared/config";
import { generateMap, inZone, validPoint } from "../src/shared/map";
import { attackCost, nearest, transfer } from "../src/shared/rules";
import type { Action, Building, Mode } from "../src/shared/types";
function game(mode: Mode = "1v1") {
  const e = new Engine("ABCDEF", mode, 12345);
  for (let i = 0; i < (mode === "1v1" ? 2 : 4); i++)
    e.addPlayer(`p${i}`, `Player ${i}`, 0);
  e.start(0);
  for (const p of e.match.players) {
    let placed = false;
    for (let x = 40; x <= 160 && !placed; x += 10)
      for (let y = 40; y <= 160 && !placed; y += 10) {
        if (!inZone({ x, y }, p.zone, mode)) continue;
        try {
          e.place(p.id, x, y);
          placed = true;
        } catch {}
      }
    assert.ok(placed);
  }
  assert.equal(e.match.phase, "playing");
  return e;
}
function act(e: Engine, id: string, targetId: string, kind: Action["kind"]) {
  e.actions.set(id, { playerId: id, targetId, kind });
}
function building(
  e: Engine,
  kind: Building["kind"] = "fort",
  power = 40,
  teamId: 0 | 1 | null = null,
) {
  const b: Building = {
    id: "test",
    x: 100,
    y: 100,
    kind,
    power,
    teamId,
    productionTick: 0,
  };
  e.match.buildings.push(b);
  return b;
}
test("Core withdrawals conserve integer Power and enforce reserve without replenishment", () => {
  const e = game(),
    p = e.match.players[0],
    b = e.match.buildings.find((b) => b.id === p.coreId)!;
  assert.equal(transfer(p, b, "half"), 10);
  assert.equal(p.power, 11);
  assert.equal(b.power, 40);
  assert.equal(transfer(p, b, "max"), 0);
  assert.equal(transfer(p, b, "deposit"), 10);
  assert.equal(p.power, 1);
  assert.equal(b.power, 50);
  b.power = 100;
  assert.equal(transfer(p, b, "half"), 50);
  assert.equal(b.power, 50);
  b.power = 20;
  const before = p.power;
  assert.equal(transfer(p, b, "max"), 0);
  assert.equal(b.power, 20);
  assert.equal(p.power, before);
  b.kind = "plant";
  b.power = 5;
  assert.equal(transfer(p, b, "half"), 2);
  assert.equal(b.power, 3);
  b.power = 0;
  assert.equal(transfer(p, b, "max"), 0);
  assert.equal(b.power, 0);
});
test("Sprint requires >10, uses post-cost speed, lasts five ticks, cannot stack", () => {
  const e = game(),
    p = e.match.players[0];
  p.x = 100;
  p.y = 100;
  p.power = 10;
  e.input(p.id, { x: 1, y: 0, sprint: true }, 0);
  e.step(0);
  assert.equal(p.power, 10);
  assert.equal(p.sprintTicks, 0);
  p.power = 11;
  p.x = 100;
  e.input(p.id, { x: 1, y: 0, sprint: true }, 200);
  e.step(200);
  assert.equal(p.power, 1);
  assert.equal(p.sprintTicks, 5);
  assert.equal(p.x, 100 + normalSpeed(1) * 1.5 * 0.2);
  p.power = 30;
  e.input(p.id, { x: 0, y: 0, sprint: true }, 400);
  e.step(400);
  assert.equal(p.power, 30);
  assert.equal(p.sprintTicks, 4);
  for (let i = 0; i < 4; i++) e.step(600 + i * 200);
  assert.equal(p.sprintTicks, 0);
});
test("Strict thresholds, ceil costs, defeat respawns and cancels Sprint", () => {
  const e = game(),
    [a, b] = e.match.players;
  a.x = b.x = 100;
  a.y = b.y = 100;
  a.power = b.power = 50;
  assert.notEqual(nearest(e.match, a)?.id, b.id);
  act(e, a.id, b.id, "attack");
  e.step(0);
  assert.equal(a.power, 50);
  assert.equal(b.power, 50);
  a.power = 51;
  b.sprintTicks = 4;
  act(e, a.id, b.id, "attack");
  e.step(200);
  assert.equal(a.power, 26);
  assert.equal(b.power, 1);
  assert.equal(b.sprintTicks, 0);
  const core = e.match.buildings.find((t) => t.id === b.coreId)!;
  assert.equal(b.x, core.x);
  assert.equal(b.y, core.y);
  b.power = 51;
  assert.equal(attackCost(b), 26);
});
test("Plant capture costs 60%, resets to zero, failed attacks change nothing", () => {
  const e = game(),
    p = e.match.players[0],
    b = building(e, "plant", 50);
  p.x = p.y = 100;
  p.power = 30;
  act(e, p.id, b.id, "attack");
  e.step(0);
  assert.equal(p.power, 30);
  assert.equal(b.power, 50);
  assert.equal(b.teamId, null);
  p.power = 31;
  act(e, p.id, b.id, "attack");
  e.step(200);
  assert.equal(p.power, 1);
  assert.equal(b.power, 0);
  assert.equal(b.teamId, 0);
});
test("Only owned buildings produce; capture does not reset the tick schedule", () => {
  const e = game(),
    p = e.match.players[0],
    b = building(e, "plant", 20);
  p.x = p.y = 100;
  p.power = 100;
  for (let i = 0; i < 9; i++) e.step(i * 200);
  assert.equal(b.power, 20);
  act(e, p.id, b.id, "attack");
  e.step(1800);
  assert.equal(b.power, 0);
  assert.equal(b.productionTick, 10);
  for (let i = 0; i < 10; i++) e.step(2000 + i * 200);
  assert.equal(b.power, 1);
  const core = e.match.buildings.find((t) => t.id === p.coreId)!;
  for (let i = 0; i < 30; i++) e.step(4000 + i * 200);
  assert.equal(core.power, 51);
});
test("All transfers precede attacks even when attacker entered first", () => {
  const e = game(),
    [a, b] = e.match.players,
    t = building(e, "fort", 20, 1);
  a.x = b.x = a.y = b.y = 100;
  a.power = 25;
  b.power = 11;
  act(e, a.id, t.id, "attack");
  act(e, b.id, t.id, "deposit");
  e.step(0);
  assert.equal(t.power, 30);
  assert.equal(t.teamId, 1);
  assert.equal(a.power, 25);
  assert.equal(b.power, 1);
});
test("Team transfers resolve in room-entry order without spending storage twice", () => {
  const e = game("2v2"),
    [a, b] = e.match.players,
    t = building(e, "fort", 21, 0);
  a.x = b.x = a.y = b.y = 100;
  act(e, b.id, t.id, "max");
  act(e, a.id, t.id, "half");
  e.step(0);
  assert.equal(a.power, 11);
  assert.equal(b.power, 11);
  assert.equal(t.power, 1);
});
test("Later teammate attack cannot reattack a building captured this tick", () => {
  const e = game("2v2"),
    [a, b] = e.match.players,
    t = building(e, "fort", 20, null);
  a.x = b.x = a.y = b.y = 100;
  a.power = b.power = 30;
  act(e, a.id, t.id, "attack");
  act(e, b.id, t.id, "attack");
  e.step(0);
  assert.equal(a.power, 10);
  assert.equal(b.power, 30);
  assert.equal(t.teamId, 0);
});
test("Mutual final Core destruction settles after both attacks; score includes destroyed reserves", () => {
  const e = game(),
    [a, b] = e.match.players,
    ca = e.match.buildings.find((t) => t.id === a.coreId)!,
    cb = e.match.buildings.find((t) => t.id === b.coreId)!;
  ca.x = cb.x = ca.y = cb.y = a.x = b.x = a.y = b.y = 100;
  ca.power = 40;
  cb.power = 50;
  a.power = 110;
  b.power = 80;
  act(e, a.id, cb.id, "attack");
  act(e, b.id, ca.id, "attack");
  e.step(0);
  assert.equal(e.match.phase, "finished");
  assert.equal(e.match.result?.winner, 0);
  assert.deepEqual(e.match.result?.totals, [100, 90]);
});
test("Equal mutual Core scores produce a draw", () => {
  const e = game(),
    [a, b] = e.match.players;
  for (const t of e.match.buildings.filter((t) => t.kind === "core"))
    t.x = t.y = 100;
  a.x = b.x = a.y = b.y = 100;
  a.power = b.power = 100;
  act(e, a.id, b.coreId!, "attack");
  act(e, b.id, a.coreId!, "attack");
  e.step(0);
  assert.equal(e.match.result?.winner, null);
  assert.deepEqual(e.match.result?.totals, [100, 100]);
});
test("Individual surrender retires personal Core only; whole-team elimination neutralizes shared storage", () => {
  const e = game("2v2"),
    [a, b] = e.match.players,
    t = building(e, "fort", 31, 0);
  e.surrender(a.id);
  e.step(0);
  assert.equal(a.alive, false);
  assert.equal(b.alive, true);
  assert.equal(t.teamId, 0);
  assert.equal(t.power, 31);
  assert.equal(e.match.phase, "playing");
  assert.ok(!e.match.buildings.some((t) => t.ownerId === a.id));
  e.surrender(b.id);
  e.step(200);
  assert.equal(t.teamId, null);
  assert.equal(t.power, 31);
  assert.equal(e.match.result?.winner, 1);
});
test("Current team vision filters payload, no remembered enemy markers, friendly Core persists", () => {
  const e = game(),
    [a, b] = e.match.players;
  const ca = e.match.buildings.find((t) => t.id === a.coreId)!,
    cb = e.match.buildings.find((t) => t.id === b.coreId)!;
  ca.x = 40;
  ca.y = 100;
  a.x = 40;
  a.y = 100;
  cb.x = 160;
  cb.y = 100;
  b.x = 160;
  b.y = 100;
  let s = e.snapshot(a.id);
  assert.ok(s.buildings.some((t) => t.id === ca.id));
  assert.ok(!s.buildings.some((t) => t.id === cb.id));
  assert.ok(!s.players.some((t) => t.id === b.id));
  a.x = 150;
  s = e.snapshot(a.id);
  assert.ok(s.buildings.some((t) => t.id === cb.id));
  a.x = 40;
  s = e.snapshot(a.id);
  assert.ok(!s.buildings.some((t) => t.id === cb.id));
});
test("Disconnect stops inputs, reconnect within window survives; active inactivity does not retire", () => {
  const e = game(),
    p = e.match.players[0];
  e.disconnect(p.id, 0);
  e.input(p.id, { x: 1, y: 1 }, 0);
  const x = p.x;
  e.step(29_999);
  assert.equal(p.x, x);
  assert.equal(p.alive, true);
  e.reconnect(p.id, 29_999);
  e.step(60_000);
  assert.equal(p.alive, true);
  e.disconnect(p.id, 60_000);
  e.step(90_000);
  assert.equal(p.alive, false);
});
test("Unplaced timeout cannot retain survival slot; placed waiting teammate stays alive", () => {
  const e = new Engine("ABCD", "2v2", 123);
  for (let i = 0; i < 4; i++) e.addPlayer(`p${i}`, `P${i}`, 0);
  e.start(0);
  for (const p of e.match.players.slice(0, 3)) {
    for (let x = 40; x <= 160 && !p.coreId; x += 10)
      for (let y = 40; y <= 160 && !p.coreId; y += 10)
        if (inZone({ x, y }, p.zone, "2v2")) {
          try {
            e.place(p.id, x, y);
          } catch {}
        }
  }
  e.step(30_000);
  assert.equal(e.match.players[3].alive, false);
  assert.equal(e.match.players[0].alive, true);
  assert.equal(e.match.phase, "playing");
});
test("Locked interaction invalidated by distance is canceled rather than redirected", () => {
  const e = game(),
    p = e.match.players[0],
    b = building(e, "fort", 20, 0);
  p.x = p.y = 100;
  e.begin(p.id, 0);
  e.resolve(p.id, "max", 300);
  p.x = 130;
  const power = p.power;
  e.step(300);
  assert.equal(p.power, power);
  assert.equal(b.power, 20);
});
test("Rematch creates a new seed and resets all players, cores and counters", () => {
  const e = game(),
    seed = e.match.seed;
  e.surrender("p0");
  e.step(0);
  e.rematch();
  assert.notEqual(e.match.seed, seed);
  assert.equal(e.match.phase, "lobby");
  assert.equal(e.match.tick, 0);
  assert.ok(
    e.match.players.every((p) => p.alive && p.power === 1 && !p.coreId),
  );
  assert.ok(e.match.buildings.every((b) => b.teamId === null));
});
test("Many seeded maps have valid footprints and Core placement space in every zone", () => {
  for (let seed = 0; seed < 100; seed++) {
    const { boundary, buildings } = generateMap(seed);
    assert.equal(buildings.length, 18);
    assert.ok(buildings.every((b) => validPoint(b, boundary, 8)));
    for (let z = 0; z < 4; z++)
      assert.ok(
        [
          { x: 60, y: 60 },
          { x: 140, y: 60 },
          { x: 60, y: 140 },
          { x: 140, y: 140 },
        ].some((p) => inZone(p, z, "2v2") && validPoint(p, boundary)),
      );
  }
});

test("Diagonal normalization and boundary-only movement do not block on buildings", () => {
  const e = game(),
    p = e.match.players[0];
  p.x = p.y = 100;
  const speed = normalSpeed(p.power) * 0.2;
  building(e, "fort", 20);
  e.input(p.id, { x: 1, y: 1 }, 0);
  e.step(0);
  assert.ok(Math.abs(Math.hypot(p.x - 100, p.y - 100) - speed) < 1e-9);
  p.x = 180;
  p.y = 100;
  for (let i = 1; i < 30; i++) {
    e.input(p.id, { x: 1, y: 0 }, i * 200);
    e.step(i * 200);
    assert.ok(validPoint(p, e.match.boundary));
  }
});
test("Player selection is revalidated after a transfer changes the strength relationship", () => {
  const e = game(),
    [a, b] = e.match.players;
  a.x = b.x = a.y = b.y = 100;
  a.power = 20;
  b.power = 15;
  const t = building(e, "fort", 21, 1);
  act(e, a.id, b.id, "attack");
  act(e, b.id, t.id, "max");
  e.step(0);
  assert.equal(a.power, 20);
  assert.equal(b.power, 35);
});
test("Two attacks cannot pay for the same player defeat or Core destruction twice", () => {
  const e = game("2v2"),
    [a, b, c] = e.match.players;
  a.x = b.x = c.x = a.y = b.y = c.y = 100;
  a.power = b.power = 100;
  c.power = 20;
  act(e, a.id, c.id, "attack");
  act(e, b.id, c.id, "attack");
  e.step(0);
  assert.equal(a.power, 90);
  assert.equal(b.power, 100);
  assert.equal(c.power, 1);
  const core = e.match.buildings.find((t) => t.id === c.coreId)!;
  core.x = core.y = 100;
  act(e, a.id, core.id, "attack");
  act(e, b.id, core.id, "attack");
  e.step(200);
  assert.equal(a.power, 40);
  assert.equal(b.power, 100);
  assert.equal(c.alive, false);
});
test("Failed zero/positive-cost building attacks preserve state and captured zero buildings remain capturable", () => {
  const e = game(),
    p = e.match.players[0],
    t = building(e, "fort", 0, 1);
  p.x = p.y = 100;
  act(e, p.id, t.id, "attack");
  e.step(0);
  assert.equal(p.power, 1);
  assert.equal(t.teamId, 0);
  assert.equal(t.power, 0);
});

test("Random neutral reserves are seeded integers and remain finite economic targets", () => {
  const powers = new Set<number>();
  for (let seed = 0; seed < 100; seed++) {
    const first = generateMap(seed),
      second = generateMap(seed);
    assert.deepEqual(first, second);
    for (const building of first.buildings) {
      assert.ok(Number.isInteger(building.power));
      assert.ok(
        building.power >= CONFIG.neutralInitialPowerMin &&
          building.power <= CONFIG.neutralInitialPowerMax,
      );
      powers.add(building.power);
    }
  }
  assert.ok(powers.size > 1);
  const e = game(),
    p = e.match.players[0],
    core = e.match.buildings.find((b) => b.id === p.coreId)!;
  // With no neutral production, Core output can eventually fund any initial
  // Plant, including after the first withdrawal has been spent on Sprint.
  transfer(p, core, "max");
  e.input(p.id, { x: 0, y: 0, sprint: true }, 0);
  e.step(0);
  for (let i = 1; i < 1500; i++) e.step(i * 200);
  transfer(p, core, "max");
  assert.ok(
    e.match.buildings
      .filter((b) => b.kind === "plant")
      .every((b) => p.power > attackCost(b)),
  );
});

test("Neutral buildings never produce or bank Power; owned schedules continue across capture and neutralization", () => {
  const e = game("2v2"),
    [a, b] = e.match.players,
    t = building(e, "plant", 10, null);
  a.x = a.y = 100;
  a.power = 100;
  for (let i = 0; i < 99; i++) e.step(i * 200);
  assert.equal(t.power, 10);
  assert.equal(t.productionTick, 99);
  // At due tick 100 it is still neutral during production, then capture resets storage.
  act(e, a.id, t.id, "attack");
  e.step(19_800);
  assert.equal(t.power, 0);
  assert.equal(t.productionTick, 100);
  for (let i = 0; i < 9; i++) e.step(20_000 + i * 200);
  assert.equal(t.power, 0);
  e.step(21_800);
  assert.equal(t.power, 1);
  e.surrender(a.id);
  e.step(22_000);
  assert.equal(t.teamId, 0);
  e.surrender(b.id);
  e.step(22_200);
  assert.equal(t.teamId, null);
  const stored = t.power;
  // Keep the simulation alive as a test fixture to verify post-neutralization ticks.
  e.match.phase = "playing";
  e.match.players[0].alive = true;
  e.match.players[0].coreId = "fixture";
  for (let i = 0; i < 20; i++) e.step(22_400 + i * 200);
  assert.equal(t.power, stored);
});

test("Placement discloses only personal-zone neutrals without Power, including in 2v2", () => {
  for (const mode of ["1v1", "2v2"] as const) {
    const e = new Engine("TEST", mode, 91);
    for (let i = 0; i < (mode === "1v1" ? 2 : 4); i++)
      e.addPlayer(`p${i}`, `P${i}`, 0);
    e.start(0);
    for (const p of e.match.players) {
      const s = e.snapshot(p.id);
      const neutrals = s.buildings.filter((b) => b.kind !== "core");
      assert.ok(neutrals.every((b) => inZone(b, p.zone, mode)));
      assert.ok(neutrals.every((b) => !("power" in b)));
      assert.equal(
        neutrals.length,
        e.match.buildings.filter(
          (b) => b.kind !== "core" && inZone(b, p.zone, mode),
        ).length,
      );
    }
  }
});
test("Lobby team selection respects capacities, consent swaps, entry order and rematch preference", () => {
  const e = new Engine("TEAM", "2v2", 91);
  e.addPlayer("a", "A");
  e.addPlayer("b", "B");
  e.chooseTeam("a", 1);
  e.addPlayer("c", "C");
  e.addPlayer("d", "D");
  assert.deepEqual(
    e.match.players.map((p) => p.teamId),
    [1, 0, 0, 1],
  );
  assert.throws(() => e.chooseTeam("b", 1), /full/);
  e.requestSwap("b", "a");
  assert.deepEqual(e.snapshot("a").swapRequests, [{ fromId: "b", toId: "a" }]);
  e.replySwap("a", "b", false);
  assert.equal(e.player("b")!.teamId, 0);
  e.requestSwap("b", "a");
  assert.throws(() => e.replySwap("d", "b", true), /no longer/);
  e.replySwap("a", "b", true);
  assert.deepEqual(
    e.match.players.map((p) => p.teamId),
    [0, 1, 0, 1],
  );
  assert.deepEqual(
    e.match.players.map((p) => p.order),
    [0, 1, 2, 3],
  );
  e.start(0);
  assert.throws(() => e.chooseTeam("b", 0), /lobby/);
  assert.equal(e.player("a")!.zone ^ e.player("c")!.zone, 3);
  assert.equal(e.player("b")!.zone ^ e.player("d")!.zone, 3);
  e.match.phase = "finished";
  e.rematch();
  assert.deepEqual(
    e.match.players.map((p) => p.teamId),
    [0, 1, 0, 1],
  );
});
test("Leaving a lobby preserves the remaining players chosen teams and fills the open seat", () => {
  const e = new Engine("TEAM", "2v2", 91);
  for (let i = 0; i < 4; i++) e.addPlayer(`p${i}`, `P${i}`);
  e.requestSwap("p0", "p2");
  e.replySwap("p2", "p0", true);
  e.disconnect("p1", 0);
  e.retirements.set("p1", "Left lobby.");
  e.step(0);
  assert.deepEqual(
    e.match.players.map((p) => [p.id, p.teamId, p.order]),
    [
      ["p0", 1, 0],
      ["p2", 0, 2],
      ["p3", 1, 3],
    ],
  );
  e.addPlayer("new", "New");
  assert.equal(e.player("new")!.teamId, 0);
  assert.equal(e.player("new")!.order, 4);
});
