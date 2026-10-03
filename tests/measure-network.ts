import { createGameServer } from "../src/server/app";
import { io } from "socket.io-client";
import { generateMap, inZone, validPoint, distance } from "../src/shared/map";
const server = createGameServer();
await new Promise<void>((r) => server.http.listen(0, "127.0.0.1", r));
const port = (server.http.address() as any).port;
const clients = [0, 1].map(() =>
  io(`http://127.0.0.1:${port}`, { transports: ["websocket"], forceNew: true }),
);
const request = (s: any, event: string, p?: any) =>
  new Promise<any>((r) =>
    p === undefined ? s.emit(event, r) : s.emit(event, p, r),
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  await Promise.all(
    clients.map((s) => new Promise<void>((r) => s.on("connect", r))),
  );
  const h = await request(clients[0], "join", {
    create: true,
    mode: "1v1",
    name: "A",
  });
  const e = server.rooms.get(h.code)!;
  e.match.seed = 20261002;
  Object.assign(e.match, generateMap(20261002));
  await request(clients[1], "join", { code: h.code, name: "B" });
  let counts = [0, 0],
    bytes = [0, 0];
  clients.forEach((s, i) =>
    s.on("state", (p) => {
      counts[i]++;
      bytes[i] += Buffer.byteLength(JSON.stringify(p));
    }),
  );
  const samples: any[] = [];
  async function sample(phase: string) {
    await sleep(300);
    counts = [0, 0];
    bytes = [0, 0];
    await sleep(2000);
    samples.push({
      phase,
      durationMs: 2000,
      messages: [...counts],
      applicationJsonBytes: [...bytes],
      aggregateKbps: (bytes.reduce((a, b) => a + b, 0) * 8) / 2000,
    });
  }
  await sample("lobby");
  await request(clients[0], "start");
  await sample("placement");
  for (let i = 0; i < 2; i++) {
    const p = e.match.players[i];
    let found = false;
    for (let x = 40; x < 160 && !found; x += 5)
      for (let y = 40; y < 160 && !found; y += 5) {
        const q = { x, y };
        if (
          inZone(q, p.zone, "1v1") &&
          validPoint(q, e.match.boundary) &&
          e.match.buildings.every((b) => distance(b, q) >= 6)
        )
          found = (await request(clients[i], "place", q)).ok;
      }
  }
  await sample("playing-stationary");
  await request(clients[0], "surrender");
  await sleep(250);
  await sample("finished");
  console.log(
    JSON.stringify(
      {
        seed: 20261002,
        players: 2,
        transport: clients.map((s) => s.io.engine.transport.name),
        measurement:
          "state event JSON UTF-8 bytes only; excludes framing, acknowledgments, input, TLS and network overhead",
        samples,
      },
      null,
      2,
    ),
  );
} finally {
  clients.forEach((s) => s.disconnect());
  await server.close();
}
