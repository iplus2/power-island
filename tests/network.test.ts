import { test } from "node:test";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { createGameServer } from "../src/server/app";
import { inZone } from "../src/shared/map";
import {
  restoreSnapshot,
  type StatePacket,
  type Reply,
  type Snapshot,
} from "../src/shared/types";
function request(s: Socket, event: string, payload?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, r: Reply) =>
      err ? reject(err) : resolve(r);
    if (payload === undefined) s.timeout(3000).emit(event, cb);
    else s.timeout(3000).emit(event, payload, cb);
  });
}
const snapshots = new WeakMap<Socket, Snapshot>();
function track(s: Socket) {
  s.on("state", (p: StatePacket) => {
    const next = restoreSnapshot(p, snapshots.get(s));
    if (next) snapshots.set(s, next);
  });
  return s;
}
function waitState(
  s: Socket,
  predicate: (s: Snapshot) => boolean,
): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.off("state", onState);
      reject(new Error("State timeout"));
    }, 4000);
    const onState = (_packet: StatePacket) => {
      const state = snapshots.get(s);
      if (!state) return;
      if (predicate(state)) {
        clearTimeout(timer);
        s.off("state", onState);
        resolve(state);
      }
    };
    s.on("state", onState);
  });
}
test("Four real Socket.IO clients: rooms, mode validation, fog, transfers, resume, surrender and rematch", async () => {
  const server = createGameServer();
  await new Promise<void>((resolve) =>
    server.http.listen(0, "127.0.0.1", () => resolve()),
  );
  const port = (server.http.address() as { port: number }).port;
  const sockets: Socket[] = [];
  function client() {
    const s = io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
    track(s);
    sockets.push(s);
    return s;
  }
  try {
    const clients = Array.from({ length: 4 }, () => client());
    await Promise.all(
      clients.map(
        (s) => new Promise<void>((resolve) => s.on("connect", () => resolve())),
      ),
    );
    assert.equal(
      (await request(clients[1], "join", { name: "Bad", code: "INVALID" })).ok,
      false,
    );
    const host = await request(clients[0], "join", {
      name: "Mint 1",
      mode: "2v2",
      create: true,
    });
    assert.ok(host.ok);
    assert.equal((await request(clients[0], "start")).ok, false);
    const replies = [host];
    for (let i = 1; i < 4; i++)
      replies.push(
        await request(clients[i], "join", { name: `P${i}`, code: host.code }),
      );
    assert.ok(replies.every((r) => r.ok));
    assert.equal(
      (await request(clients[0], "chooseTeam", { teamId: 1 })).ok,
      false,
    );
    assert.equal(
      (
        await request(clients[0], "requestSwap", {
          playerId: replies[2].playerId,
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await request(clients[2], "replySwap", {
          fromId: host.playerId,
          accept: true,
        })
      ).ok,
      true,
    );
    assert.equal(
      server.rooms.get(host.code!)!.player(host.playerId!)!.teamId,
      1,
    );
    assert.equal(
      (
        await request(clients[0], "requestSwap", {
          playerId: replies[2].playerId,
        })
      ).ok,
      true,
    );
    assert.equal(
      (
        await request(clients[2], "replySwap", {
          fromId: host.playerId,
          accept: true,
        })
      ).ok,
      true,
    );
    assert.equal((await request(clients[1], "start")).ok, false);
    assert.equal((await request(clients[0], "start")).ok, true);
    const engine = server.rooms.get(host.code!)!;
    for (let i = 0; i < 4; i++) {
      const p = engine.match.players[i];
      let found = false;
      for (let x = 40; x <= 160 && !found; x += 10)
        for (let y = 40; y <= 160 && !found; y += 10)
          if (inZone({ x, y }, p.zone, "2v2"))
            found = (await request(clients[i], "place", { x, y })).ok;
      assert.ok(found);
    }
    const s = await waitState(clients[0], (s) => s.phase === "playing");
    assert.equal(s.roster.length, 4);
    assert.ok(
      s.buildings.every(
        (b) =>
          b.teamId === 0 ||
          b.kind !== "core" ||
          s.vision.some((v) => Math.hypot(v.x - b.x, v.y - b.y) <= v.radius),
      ),
    );
    // The first player spawns on their Core, so the nearest locked target is their Core.
    clients[0].emit("interactBegin");
    clients[0].emit("interactResolve", "half");
    const transferred = await waitState(
      clients[0],
      (s) => s.players.find((p) => p.id === host.playerId)?.power === 11,
    );
    assert.equal(
      transferred.buildings.find((b) => b.ownerId === host.playerId)?.power,
      40,
    );
    clients[0].disconnect();
    const resumed = client();
    await new Promise<void>((resolve) =>
      resumed.on("connect", () => resolve()),
    );
    assert.equal(
      (
        await request(resumed, "resume", {
          playerId: host.playerId,
          token: "x".repeat(64),
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await request(resumed, "resume", {
          playerId: host.playerId,
          token: host.token,
        })
      ).ok,
      true,
    );
    assert.ok(engine.player(host.playerId!)?.connected);
    const survivor = waitState(
      clients[1],
      (s) =>
        s.phase === "playing" &&
        !s.roster.find((p) => p.id === host.playerId)?.alive,
    );
    assert.equal((await request(resumed, "surrender")).ok, true);
    await survivor;
    const over = waitState(clients[2], (s) => s.phase === "finished");
    await request(clients[1], "surrender");
    const result = await over;
    assert.equal(result.result?.winner, 1);
    const oldSeed = engine.match.seed;
    assert.equal(
      (
        await request(
          clients.find(
            (s) => s.id === server.sessions.get(engine.hostId!)?.socketId,
          )!,
          "rematch",
        )
      ).ok,
      true,
    );
    assert.equal(engine.match.phase, "lobby");
    assert.notEqual(engine.match.seed, oldSeed);
  } finally {
    for (const s of sockets) s.disconnect();
    await server.close();
  }
});

test("Deployment room limit rejects new rooms while existing room joining still works", async () => {
  const saved = process.env.MAX_ROOMS;
  process.env.MAX_ROOMS = "1";
  let server: ReturnType<typeof createGameServer>;
  try {
    server = createGameServer();
  } finally {
    if (saved === undefined) delete process.env.MAX_ROOMS;
    else process.env.MAX_ROOMS = saved;
  }
  await new Promise<void>((resolve) =>
    server.http.listen(0, "127.0.0.1", () => resolve()),
  );
  const port = (server.http.address() as { port: number }).port;
  const clients = Array.from({ length: 2 }, () =>
    io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    }),
  );
  try {
    await Promise.all(
      clients.map(
        (s) => new Promise<void>((resolve) => s.on("connect", () => resolve())),
      ),
    );
    const first = await request(clients[0], "join", {
      create: true,
      mode: "1v1",
      name: "Host",
    });
    assert.ok(first.ok);
    const denied = await request(clients[1], "join", {
      create: true,
      mode: "1v1",
      name: "Guest",
    });
    assert.equal(denied.ok, false);
    assert.match(denied.error!, /full/);
    const joined = await request(clients[1], "join", {
      code: first.code,
      name: "Guest",
    });
    assert.ok(joined.ok);
    assert.equal(server.rooms.size, 1);
  } finally {
    for (const s of clients) s.disconnect();
    await server.close();
  }
});

test("1v1 wire recovery, metadata suppression, explicit Leave, host transfer and all-disconnected cleanup", async () => {
  const server = createGameServer();
  await new Promise<void>((r) => server.http.listen(0, "127.0.0.1", r));
  const port = (server.http.address() as { port: number }).port;
  const sockets: Socket[] = [];
  const packets = new WeakMap<Socket, StatePacket[]>();
  async function client() {
    const s = track(
      io(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      }),
    );
    sockets.push(s);
    packets.set(s, []);
    s.on("state", (p) => packets.get(s)!.push(p));
    await new Promise<void>((r) => s.on("connect", r));
    return s;
  }
  const pause = (ms = 250) => new Promise((r) => setTimeout(r, ms));
  try {
    const a = await client(),
      b = await client();
    const h = await request(a, "join", {
      create: true,
      mode: "1v1",
      name: "A",
    });
    const g = await request(b, "join", { code: h.code, name: "B" });
    await pause();
    const engine = server.rooms.get(h.code!)!;
    assert.ok(packets.get(a)![0].boundary);
    assert.ok(packets.get(a)![0].room);
    const lobbyCount = packets.get(a)!.length;
    await pause(650);
    assert.equal(packets.get(a)!.length, lobbyCount);
    await request(a, "start");
    await pause();
    const placement = snapshots.get(a)!;
    assert.deepEqual(
      placement.zones.map((z) => z.id),
      [h.playerId],
    );
    assert.ok(
      placement.buildings.every((b) => b.teamId !== null || !("power" in b)),
    );
    for (let i = 0; i < 2; i++) {
      const p = engine.match.players[i];
      let placed = false;
      for (let x = 40; x < 160 && !placed; x += 10)
        for (let y = 40; y < 160 && !placed; y += 10)
          if (inZone({ x, y }, p.zone, "1v1"))
            placed = (await request([a, b][i], "place", { x, y })).ok;
      assert.ok(placed);
    }
    await pause(450);
    const steady = packets.get(a)!.at(-1)!;
    assert.equal(steady.boundary, undefined);
    assert.equal(steady.room, undefined);
    // Complete dynamic collections allow newly visible entities to appear/disappear.
    const enemy = engine.player(g.playerId!)!,
      self = engine.player(h.playerId!)!;
    const old = { x: enemy.x, y: enemy.y };
    enemy.x = self.x;
    enemy.y = self.y;
    await pause();
    assert.ok(snapshots.get(a)!.players.some((p) => p.id === enemy.id));
    Object.assign(enemy, old);
    await pause();
    assert.ok(!snapshots.get(a)!.players.some((p) => p.id === enemy.id));
    a.disconnect();
    await pause();
    assert.equal(engine.hostId, g.playerId);
    const resume = await client();
    const missing = await request(resume, "resume", { playerId: h.playerId });
    assert.equal(missing.ok, false);
    assert.ok(
      (
        await request(resume, "resume", {
          playerId: h.playerId,
          token: h.token,
        })
      ).ok,
    );
    await pause();
    assert.equal(engine.hostId, g.playerId);
    assert.ok(packets.get(resume)![0].boundary);
    assert.ok(packets.get(resume)![0].room);
    assert.deepEqual(snapshots.get(resume)!.boundary, engine.match.boundary);
    await request(resume, "surrender");
    await pause();
    assert.equal(snapshots.get(b)!.phase, "finished");
    const finishedCount = packets.get(b)!.length;
    await pause(450);
    assert.equal(packets.get(b)!.length, finishedCount);
    const oldVersion = snapshots.get(b)!.mapVersion;
    assert.ok((await request(b, "rematch")).ok);
    await pause();
    assert.notEqual(snapshots.get(b)!.mapVersion, oldVersion);
    assert.ok(packets.get(b)!.at(-1)!.boundary);
    // A explicit host departure immediately removes credentials and transfers host.
    await request(b, "leave");
    await pause();
    assert.equal(engine.hostId, h.playerId);
    assert.equal(server.sessions.has(g.playerId!), false);
    assert.equal(
      (await request(b, "resume", { playerId: g.playerId, token: g.token })).ok,
      false,
    );
    await request(resume, "leave");
    assert.equal(server.rooms.has(h.code!), false);
    assert.equal(server.sessions.size, 0);
    // All sockets gone still retain room and credentials until the last 30s seat expires, even after results.
    const r = await request(b, "join", {
      create: true,
      mode: "1v1",
      name: "C",
    });
    await request(resume, "join", { code: r.code, name: "D" });
    const ended = server.rooms.get(r.code!)!;
    ended.match.phase = "finished";
    b.disconnect();
    resume.disconnect();
    await pause();
    assert.equal(ended.match.players.length, 2);
    assert.ok(server.rooms.has(r.code!));
    for (const p of ended.match.players) p.disconnectedAt = Date.now() - 30001;
    await pause();
    assert.equal(server.rooms.has(r.code!), false);
    assert.equal(server.sessions.size, 0);
    const cancel = await client();
    const abandoned = await request(cancel, "join", {
      create: true,
      mode: "1v1",
      name: "Offline Leave",
    });
    cancel.disconnect();
    await pause();
    const delivery = await client();
    await request(delivery, "leave", {
      playerId: abandoned.playerId,
      token: "invalid",
    });
    assert.ok(server.rooms.has(abandoned.code!));
    await request(delivery, "leave", {
      playerId: abandoned.playerId,
      token: abandoned.token,
    });
    assert.equal(server.rooms.has(abandoned.code!), false);
    assert.equal(server.sessions.has(abandoned.playerId!), false);
  } finally {
    sockets.forEach((s) => s.disconnect());
    await server.close();
  }
});

test("Solo tutorial over Socket.IO: private room, progress, ordinary early victory, fixed restart, resume and cleanup", async () => {
  const server = createGameServer();
  await new Promise<void>((resolve) =>
    server.http.listen(0, "127.0.0.1", resolve),
  );
  const port = (server.http.address() as { port: number }).port;
  const clients: Socket[] = [];
  async function client() {
    const s = track(
      io(`http://127.0.0.1:${port}`, {
        transports: ["websocket"],
        forceNew: true,
      }),
    );
    clients.push(s);
    await new Promise<void>((resolve) => s.on("connect", resolve));
    return s;
  }
  try {
    const s = await client();
    const placement = waitState(
      s,
      (v) => v.phase === "placement" && v.tutorial?.stage === "place",
    );
    const joined = await request(s, "join", {
      create: true,
      mode: "1v1",
      name: "Learner",
      tutorial: true,
    });
    assert.ok(joined.ok);
    const view = await placement;
    assert.equal(view.zones[0].zone, 0);
    assert.ok(view.buildings.every((b) => b.power === undefined));
    const engine = server.rooms.get(joined.code!)!;
    assert.equal(engine.match.seed, 175);
    const outsider = await client();
    assert.equal(
      (await request(outsider, "join", { name: "Intruder", code: joined.code }))
        .ok,
      false,
    );
    const playing = waitState(s, (v) => v.tutorial?.stage === "withdraw");
    assert.ok((await request(s, "place", { x: 40, y: 100 })).ok);
    await playing;
    const p = engine.player(joined.playerId!)!;
    const core = engine.match.buildings.find(
      (b) => b.id === engine.player(engine.tutorial!.opponentId)!.coreId,
    )!;
    p.x = core.x;
    p.y = core.y;
    p.power = core.power + 2;
    const won = waitState(s, (v) => v.phase === "finished");
    s.emit("interactBegin");
    s.emit("interactResolve", "half");
    const result = await won;
    assert.equal(result.result?.winner, 0);
    assert.equal(engine.tutorial!.plants.size, 0);
    const restarted = waitState(
      s,
      (v) => v.phase === "placement" && v.mapVersion !== view.mapVersion,
    );
    assert.ok((await request(s, "rematch")).ok);
    const restartView = await restarted;
    assert.equal(restartView.tutorial?.stage, "place");
    assert.deepEqual(restartView.boundary, view.boundary);
    s.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const resumed = await client();
    const restored = waitState(resumed, (v) => v.phase === "placement");
    assert.ok(
      (
        await request(resumed, "resume", {
          playerId: joined.playerId,
          token: joined.token,
        })
      ).ok,
    );
    assert.equal((await restored).hostId, joined.playerId);
    assert.ok((await request(resumed, "leave")).ok);
    assert.equal(server.rooms.size, 0);
    assert.equal(server.sessions.size, 0);
  } finally {
    clients.forEach((s) => s.disconnect());
    await server.close();
  }
});
