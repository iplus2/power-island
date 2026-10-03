import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Server, Socket } from "socket.io";
import { Engine } from "./engine";
import { CONFIG } from "../shared/config";
import type { Command, Mode, Reply, StatePacket } from "../shared/types";

export function createGameServer() {
  const maxRooms = Number(process.env.MAX_ROOMS ?? 500);
  if (!Number.isSafeInteger(maxRooms) || maxRooms < 1)
    throw new Error("MAX_ROOMS must be a positive integer.");
  const rooms = new Map<string, Engine>();
  const sessions = new Map<
    string,
    { code: string; token: string; socketId?: string }
  >();
  const sent = new Map<
    string,
    { mapVersion: string; room: string; quiet: string }
  >();
  const origins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .filter(Boolean);
  const staticRoot = resolve(process.cwd(), "dist");
  const http = createServer(async (req, res) => {
    if (req.url?.split("?")[0] === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname,
      );
      let file = resolve(staticRoot, "." + pathname);
      if (file !== staticRoot && !file.startsWith(staticRoot + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        if ((await stat(file)).isDirectory())
          file = resolve(file, "index.html");
      } catch {
        file = resolve(staticRoot, "index.html");
      }
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
      res.setHeader(
        "Content-Type",
        mime[extname(file)] ?? "application/octet-stream",
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end("Build the client first, or use the Vite development server.");
    }
  });
  const io = new Server(http, {
    maxHttpBufferSize: 8192,
    cors: origins.length ? { origin: origins } : { origin: false },
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      cb(null, !origin || !origins.length || origins.includes(origin));
    },
  });
  function context(socket: Socket) {
    const id = socket.data.playerId as string | undefined;
    const session = id ? sessions.get(id) : undefined;
    if (!id || !session || session.socketId !== socket.id) return;
    const engine = rooms.get(session.code);
    if (!engine) return;
    return { id, engine, session };
  }
  function publish(engine: Engine) {
    for (const p of engine.match.players) {
      const session = sessions.get(p.id);
      if (!session?.socketId) continue;
      const socketId = session.socketId;
      const snapshot = engine.snapshot(p.id);
      const {
        boundary,
        code,
        mode,
        selfId,
        hostId,
        roster,
        zones,
        swapRequests,
        result,
        notice,
        ...dynamic
      } = snapshot;
      const room = {
        code,
        mode,
        selfId,
        hostId,
        roster,
        zones,
        swapRequests,
        result,
        notice,
      };
      const roomJson = JSON.stringify(room);
      const prior = sent.get(socketId);
      const packet: StatePacket = { ...dynamic };
      if (!prior || prior.mapVersion !== snapshot.mapVersion)
        packet.boundary = boundary;
      if (!prior || prior.room !== roomJson) packet.room = room;
      const quiet = JSON.stringify({
        ...dynamic,
        serverTime: 0,
        tick: 0,
        room,
      });
      if (
        snapshot.phase !== "playing" &&
        prior?.mapVersion === snapshot.mapVersion &&
        prior.quiet === quiet
      )
        continue;
      io.to(socketId).emit("state", packet);
      sent.set(socketId, {
        mapVersion: snapshot.mapVersion,
        room: roomJson,
        quiet,
      });
    }
  }
  function clean(engine: Engine) {
    for (const [id, session] of sessions) {
      if (session.code === engine.match.code && !engine.player(id)) {
        if (session.socketId) {
          sent.delete(session.socketId);
          const socket = io.sockets.sockets.get(session.socketId);
          if (socket) socket.data.playerId = undefined;
        }
        sessions.delete(id);
      }
    }
    if (!engine.match.players.length) rooms.delete(engine.match.code);
  }
  function bind(socket: Socket, code: string, id: string, token: string) {
    sessions.set(id, { code, token, socketId: socket.id });
    socket.data.playerId = id;
    sent.delete(socket.id);
  }
  io.on("connection", (socket) => {
    let bucket = 100,
      refill = Date.now();
    socket.use((_packet, next) => {
      const now = Date.now();
      bucket = Math.min(100, bucket + (now - refill) * 0.05);
      refill = now;
      if (bucket < 1) return;
      bucket--;
      next();
    });
    socket.on("join", (payload: unknown, ack: (r: Reply) => void) => {
      if (typeof ack !== "function") return;
      try {
        if (context(socket)) throw new Error("Leave your current room first.");
        const data = payload as {
          name?: unknown;
          code?: unknown;
          mode?: unknown;
          create?: unknown;
        };
        const name =
          typeof data?.name === "string" ? data.name.trim().slice(0, 18) : "";
        if (!name) throw new Error("Enter a callsign.");
        let code =
          typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
        if (data.create === true) {
          if (data.mode !== "1v1" && data.mode !== "2v2")
            throw new Error("Choose 1v1 or 2v2.");
          if (rooms.size >= maxRooms)
            throw new Error("Server is full. Try later.");
          do {
            code = randomBytes(3).toString("hex").toUpperCase();
          } while (rooms.has(code));
          const mode: Mode = data.mode === "2v2" ? "2v2" : "1v1";
          rooms.set(code, new Engine(code, mode));
        }
        const engine = rooms.get(code);
        if (!engine) throw new Error("Room not found. Check the code.");
        const id = randomUUID(),
          token = randomBytes(32).toString("hex");
        engine.addPlayer(id, name);
        bind(socket, code, id, token);
        ack({ ok: true, code, playerId: id, token });
        publish(engine);
      } catch (error) {
        ack({ ok: false, error: (error as Error).message });
      }
    });
    socket.on("resume", (payload: unknown, ack: (r: Reply) => void) => {
      if (typeof ack !== "function") return;
      try {
        const d = payload as { playerId?: unknown; token?: unknown };
        if (typeof d?.playerId !== "string" || typeof d.token !== "string")
          throw new Error("Session unavailable.");
        if (context(socket) && socket.data.playerId !== d.playerId)
          throw new Error("Leave your current room first.");
        const session = sessions.get(d.playerId),
          engine = session ? rooms.get(session.code) : undefined;
        if (
          !session ||
          !engine ||
          !engine.player(d.playerId) ||
          d.token.length !== session.token.length ||
          !timingSafeEqual(Buffer.from(d.token), Buffer.from(session.token))
        )
          throw new Error("Session expired. Join a new room.");
        if (session.socketId && session.socketId !== socket.id) {
          const old = io.sockets.sockets.get(session.socketId);
          if (old) {
            old.data.playerId = undefined;
            old.emit("replaced");
            old.disconnect(true);
          }
        }
        engine.reconnect(d.playerId);
        bind(socket, session.code, d.playerId, session.token);
        ack({
          ok: true,
          code: session.code,
          playerId: d.playerId,
          token: session.token,
        });
        publish(engine);
      } catch (error) {
        ack({ ok: false, error: (error as Error).message });
      }
    });
    for (const event of ["start", "rematch"] as const)
      socket.on(event, (ack: (r: Reply) => void) => {
        const c = context(socket);
        if (!c) return;
        try {
          if (c.engine.hostId !== c.id)
            throw new Error("Only the room host can do this.");
          if (event === "start") c.engine.start();
          else c.engine.rematch();
          publish(c.engine);
          if (typeof ack === "function") ack({ ok: true });
        } catch (error) {
          if (typeof ack === "function")
            ack({ ok: false, error: (error as Error).message });
        }
      });
    for (const event of ["chooseTeam", "requestSwap", "replySwap"] as const)
      socket.on(event, (payload: unknown, ack: (r: Reply) => void) => {
        const c = context(socket);
        if (!c) return;
        try {
          const d = payload as {
            teamId?: unknown;
            playerId?: unknown;
            fromId?: unknown;
            accept?: unknown;
          };
          if (event === "chooseTeam") c.engine.chooseTeam(c.id, d?.teamId);
          else if (event === "requestSwap") {
            if (typeof d?.playerId !== "string")
              throw new Error("Choose a player.");
            c.engine.requestSwap(c.id, d.playerId);
          } else {
            if (typeof d?.fromId !== "string" || typeof d.accept !== "boolean")
              throw new Error("Invalid swap reply.");
            c.engine.replySwap(c.id, d.fromId, d.accept);
          }
          publish(c.engine);
          if (typeof ack === "function") ack({ ok: true });
        } catch (error) {
          if (typeof ack === "function")
            ack({ ok: false, error: (error as Error).message });
        }
      });
    socket.on("place", (p: unknown, ack: (r: Reply) => void) => {
      const c = context(socket);
      if (!c) return;
      try {
        const point = p as { x: number; y: number };
        c.engine.place(c.id, point?.x, point?.y);
        publish(c.engine);
        if (typeof ack === "function") ack({ ok: true });
      } catch (error) {
        if (typeof ack === "function")
          ack({ ok: false, error: (error as Error).message });
      }
    });
    socket.on("input", (p: unknown) => {
      const c = context(socket);
      if (!c) return;
      const d = p as {
        x: number;
        y: number;
        sprint?: boolean;
        target?: { x: number; y: number };
      };
      if (d && typeof d.x === "number" && typeof d.y === "number")
        c.engine.input(c.id, {
          x: d.x,
          y: d.y,
          sprint: d.sprint === true,
          target: d.target,
        });
    });
    socket.on("interactBegin", () => {
      const c = context(socket);
      c?.engine.begin(c.id);
    });
    socket.on("interactResolve", (kind: unknown) => {
      if (!["half", "max", "deposit"].includes(kind as string)) return;
      const c = context(socket);
      c?.engine.resolve(c.id, kind as Command);
    });
    socket.on("surrender", (ack: (r: Reply) => void) => {
      const c = context(socket);
      if (!c) return;
      c.engine.surrender(c.id);
      if (typeof ack === "function") ack({ ok: true });
    });
    socket.on("leave", (payload: unknown, callback?: (r: Reply) => void) => {
      const ack =
        typeof payload === "function"
          ? (payload as (r: Reply) => void)
          : callback;
      let c = context(socket);
      // A disconnected tab may queue explicit Leave with its existing credentials,
      // clear local identity immediately, then deliver it without resuming first.
      if (!c && payload && typeof payload === "object") {
        const d = payload as { playerId?: unknown; token?: unknown };
        if (typeof d.playerId === "string" && typeof d.token === "string") {
          const session = sessions.get(d.playerId);
          const engine = session && rooms.get(session.code);
          if (
            session &&
            engine &&
            Buffer.byteLength(d.token) === Buffer.byteLength(session.token) &&
            timingSafeEqual(Buffer.from(d.token), Buffer.from(session.token))
          )
            c = { id: d.playerId, engine, session };
        }
      }
      if (!c) {
        if (typeof ack === "function") ack({ ok: true });
        return;
      }
      c.engine.removePlayers(new Set([c.id]), "Left room.");
      if (c.session.socketId) {
        sent.delete(c.session.socketId);
        const owner = io.sockets.sockets.get(c.session.socketId);
        if (owner?.data.playerId === c.id) owner.data.playerId = undefined;
      }
      sessions.delete(c.id);
      clean(c.engine);
      publish(c.engine);
      if (typeof ack === "function") ack({ ok: true });
    });
    socket.on("disconnect", () => {
      sent.delete(socket.id);
      const c = context(socket);
      if (c) {
        c.session.socketId = undefined;
        c.engine.disconnect(c.id);
        publish(c.engine);
      }
    });
  });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const engine of rooms.values()) {
      engine.step(now);
      publish(engine);
      clean(engine);
    }
  }, CONFIG.tickMs);
  return {
    http,
    io,
    rooms,
    sessions,
    close: async () => {
      clearInterval(timer);
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
