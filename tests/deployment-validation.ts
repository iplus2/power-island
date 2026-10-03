import { io, Socket } from "socket.io-client";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { restoreSnapshot, Snapshot } from "../src/shared/types";
import { inZone, validPoint, distance } from "../src/shared/map";
const staged = process.argv.includes("--staged");
const duration = Number(process.env.VALIDATION_SECONDS || 60);
const url = staged ? "http://127.0.0.1:3002" : process.env.TEST_SERVER_URL;
if (!url) throw new Error("Set TEST_SERVER_URL for external validation.");
const origin = process.env.TEST_ALLOWED_ORIGIN;
const processServer = staged
  ? spawn(
      process.execPath,
      ["--max-old-space-size=96", "dist-server/index.js"],
      {
        env: {
          ...process.env,
          HOST: "127.0.0.1",
          PORT: "3002",
          MAX_ROOMS: "4",
        },
        stdio: "ignore",
      },
    )
  : null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sockets: Socket[] = [];
const states = new Map<Socket, Snapshot>();
let bytes = 0,
  packets = 0;
const rtts: number[] = [];
function request(s: Socket, event: string, p?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const cb = (err: any, r: any) => (err ? reject(err) : resolve(r));
    if (p === undefined) s.timeout(5000).emit(event, cb);
    else s.timeout(5000).emit(event, p, cb);
  });
}
async function client() {
  const s = io(url, {
    transports: ["websocket"],
    forceNew: true,
    extraHeaders: origin ? { Origin: origin } : undefined,
    reconnection: false,
  });
  sockets.push(s);
  s.on("state", (p) => {
    bytes += Buffer.byteLength(JSON.stringify(p));
    packets++;
    const next = restoreSnapshot(p, states.get(s));
    if (next) states.set(s, next);
  });
  await new Promise<void>((resolve, reject) => {
    s.once("connect", resolve);
    s.once("connect_error", reject);
  });
  return s;
}
const resources: any[] = [];
try {
  if (staged) {
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(url + "/health")).ok) break;
      } catch {}
      await sleep(100);
    }
  }
  for (let room = 0; room < (staged ? 4 : 2); room++) {
    const mode = room % 2 ? "2v2" : "1v1";
    const peers: Socket[] = [];
    let code = "";
    for (let n = 0; n < (mode === "2v2" ? 4 : 2); n++) {
      const s = await client();
      peers.push(s);
      const reply = await request(
        s,
        "join",
        n
          ? { code, name: `Verify ${n}` }
          : { create: true, mode, name: "Verify host" },
      );
      if (!reply.ok) throw Error(reply.error);
      code = reply.code;
    }
    if (!(await request(peers[0], "start")).ok) throw Error("Start rejected");
    await sleep(250);
    for (const s of peers) {
      const state = states.get(s)!;
      if (
        state.zones.length !== 1 ||
        state.buildings.some((b) => b.teamId === null && "power" in b)
      )
        throw Error("Placement privacy failed");
      let placed = false;
      for (let x = 25; x < 180 && !placed; x += 5)
        for (let y = 25; y < 180 && !placed; y += 5) {
          const q = { x, y };
          if (
            inZone(q, state.zones[0].zone, mode) &&
            validPoint(q, state.boundary, 3) &&
            state.buildings.every((b) => distance(q, b) >= 8)
          )
            placed = (await request(s, "place", q)).ok;
        }
      if (!placed) throw Error("Placement failed");
    }
  }
  await sleep(600);
  if ([...states.values()].some((s) => s.phase !== "playing"))
    throw Error("Not playing");
  const initialX = states
    .get(sockets[0])!
    .players.find((p) => p.id === states.get(sockets[0])!.selfId)!.x;
  const startBytes = bytes,
    startPackets = packets;
  const started = Date.now();
  const sender = setInterval(() => {
    for (const s of sockets) {
      const state = states.get(s)!;
      const self = state.players.find((p) => p.id === state.selfId);
      if (self)
        s.emit("input", { x: 0, y: 0, target: { x: self.x + 1, y: self.y } });
    }
  }, 300);
  try {
    while (Date.now() - started < duration * 1000) {
      const t = performance.now();
      const r = await request(sockets[0], "chooseTeam", { teamId: 0 });
      rtts.push(performance.now() - t);
      if (r.ok) throw Error("Playing team change accepted");
      if (processServer?.pid) {
        const stat = readFileSync(
          `/proc/${processServer.pid}/stat`,
          "utf8",
        ).split(" ");
        resources.push({
          elapsedMs: Date.now() - started,
          cpuTicks: Number(stat[13]) + Number(stat[14]),
          rssBytes: Number(stat[23]) * 4096,
        });
      }
      await sleep(1000);
    }
  } finally {
    clearInterval(sender);
  }
  const first = sockets[0];
  const sessionState = states.get(first)!;
  if (
    sessionState.players.find((p) => p.id === sessionState.selfId)!.x <=
    initialX
  )
    throw Error("Target movement failed");
  const meta = await request(first, "surrender");
  if (!meta.ok) throw Error("Surrender failed");
  for (const s of sockets) await request(s, "leave");
  await sleep(250);
  const health = await (await fetch(url + "/health")).json();
  if (staged && health.rooms !== 0) throw Error("Rooms leaked");
  rtts.sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        url,
        durationSeconds: duration,
        rooms: staged ? 4 : 2,
        clients: sockets.length,
        transport: "websocket",
        checks: [
          "1v1",
          "2v2",
          "placement privacy",
          "playing",
          "input",
          "surrender",
          "explicit leave",
        ],
        statePackets: packets - startPackets,
        stateJsonBytes: bytes - startBytes,
        rttP95Ms: rtts[Math.floor(rtts.length * 0.95)],
        resources,
        finalHealth: health,
      },
      null,
      2,
    ),
  );
} finally {
  sockets.forEach((s) => s.disconnect());
  if (processServer) {
    processServer.kill("SIGTERM");
    await new Promise<void>((r) => {
      if (processServer.exitCode !== null) r();
      else processServer.once("exit", () => r());
    });
  }
}
