import { CONFIG, normalSpeed } from "../shared/config";
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
} from "../shared/types";

export class Engine {
  match: Match;
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
    const previous = this.inputs.get(id);
    this.inputs.set(id, {
      x: Math.max(-1, Math.min(1, input.x)),
      y: Math.max(-1, Math.min(1, input.y)),
      sprint: !!(input.sprint || previous?.sprint),
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
  }
  reconnect(id: string, now = Date.now()) {
    const p = this.player(id);
    if (!p) return;
    if (
      p.disconnectedAt !== undefined &&
      now - p.disconnectedAt >= CONFIG.timeoutMs &&
      p.alive
    )
      this.retirements.set(id, "Reconnection window expired.");
    p.connected = true;
    p.disconnectedAt = undefined;
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
    const m = this.match;
    if (m.phase === "finished") return;
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
        const length = Math.hypot(input.x, input.y),
          factor = length > 1 ? 1 / length : 1;
        const speed =
          (normalSpeed(p.power) *
            (p.sprintTicks ? CONFIG.sprintMultiplier : 1) *
            CONFIG.tickMs) /
          1000;
        const pos = constrainMove(
          p,
          {
            x: p.x + input.x * factor * speed,
            y: p.y + input.y * factor * speed,
          },
          m.boundary,
        );
        p.x = pos.x;
        p.y = pos.y;
      }
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
      m.notices[p.id] =
        `${a.kind === "deposit" ? "Deposited" : "Withdrew"} ${amount} Power.`;
    }
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
          target.power = 0;
          m.notices[p.id] =
            `${target.kind === "plant" ? "Power Plant" : "Fort"} captured.`;
        }
      } else {
        defeated.add(target.id);
        m.notices[p.id] = `Defeated ${target.name}. Paid ${cost} Power.`;
      }
    }
    this.settle(this.teamTotals(), destroyed, defeated);
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
      seed: m.seed,
      tick: m.tick,
      serverTime: now,
      selfId: id,
      hostId: m.players.find((t) => t.connected)?.id,
      boundary: m.boundary,
      buildings: buildings.map((b) => {
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
      players: players.map((t) => ({ ...t })),
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
      zones: m.players.map((t) => ({
        id: t.id,
        teamId: t.teamId,
        zone: t.zone,
      })),
      vision: playing ? visionSources(m, p.teamId) : [],
      targetId:
        m.phase === "playing" && p.alive ? nearest(m, p)?.id : undefined,
      result: m.result,
      notice: m.notices[id],
    };
  }
  rematch() {
    if (this.match.phase !== "finished")
      throw new Error("Finish the current match first.");
    if (this.match.players.some((p) => !p.connected))
      throw new Error("All players must reconnect before a rematch.");
    const { code, mode, players } = this.match;
    let seed = Math.floor(Math.random() * 0xffffffff);
    if (seed === this.match.seed) seed = (seed + 1) >>> 0;
    const fresh = new Engine(code, mode, seed);
    players.forEach((p) => {
      fresh.addPlayer(p.id, p.name);
      fresh.player(p.id)!.teamId = p.teamId;
    });
    this.swapRequests.clear();
    this.match = fresh.match;
    this.inputs.clear();
    this.actions.clear();
    this.locks.clear();
    this.retirements.clear();
  }
}
