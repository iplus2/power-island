import { islandViewport } from "../src/client/mapViewport";
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { io } from "socket.io-client";
import { createGameServer } from "../src/server/app";
import { inZone, validPoint, distance } from "../src/shared/map";
import type { Reply } from "../src/shared/types";

test("React UI over real network: create, lobby, click placement, E/hold/double/Q, surrender, rematch", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLCanvasElement: dom.window.HTMLCanvasElement,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: dom.window.sessionStorage,
    configurable: true,
  });
  dom.window.PointerEvent = dom.window
    .MouseEvent as typeof dom.window.PointerEvent;
  dom.window.HTMLCanvasElement.prototype.getContext =
    (() => ({})) as unknown as typeof dom.window.HTMLCanvasElement.prototype.getContext;
  dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 600,
    height: 600,
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 600,
    bottom: 600,
    toJSON: () => ({}),
  });
  const React = await import("react");
  const { render, fireEvent, waitFor, cleanup, act } =
    await import("@testing-library/react");
  const { App } = await import("../src/client/App");
  const server = createGameServer();
  await new Promise<void>((resolve) =>
    server.http.listen(0, "127.0.0.1", () => resolve()),
  );
  const port = (server.http.address() as { port: number }).port;
  const connection = io(`http://127.0.0.1:${port}`, {
      autoConnect: false,
      transports: ["websocket"],
    }),
    bot = io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      forceNew: true,
    });
  const request = async (event: string, payload?: unknown): Promise<Reply> => {
    let reply: Reply | undefined;
    await act(async () => {
      reply = await new Promise<Reply>((resolve) =>
        payload === undefined
          ? bot.emit(event, resolve)
          : bot.emit(event, payload, resolve),
      );
    });
    return reply!;
  };
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const view = render(React.createElement(App, { connection }));
    await waitFor(() => assert.ok(view.getByText("Connected")));
    fireEvent.change(view.getByLabelText("Your callsign"), {
      target: { value: "Northstar" },
    });
    fireEvent.click(view.getByText("Create a room"));
    await waitFor(() => assert.ok(view.getByText("Gather your team.")));
    const engine = [...server.rooms.values()][0];
    const other = await request("join", {
      name: "Southwind",
      code: engine.match.code,
    });
    assert.ok(other.ok);
    await waitFor(() =>
      assert.equal(
        (view.getByText("Start match ↗") as HTMLButtonElement).disabled,
        false,
      ),
    );
    fireEvent.click(view.getByText("Start match ↗"));
    await waitFor(() => assert.ok(view.getByText("Choose your ground.")));
    function position(playerId: string) {
      const p = engine.player(playerId)!;
      for (let x = 40; x < 160; x += 5)
        for (let y = 40; y < 160; y += 5) {
          const q = { x, y };
          if (
            inZone(q, p.zone, "1v1") &&
            validPoint(q, engine.match.boundary, 3) &&
            engine.match.buildings.every((b) => distance(b, q) >= 8)
          )
            return q;
        }
      throw new Error("No placement");
    }
    const p = engine.match.players[0],
      point = position(p.id);
    const mapView = islandViewport(engine.match.boundary);
    const tapX = ((point.x - mapView.left) / mapView.size) * 600;
    const tapY = ((point.y - mapView.top) / mapView.size) * 600;
    fireEvent.pointerDown(view.container.querySelector("canvas")!, {
      clientX: tapX,
      clientY: tapY,
      pointerId: 1,
    });
    fireEvent.pointerUp(view.container.querySelector("canvas")!, {
      clientX: tapX,
      clientY: tapY,
      pointerId: 1,
    });
    assert.equal(p.coreId, undefined, "First click must only preview");
    assert.ok(
      view.container.querySelector("canvas")!.getAttribute("data-selected"),
    );
    fireEvent.pointerDown(view.container.querySelector("canvas")!, {
      clientX: tapX,
      clientY: tapY,
      pointerId: 1,
    });
    fireEvent.pointerUp(view.container.querySelector("canvas")!, {
      clientX: tapX,
      clientY: tapY,
      pointerId: 1,
    });
    await waitFor(() => assert.ok(view.getByText("Core established.")));
    assert.ok((await request("place", position(other.playerId!))).ok);
    await waitFor(() => assert.ok(view.getByText("Hold your ground.")));
    (document.activeElement as HTMLElement).blur?.();
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyUp(window, { key: "e" });
    await waitFor(() => assert.equal(p.power, 11), { timeout: 3000 });
    await waitFor(() => assert.ok(view.getByText("Withdrew 10 Power.")));
    fireEvent.keyDown(window, { key: "e" });
    await act(async () => {
      await sleep(550);
    });
    fireEvent.keyUp(window, { key: "e" });
    await waitFor(() => assert.equal(p.power, 1), { timeout: 3000 });
    await waitFor(() => assert.ok(view.getByText("Deposited 10 Power.")));
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyUp(window, { key: "e" });
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyUp(window, { key: "e" });
    await waitFor(() => assert.equal(p.power, 11), { timeout: 3000 });
    fireEvent.keyDown(window, { key: "q" });
    fireEvent.keyUp(window, { key: "q" });
    await waitFor(() => assert.equal(p.power, 1), { timeout: 3000 });
    assert.ok(p.sprintTicks > 0);
    fireEvent.click(view.getByText("How to play ↗"));
    assert.ok(view.getByRole("dialog"));
    assert.ok(view.getByText(/Only owned buildings produce/));
    fireEvent.click(view.getByLabelText("Close guide"));
    fireEvent.click(view.getByText("Surrender your Core"));
    await waitFor(() => assert.ok(view.getByText("Coral team wins.")));
    fireEvent.click(view.getByText("Rematch · new island ↗"));
    await waitFor(() => assert.ok(view.getByText("Gather your team.")));
    await act(async () => {
      connection.disconnect();
    });
    fireEvent.click(view.getByText("Leave room"));
    await waitFor(() => assert.ok(view.getByLabelText("Your callsign")));
    assert.equal(sessionStorage.getItem("power-island-session"), null);
    await act(async () => {
      connection.connect();
    });
    await waitFor(() => assert.equal(engine.player(p.id), undefined));
    assert.ok(view.getByLabelText("Your callsign"));
  } finally {
    cleanup();
    connection.disconnect();
    bot.disconnect();
    await server.close();
    dom.window.close();
  }
});
