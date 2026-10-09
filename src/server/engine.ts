import { randomUUID } from "node:crypto";
import { CONFIG, normalSpeed } from "../shared/config";
import { TUTORIAL } from "../shared/tutorial";
import {
  constrainMove,
  distance,
  generateMap,
  inZone,
  rng,
  validPoint,
} from "../shared/map";
import {
  attackCost,
  eligible,
  nearest,
  transfer,
  visible,
  visionSources,
} from "../shared/rules";
import type {
  Action,
  Command,
  Input,
  Match,
  Mode,
  Player,
  Snapshot,
  TeamId,
  TutorialView,
  TutorialPart,
  TutorialStage,
} from "../shared/types";

export class Engine {
  match: Match;
  hostId?: string;
  mapVersion = randomUUID();
  tutorial?: {
    playerId: string;
    opponentId: string;
    part: TutorialPart;
    stage: TutorialStage;
    enemyPlantId?: string;
    enemyFortId?: string;
  };
  setupTutorial(playerId: string, now = Date.now(), part: TutorialPart = 1) {
    if (
      this.match.mode !== "1v1" ||
      this.match.seed !== TUTORIAL.seed ||
      this.match.players.length !== 1 ||
      !this.player(playerId) ||
      ![1, 2, 3, 4].includes(part)
    )
      throw new Error("Invalid tutorial setup.");
    const opponentId = `practice-${playerId}`;
    this.addPlayer(opponentId, "Practice opponent", now);
    this.start(now);
    this.player(playerId)!.zone = 0;
    this.player(opponentId)!.zone = 1;
    this.place(opponentId, TUTORIAL.enemyCore.x, TUTORIAL.enemyCore.y);
    this.match.buildings.find(
      (b) => b.id === this.player(opponentId)!.coreId,
    )!.power = TUTORIAL.enemyCorePower;
    this.tutorial = {
      playerId,
      opponentId,
      part,
      stage:
        part === 1
          ? "place"
          : part === 2
            ? "firstPlant"
            : part === 3
              ? "chase"
              : "frontier",
    };
    if (part !== 1) {
      this.place(playerId, TUTORIAL.suggestedCore.x, TUTORIAL.suggestedCore.y);
      const core = this.match.buildings.find(
        (b) => b.id === this.player(playerId)!.coreId,
      )!;
      core.power = part === 2 ? 45 : 100;
    }
    if (part === 3) {
      const opponent = this.player(opponentId)!;
      opponent.power = TUTORIAL.chasePower;
      opponent.x = TUTORIAL.suggestedCore.x + TUTORIAL.chaseDistance;
      opponent.y = TUTORIAL.suggestedCore.y;
    }
    if (part === 4) {
      const closest = (
        kind: "plant" | "fort",
        point: { x: number; y: number },
      ) =>
        this.match.buildings
          .filter((b) => b.kind === kind)
          .sort((a, b) => distance(a, point) - distance(b, point));
      const ownPlants = closest("plant", TUTORIAL.suggestedCore).slice(0, 3);
      const enemyPlant = closest("plant", TUTORIAL.enemyCore)[0];
      const enemyFort = closest("fort", TUTORIAL.enemyCore)[0];
      for (const b of ownPlants) {
        b.teamId = this.player(playerId)!.teamId;
        b.power = 1;
      }
      for (const b of [enemyPlant, enemyFort]) {
        b.teamId = this.player(opponentId)!.teamId;
        b.power = 1;
      }
      this.tutorial.enemyPlantId = enemyPlant.id;
      this.tutorial.enemyFortId = enemyFort.id;
    }
  }
  private tutorialView(): TutorialView | undefined {
    const t = this.tutorial;
    if (!t) return;
    const p = this.player(t.playerId);
    const marker = (
      point: { x: number; y: number } | undefined,
      label: string,
    ) => (point ? [{ x: point.x, y: point.y, label }] : []);
    const building = (id?: string) =>
      this.match.buildings.find((b) => b.id === id);
    const stage = this.match.phase === "finished" ? "complete" : t.stage;
    let markers: TutorialView["markers"] = [];
    if (stage === "place")
      markers = marker(TUTORIAL.suggestedCore, "Suggested Core");
    else if (["move", "half", "max", "deposit"].includes(stage))
      markers = marker(
        building(p?.coreId),
        stage === "move" ? "Your Core" : "Transfer Power",
      );
    else if (stage === "firstPlant")
      markers = marker(building(TUTORIAL.firstPlant), "Plant");
    else if (stage === "fort")
      markers = marker(building(TUTORIAL.firstFort), "Fort");
    else if (stage === "enemyPlant")
      markers = marker(building(t.enemyPlantId), "Enemy Plant");
    else if (stage === "enemyFort")
      markers = marker(building(t.enemyFortId), "Fort / Store Power");
    else if (stage === "core")
      markers = marker(
        building(this.player(t.opponentId)?.coreId),
        "Enemy Core",
      );
    // No moving-opponent position is sent outside normal vision.
    return { part: t.part, stage, markers };
  }
  private finishTutorial() {
    const t = this.tutorial!;
    t.stage = "complete";
    this.match.result = {
      winner: this.player(t.playerId)!.teamId,
      totals: this.teamTotals(),
      reason: `Part ${t.part} objective completed.`,
    };
    this.match.phase = "finished";
    this.inputs.clear();
    this.actions.clear();
    this.locks.clear();
  }
  private tutorialTransfer(targetId: string, kind: Command, amount: number) {
    const t = this.tutorial;
    if (!t || t.part !== 1 || targetId !== this.player(t.playerId)?.coreId)
      return;
    if (t.stage === "half" && kind === "half") t.stage = "max";
    // A maximum withdrawal of zero still demonstrates the gesture at the reserve.
    else if (t.stage === "max" && kind === "max") t.stage = "deposit";
    else if (t.stage === "deposit" && kind === "deposit" && amount > 0)
      this.finishTutorial();
  }
  private updateTutorial(opponentDefeated: boolean) {
    const t = this.tutorial;
    if (!t || this.match.phase !== "playing") return;
    const p = this.player(t.playerId)!;
    const owns = (id?: string) =>
      this.match.buildings.some((b) => b.id === id && b.teamId === p.teamId);
    if (t.part === 2) {
      if (owns(TUTORIAL.firstPlant)) {
        if (owns(TUTORIAL.firstFort)) this.finishTutorial();
        else t.stage = "fort";
      }
    } else if (t.part === 3) {
      if (opponentDefeated) this.finishTutorial();
    } else if (t.part === 4) {
      const enemyCore = this.match.buildings.find(
        (b) => b.id === this.player(t.opponentId)?.coreId,
      );
      if (
        t.stage === "frontier" &&
        (!enemyCore || !visible(this.match, p.teamId, enemyCore))
      )
        return;
      t.stage = !owns(t.enemyPlantId)
        ? "enemyPlant"
        : !owns(t.enemyFortId)
          ? "enemyFort"
          : "core";
    }
  }
  private tutorialMovement(now: number) {
    const t = this.tutorial;
    if (!t) return;
    const p = this.player(t.playerId)!;
    if (t.part !== 3 || !p.connected || !p.alive) return;
    const opponent = this.player(t.opponentId)!;
    const gap = distance(p, opponent);
    const direction =
      gap < TUTORIAL.chaseDistance
        ? -1
        : gap > TUTORIAL.chaseDistance + 1
          ? 1
          : 0;
    this.input(
      opponent.id,
      {
        x: gap ? (direction * (p.x - opponent.x)) / gap : 1,
        y: gap ? (direction * (p.y - opponent.y)) / gap : 0,
      },
      now,
    );
  }
  private tutorialMove() {
    const t = this.tutorial;
    if (!t || t.part !== 1 || t.stage !== "move") return;
    const p = this.player(t.playerId)!;
    const core = this.match.buildings.find((b) => b.id === p.coreId);
    if (core && distance(p, core) > CONFIG.entityRadius * 2) t.stage = "half";
  }
  ensureHost() {
    if (this.tutorial) {
      this.hostId = this.player(this.tutorial.playerId)?.connected
        ? this.tutorial.playerId
        : undefined;
      return;
    }
    if (this.match.players.some((p) => p.id === this.hostId && p.connected))
      return;
    const candidates = this.match.players.filter((p) => p.connected);
    this.hostId = candidates.length
      ? candidates[Math.floor(Math.random() * candidates.length)].id
      : undefined;
  }
  removePlayers(ids: Set<string>, reason: string) {
    if (this.match.phase !== "lobby" && this.match.phase !== "finished") {
      for (const id of ids)
        if (this.player(id)?.alive) this.retirements.set(id, reason);
      this.settle(this.teamTotals(), new Set(), new Set());
    }
    if (this.match.phase === "finished") {
      for (const id of ids) {
        const p = this.player(id);
        if (p?.alive) this.retire(p, reason);
      }
    }
    for (const id of ids) {
      this.clearSwaps(id);
      this.inputs.delete(id);
      this.actions.delete(id);
      this.locks.delete(id);
      this.retirements.delete(id);
      delete this.match.notices[id];
    }
    this.match.players = this.match.players.filter((p) => !ids.has(p.id));
    this.ensureHost();
  }
  inputs = new Map<string, Input & { at: number }>();
  actions = new Map<string, Action>();
  locks = new Map<string, { targetId: string; attack: boolean; at: number }>();
  retirements = new Map<string, string>();
  swapRequests = new Map<string, string>();
  constructor(
    code: string,
    mode: Mode,
    seed = Math.floor(Math.random() * 0xffffffff),
  ) {
    this.match = {
      code,
      mode,
      seed,
      phase: "lobby",
      tick: 0,
      players: [],
      ...generateMap(seed),
      notices: {},
    };
  }
  addPlayer(id: string, name: string, now = Date.now()) {
    if (this.match.phase !== "lobby")
      throw new Error("This match has already started.");
    const capacity = this.match.mode === "1v1" ? 2 : 4;
    if (this.match.players.length >= capacity)
      throw new Error("This room is full.");
    const order = Math.max(-1, ...this.match.players.map((p) => p.order)) + 1;
    const teamSize = this.match.mode === "1v1" ? 1 : 2;
    const teamId: TeamId =
      this.match.players.filter((p) => p.teamId === 0).length < teamSize
        ? 0
        : 1;
    this.match.players.push({
      id,
      name,
      teamId,
      order,
      zone: order,
      x: 100,
      y: 100,
      power: CONFIG.initialPlayerPower,
      alive: true,
      connected: true,
      sprintTicks: 0,
      placementAt: now,
    });
    this.ensureHost();
  }
  clearSwaps(id: string) {
    for (const [from, to] of this.swapRequests)
      if (from === id || to === id) this.swapRequests.delete(from);
  }
  lobbyPlayer(id: string) {
    const p = this.player(id);
    if (this.match.phase !== "lobby" || !p?.connected)
      throw new Error("Teams can only change in the lobby.");
    return p;
  }
  chooseTeam(id: string, teamId: unknown) {
    const p = this.lobbyPlayer(id);
    if (teamId !== 0 && teamId !== 1) throw new Error("Choose Mint or Coral.");
    if (p.teamId === teamId) return;
    const capacity = this.match.mode === "1v1" ? 1 : 2;
    if (
      this.match.players.filter((t) => t.teamId === teamId).length >= capacity
    )
      throw new Error("That team is full. Request a swap with a player.");
    p.teamId = teamId;
    this.clearSwaps(id);
  }
  requestSwap(id: string, targetId: string) {
    const p = this.lobbyPlayer(id),
      other = this.lobbyPlayer(targetId);
    if (p.teamId === other.teamId)
      throw new Error("Choose a player on the other team.");
    this.clearSwaps(id);
    this.swapRequests.set(id, targetId);
  }
  replySwap(id: string, fromId: string, accept: boolean) {
    const p = this.lobbyPlayer(id),
      other = this.lobbyPlayer(fromId);
    if (this.swapRequests.get(fromId) !== id)
      throw new Error("This swap request is no longer available.");
    this.swapRequests.delete(fromId);
    if (accept) {
      if (p.teamId === other.teamId)
        throw new Error("Teams have already changed.");
      [p.teamId, other.teamId] = [other.teamId, p.teamId];
      this.clearSwaps(id);
      this.clearSwaps(fromId);
    }
  }
  start(now = Date.now()) {
    const m = this.match;
    if (
      m.phase !== "lobby" ||
      m.players.length !== (m.mode === "1v1" ? 2 : 4) ||
      m.players.some((p) => !p.connected) ||
      [0, 1].some(
        (team) =>
          m.players.filter((p) => p.teamId === team).length !==
          (m.mode === "1v1" ? 1 : 2),
      )
    )
      throw new Error("Wait for all players to connect.");
    const random = rng(m.seed ^ 0xabcdef),
      flip = random() < 0.5;
    let layout: number[];
    if (m.mode === "1v1") layout = flip ? [1, 0] : [0, 1];
    else {
      const teamZones = CONFIG.diagonalTeams
        ? flip
          ? [
              [1, 2],
              [0, 3],
            ]
          : [
              [0, 3],
              [1, 2],
            ]
        : flip
          ? [
              [0, 1],
              [2, 3],
            ]
          : [
              [0, 2],
              [1, 3],
            ];
      for (const zones of teamZones) if (random() < 0.5) zones.reverse();
      layout = teamZones.flat();
    }
    const teamIndex = [0, 0];
    this.swapRequests.clear();
    m.players.forEach((p) => {
      p.zone =
        layout[
          m.mode === "1v1" ? p.teamId : p.teamId * 2 + teamIndex[p.teamId]++
        ];
      p.placementAt = now;
    });
    m.phase = "placement";
    m.startedAt = now;
  }
  place(id: string, x: number, y: number) {
    const m = this.match,
      p = this.player(id),
      point = { x, y };
    if (m.phase !== "placement" || !p?.alive || !p.connected || p.coreId)
      throw new Error("Core placement is not available.");
    if (
      !validPoint(point, m.boundary) ||
      !inZone(point, p.zone, m.mode) ||
      m.buildings.some((b) => distance(b, point) < CONFIG.corePlacementSpacing)
    )
      throw new Error(
        "Place inside your zone, away from buildings and the coast.",
      );
    p.coreId = `core-${id}`;
    p.x = x;
    p.y = y;
    m.buildings.push({
      id: p.coreId,
      kind: "core",
      ownerId: id,
      teamId: p.teamId,
      power: CONFIG.initialCorePower,
      productionTick: 0,
      x,
      y,
    });
    this.checkPlacement();
    if (this.tutorial?.playerId === id && this.tutorial.part === 1)
      this.tutorial.stage = "move";
  }
  player(id: string) {
    return this.match.players.find((p) => p.id === id);
  }
  checkPlacement() {
    const m = this.match;
    if (
      m.phase === "placement" &&
      m.players.filter((p) => p.alive).every((p) => p.coreId)
    ) {
      m.phase = "playing";
      m.tick = 0;
    }
  }
  input(id: string, input: Input, now = Date.now()) {
    const p = this.player(id);
    if (
      this.match.phase !== "playing" ||
      !p?.alive ||
      !p.connected ||
      !Number.isFinite(input.x) ||
      !Number.isFinite(input.y)
    )
      return;
    if (
      input.target &&
      (!Number.isFinite(input.target.x) ||
        !Number.isFinite(input.target.y) ||
        !validPoint(input.target, this.match.boundary))
    )
      return;
    const previous = this.inputs.get(id);
    this.inputs.set(id, {
      x: Math.max(-1, Math.min(1, input.x)),
      y: Math.max(-1, Math.min(1, input.y)),
      sprint: !!(input.sprint || previous?.sprint),
      target: input.target ? { ...input.target } : undefined,
      at: now,
    });
  }
  begin(id: string, now = Date.now()) {
    const p = this.player(id);
    if (this.match.phase !== "playing" || !p?.alive || !p.connected) return;
    const target = nearest(this.match, p);
    if (target)
      this.locks.set(id, {
        targetId: target.id,
        attack: !("kind" in target) || target.teamId !== p.teamId,
        at: now,
      });
    else this.locks.delete(id);
  }
  resolve(id: string, kind: Command, now = Date.now()) {
    const lock = this.locks.get(id);
    this.locks.delete(id);
    if (!lock || now - lock.at > 2500) return;
    this.actions.set(id, {
      playerId: id,
      targetId: lock.targetId,
      kind: lock.attack ? "attack" : kind,
    });
  }
  disconnect(id: string, now = Date.now()) {
    const p = this.player(id);
    if (!p) return;
    this.clearSwaps(id);
    p.connected = false;
    p.disconnectedAt = now;
    this.inputs.delete(id);
    this.locks.delete(id);
    this.actions.delete(id);
    this.ensureHost();
  }
  reconnect(id: string, now = Date.now()) {
    const p = this.player(id);
    if (!p) return;
    if (
      p.disconnectedAt !== undefined &&
      now - p.disconnectedAt >= CONFIG.timeoutMs
    )
      throw new Error("Session expired. Join a new room.");
    p.connected = true;
    p.disconnectedAt = undefined;
    this.ensureHost();
  }
  surrender(id: string) {
    if (this.player(id)?.alive) this.retirements.set(id, "Surrendered.");
  }
  teamTotals(): [number, number] {
    const m = this.match,
      totals: [number, number] = [0, 0];
    m.players
      .filter((p) => p.alive)
      .forEach((p) => (totals[p.teamId] += p.power));
    m.buildings.forEach((b) => {
      if (b.teamId !== null) totals[b.teamId] += b.power;
    });
    return totals;
  }
  retire(p: Player, reason: string) {
    p.alive = false;
    p.sprintTicks = 0;
    this.inputs.delete(p.id);
    this.actions.delete(p.id);
    this.locks.delete(p.id);
    this.match.buildings = this.match.buildings.filter(
      (b) => b.id !== p.coreId,
    );
    p.coreId = undefined;
    this.match.notices[p.id] = reason;
  }
  settle(
    totals: [number, number],
    destroyed: Set<string>,
    defeated: Set<string>,
  ) {
    const m = this.match;
    for (const p of m.players) {
      if (!p.alive) continue;
      if (this.retirements.has(p.id) || (p.coreId && destroyed.has(p.coreId)))
        this.retire(
          p,
          this.retirements.get(p.id) ?? "Your Core was destroyed.",
        );
      else if (defeated.has(p.id)) {
        const core = m.buildings.find((b) => b.id === p.coreId);
        if (core) {
          p.x = core.x;
          p.y = core.y;
          p.power = CONFIG.respawnPower;
          p.sprintTicks = 0;
          this.inputs.delete(p.id);
          this.locks.delete(p.id);
          m.notices[p.id] = "Defeated. Respawned with 1 Power.";
        }
      }
    }
    this.retirements.clear();
    const alive = [0, 1].map((t) =>
      m.players.some(
        (p) =>
          p.teamId === t && p.alive && (m.phase === "placement" || !!p.coreId),
      ),
    );
    for (const b of m.buildings)
      if (b.teamId !== null && !alive[b.teamId] && b.kind !== "core")
        b.teamId = null;
    if (!alive[0] || !alive[1]) {
      const both = !alive[0] && !alive[1];
      m.result = {
        winner: both
          ? totals[0] === totals[1]
            ? null
            : totals[0] > totals[1]
              ? 0
              : 1
          : alive[0]
            ? 0
            : 1,
        totals,
        reason: both
          ? "Both teams lost their last Core in the same tick. Total Power decides."
          : "The other team has no surviving Core.",
      };
      m.phase = "finished";
      this.inputs.clear();
      this.locks.clear();
    }
  }
  step(now = Date.now()) {
    const expired = new Set(
      this.match.players
        .filter(
          (p) =>
            !p.connected &&
            p.disconnectedAt !== undefined &&
            now - p.disconnectedAt >= CONFIG.timeoutMs,
        )
        .map((p) => p.id),
    );
    for (const id of expired)
      if (this.player(id)?.alive)
        this.retirements.set(id, "Disconnected for 30 seconds.");
    // Settle active timeouts in the existing tick order, then release seats in
    // every phase (including finished) and invalidate their sessions upstream.
    try {
      this.simulate(now);
    } finally {
      if (expired.size)
        this.removePlayers(expired, "Disconnected for 30 seconds.");
    }
  }
  private simulate(now: number) {
    const m = this.match;
    if (this.match.phase === "finished") return;
    for (const p of m.players)
      if (p.alive) {
        if (
          !p.connected &&
          p.disconnectedAt !== undefined &&
          now - p.disconnectedAt >= CONFIG.timeoutMs
        )
          this.retirements.set(p.id, "Disconnected for 30 seconds.");
        if (
          m.phase === "placement" &&
          !p.coreId &&
          p.placementAt !== undefined &&
          now - p.placementAt >= CONFIG.timeoutMs
        )
          this.retirements.set(p.id, "Core placement timed out.");
      }
    if (m.phase === "lobby") {
      // Expired lobby seats are removed so replacements may join before start.
      if (this.retirements.size) {
        m.players = m.players.filter((p) => !this.retirements.has(p.id));
        for (const id of this.retirements.keys()) this.clearSwaps(id);
        this.retirements.clear();
      }
      return;
    }
    if (m.phase === "placement") {
      this.settle(this.teamTotals(), new Set(), new Set());
      this.checkPlacement();
      return;
    }
    m.tick++;
    for (const b of m.buildings) {
      b.productionTick++;
      if (
        b.teamId !== null &&
        b.productionTick %
          (b.kind === "plant"
            ? CONFIG.plantProductionTicks
            : CONFIG.otherProductionTicks) ===
          0
      )
        b.power++;
    }
    this.tutorialMovement(now);
    for (const p of m.players)
      if (p.alive) {
        p.sprintTicks = Math.max(0, p.sprintTicks - 1);
        const input = this.inputs.get(p.id);
        if (
          !p.connected ||
          !input ||
          now - input.at > CONFIG.inputLeaseMs ||
          this.retirements.has(p.id)
        )
          continue;
        if (
          input.sprint &&
          p.sprintTicks === 0 &&
          p.power > CONFIG.sprintCost
        ) {
          p.power -= CONFIG.sprintCost;
          p.sprintTicks = CONFIG.sprintTicks;
        }
        input.sprint = false;
        const dx = input.target ? input.target.x - p.x : input.x;
        const dy = input.target ? input.target.y - p.y : input.y;
        const length = Math.hypot(dx, dy),
          factor = input.target
            ? length
              ? 1 / length
              : 0
            : length > 1
              ? 1 / length
              : 1;
        const speed =
          (normalSpeed(p.power) *
            (p.sprintTicks ? CONFIG.sprintMultiplier : 1) *
            CONFIG.tickMs) /
          1000;
        const travel = input.target ? Math.min(speed, length) : speed;
        const pos = constrainMove(
          p,
          {
            x: p.x + dx * factor * travel,
            y: p.y + dy * factor * travel,
          },
          m.boundary,
        );
        p.x = pos.x;
        p.y = pos.y;
      }
    this.tutorialMove();
    const actions = [...this.actions.values()].sort(
      (a, b) =>
        (this.player(a.playerId)?.order ?? 0) -
        (this.player(b.playerId)?.order ?? 0),
    );
    this.actions.clear();
    const destroyed = new Set<string>(),
      defeated = new Set<string>();
    for (const a of actions.filter((a) => a.kind !== "attack")) {
      const p = this.player(a.playerId),
        b = m.buildings.find((b) => b.id === a.targetId);
      if (
        !p?.connected ||
        !p.alive ||
        this.retirements.has(p.id) ||
        !b ||
        b.teamId !== p.teamId ||
        !eligible(m, p, b)
      )
        continue;
      const amount = transfer(p, b, a.kind);
      if (this.tutorial?.playerId === p.id)
        this.tutorialTransfer(b.id, a.kind, amount);
      m.notices[p.id] =
        `${a.kind === "deposit" ? "Deposited" : "Withdrew"} ${amount} Power.`;
    }
    if (this.tutorial?.stage === "complete") return;
    for (const a of actions.filter((a) => a.kind === "attack")) {
      const p = this.player(a.playerId),
        target =
          m.buildings.find((b) => b.id === a.targetId) ??
          this.player(a.targetId);
      if (
        !p?.connected ||
        !p.alive ||
        this.retirements.has(p.id) ||
        defeated.has(p.id) ||
        !target ||
        destroyed.has(target.id) ||
        defeated.has(target.id) ||
        !eligible(m, p, target)
      )
        continue;
      if ("kind" in target && target.teamId === p.teamId) continue;
      const cost = attackCost(target);
      if (p.power <= ("kind" in target ? cost : target.power)) {
        m.notices[p.id] = `Attack failed. Need more than ${cost} Power.`;
        continue;
      }
      p.power -= cost;
      if ("kind" in target) {
        if (target.kind === "core") {
          destroyed.add(target.id);
          m.notices[p.id] = "Enemy Core destroyed.";
        } else {
          target.teamId = p.teamId;
          target.power = 1;
          m.notices[p.id] =
            `${target.kind === "plant" ? "Power Plant" : "Fort"} captured.`;
        }
      } else {
        defeated.add(target.id);
        m.notices[p.id] = `Defeated ${target.name}. Paid ${cost} Power.`;
      }
    }
    this.settle(this.teamTotals(), destroyed, defeated);
    this.updateTutorial(
      !!this.tutorial && defeated.has(this.tutorial.opponentId),
    );
  }
  snapshot(id: string, now = Date.now()): Snapshot {
    const m = this.match,
      p = this.player(id);
    if (!p) throw new Error("Player not found");
    const placement = m.phase === "placement",
      playing = m.phase === "playing" || m.phase === "finished";
    const buildings = m.buildings.filter((b) =>
      placement
        ? b.kind === "core"
          ? b.teamId === p.teamId
          : inZone(b, p.zone, m.mode)
        : playing
          ? b.teamId === p.teamId || visible(m, p.teamId, b)
          : false,
    );
    const players = playing
      ? m.players.filter(
          (t) =>
            t.alive &&
            t.coreId &&
            (t.teamId === p.teamId || visible(m, p.teamId, t)),
        )
      : [];
    return {
      code: m.code,
      mode: m.mode,
      phase: m.phase,
      mapVersion: this.mapVersion,
      tick: m.tick,
      serverTime: now,
      selfId: id,
      hostId: this.hostId,
      boundary: m.boundary,
      buildings: buildings.map(({ productionTick: _private, ...b }) => {
        if (placement && b.teamId === null) {
          const { power: _hidden, ...view } = b;
          return view;
        }
        return { ...b };
      }),
      swapRequests:
        m.phase === "lobby"
          ? [...this.swapRequests].map(([fromId, toId]) => ({ fromId, toId }))
          : [],
      players: players.map(
        ({
          zone: _zone,
          order: _order,
          placementAt: _placement,
          disconnectedAt: _disconnect,
          ...view
        }) => view,
      ),
      roster: m.players.map((t) => ({
        id: t.id,
        name: t.name,
        teamId: t.teamId,
        alive: t.alive,
        connected: t.connected,
        placed: !!t.coreId,
        timeoutRemaining:
          !t.connected && t.disconnectedAt !== undefined
            ? Math.max(0, CONFIG.timeoutMs - (now - t.disconnectedAt))
            : placement && !t.coreId
              ? Math.max(0, CONFIG.timeoutMs - (now - (t.placementAt ?? now)))
              : undefined,
      })),
      zones: placement ? [{ id: p.id, teamId: p.teamId, zone: p.zone }] : [],
      vision: playing ? visionSources(m, p.teamId) : [],
      targetId:
        m.phase === "playing" && p.alive ? nearest(m, p)?.id : undefined,
      result: m.result,
      notice: m.notices[id],
      ...(this.tutorial ? { tutorial: this.tutorialView() } : {}),
    };
  }
  nextTutorial() {
    const t = this.tutorial;
    if (
      !t ||
      this.match.phase !== "finished" ||
      this.match.result?.winner !== this.player(t.playerId)?.teamId ||
      t.part === 4
    )
      throw new Error("The next part is not available.");
    if (this.match.players.some((p) => !p.connected))
      throw new Error("All players must reconnect before continuing.");
    t.part = (t.part + 1) as TutorialPart;
    this.rematch();
  }
  rematch() {
    if (this.match.phase !== "finished")
      throw new Error("Finish the current match first.");
    if (this.match.players.some((p) => !p.connected))
      throw new Error("All players must reconnect before a rematch.");
    const { code, mode, players } = this.match;
    if (this.tutorial) {
      const player = this.player(this.tutorial.playerId)!;
      const fresh = new Engine(code, "1v1", TUTORIAL.seed);
      fresh.addPlayer(player.id, player.name);
      fresh.setupTutorial(player.id, Date.now(), this.tutorial.part);
      this.match = fresh.match;
      this.mapVersion = fresh.mapVersion;
      this.tutorial = fresh.tutorial;
      this.inputs.clear();
      this.actions.clear();
      this.locks.clear();
      this.retirements.clear();
      return;
    }
    let seed = Math.floor(Math.random() * 0xffffffff);
    if (seed === this.match.seed) seed = (seed + 1) >>> 0;
    const fresh = new Engine(code, mode, seed);
    players.forEach((p) => {
      fresh.addPlayer(p.id, p.name);
      fresh.player(p.id)!.teamId = p.teamId;
    });
    this.swapRequests.clear();
    this.match = fresh.match;
    this.mapVersion = fresh.mapVersion;
    this.inputs.clear();
    this.actions.clear();
    this.locks.clear();
    this.retirements.clear();
  }
}
