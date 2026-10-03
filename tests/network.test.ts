import { test } from "node:test";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { createGameServer } from "../src/server/app";
import { inZone } from "../src/shared/map";
import type { Reply, Snapshot } from "../src/shared/types";
function request(s: Socket, event: string, payload?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const cb = (err: Error | null, r: Reply) =>
      err ? reject(err) : resolve(r);
    if (payload === undefined) s.timeout(3000).emit(event, cb);
    else s.timeout(3000).emit(event, payload, cb);
  });
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
    const onState = (state: Snapshot) => {
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
    assert.equal((await request(resumed, "rematch")).ok, true);
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
