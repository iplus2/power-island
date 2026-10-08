import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { CONFIG, normalSpeed } from "../shared/config";
import { attackCost } from "../shared/rules";
import {
  restoreSnapshot,
  type StatePacket,
  type Point,
  type Mode,
  type Reply,
  type Snapshot,
} from "../shared/types";
import { InteractionGesture } from "./gesture";
import { World } from "./World";
import { tutorialGuide } from "./tutorialGuide";
const defaultSocket = io(import.meta.env?.VITE_SERVER_URL || undefined, {
  autoConnect: false,
});
const SESSION = "power-island-session";
const teamNames = ["Mint", "Coral"];
function Rules({ close }: { close: () => void }) {
  return (
    <div className="modal-shade">
      <section
        className="rules"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
      >
        <div className="section-head">
          <span className="eyebrow">FIELD GUIDE</span>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close guide"
          >
            ×
          </button>
        </div>
        <h2 id="rules-title">
          Power is your advantage.
          <br />
          And your burden.
        </h2>
        <p>
          Carry Power to fight. Store it to defend. Carrying more slows you
          down. Destroy every enemy Core to win; each teammate has their own
          Core.
        </p>
        <div className="rule-grid">
          <article>
            <b>01 / Establish</b>
            <p>
              Click or tap in your zone to choose a Core position, then select
              the same spot again to confirm. Protect your Core to stay in the
              game.
            </p>
          </article>
          <article>
            <b>02 / Transport</b>
            <p>
              Near a friendly building, press <kbd>E</kbd> or tap Interact to
              withdraw half; double press or tap for the maximum; hold to
              deposit. Core withdrawals leave 40 Power for defense.
            </p>
          </article>
          <article>
            <b>03 / Explore</b>
            <p>
              Explore the fog and capture buildings to grow your Power. Only
              owned buildings produce; Plants produce fastest. Your team shares
              buildings and current vision.
            </p>
          </article>
          <article>
            <b>04 / Fight</b>
            <p>
              Press <kbd>E</kbd> or tap Interact to attack the highlighted
              enemy. Carry more Power than an enemy player to defeat them; the
              attack costs half their Power. Defeated players respawn at their
              Core.
            </p>
          </article>
          <article>
            <b>05 / Capture</b>
            <p>
              Attacking a Plant costs half its Power; a Fort or Core costs its
              full Power. Carry more than the cost. Plants and Forts become
              yours; enemy Cores are destroyed.
            </p>
          </article>
          <article>
            <b>06 / Sprint</b>
            <p>
              Press <kbd>Q</kbd> or tap Sprint for a short speed boost. You need
              more than 10 Power, and sprinting spends 10.
            </p>
          </article>
        </div>
        <p className="rule-note">
          Move with WASD or click / tap the map. Get close to a target to
          interact. Keep exploring, bring Power home, and destroy every enemy
          Core to win. Disconnected players have 30 seconds to reconnect; the
          countdown shows time remaining.
        </p>
        <button className="primary" onClick={close}>
          Got it. Let's play ↗
        </button>
      </section>
    </div>
  );
}
export function App({ connection = defaultSocket }: { connection?: Socket }) {
  const socket = connection;
  const [state, setState] = useState<Snapshot>(),
    [connected, setConnected] = useState(false),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [mode, setMode] = useState<Mode>("1v1"),
    [error, setError] = useState(""),
    [rules, setRules] = useState(false),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const suspended = useRef(false);
  suspended.current = rules;
  const stateRef = useRef(state),
    keys = useRef(new Set<string>()),
    moveTarget = useRef<Point | undefined>(undefined),
    gesture = useRef<InteractionGesture | undefined>(undefined),
    lastInput = useRef({ signature: "", at: 0 });
  stateRef.current = state;
  const sendMove = useCallback(
    (sprint = false) => {
      if (
        stateRef.current?.phase !== "playing" ||
        !socket.connected ||
        suspended.current
      )
        return;
      const k = keys.current;
      const input = {
        x: Number(k.has("d")) - Number(k.has("a")),
        y: Number(k.has("s")) - Number(k.has("w")),
        target: moveTarget.current,
        sprint,
      };
      const signature = JSON.stringify({ ...input, sprint: false });
      const moving = !!(input.x || input.y || input.target);
      const now = Date.now();
      if (
        !sprint &&
        lastInput.current.signature === signature &&
        (!moving || now - lastInput.current.at < 250)
      )
        return;
      socket.emit("input", input);
      lastInput.current = { signature, at: now };
    },
    [socket],
  );
  const stop = useCallback(() => {
    keys.current.clear();
    moveTarget.current = undefined;
    lastInput.current = { signature: "", at: 0 };
    gesture.current?.cancel();
    if (socket.connected) socket.emit("input", { x: 0, y: 0 });
  }, [sendMove, socket]);
  useEffect(() => {
    gesture.current = new InteractionGesture(
      () => socket.emit("interactBegin"),
      (kind) => socket.emit("interactResolve", kind),
    );
    const onConnect = () => {
      setConnected(true);
      setError("");
      const saved = sessionStorage.getItem(SESSION);
      if (saved) {
        try {
          socket.emit("resume", JSON.parse(saved), (reply: Reply) => {
            if (!reply.ok) {
              sessionStorage.removeItem(SESSION);
              setState(undefined);
              setError(reply.error ?? "Session expired.");
            }
          });
        } catch {
          sessionStorage.removeItem(SESSION);
        }
      }
    };
    const onDisconnect = () => {
      setConnected(false);
      stop();
    };
    const onState = (packet: StatePacket) =>
      setState((previous) => {
        if (!sessionStorage.getItem(SESSION)) return undefined;
        const next = restoreSnapshot(packet, previous);
        if (next && moveTarget.current) {
          const self = next.players.find((p) => p.id === next.selfId);
          const oldSelf = previous?.players.find(
            (p) => p.id === previous.selfId,
          );
          if (
            !self ||
            (oldSelf &&
              Math.hypot(oldSelf.x - self.x, oldSelf.y - self.y) > 8) ||
            Math.hypot(
              self.x - moveTarget.current.x,
              self.y - moveTarget.current.y,
            ) < 0.25
          )
            moveTarget.current = undefined;
        }
        return next ?? previous;
      });
    const onReplaced = () => {
      sessionStorage.removeItem(SESSION);
      setState(undefined);
      setError("This session was opened in another tab.");
    };
    socket
      .on("connect", onConnect)
      .on("disconnect", onDisconnect)
      .on("state", onState)
      .on("replaced", onReplaced)
      .on("connect_error", () =>
        setError("Cannot reach the game server. Retrying…"),
      );
    socket.connect();
    const down = (e: KeyboardEvent) => {
      if (
        stateRef.current?.phase !== "playing" ||
        suspended.current ||
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      )
        return;
      const key = e.key.toLowerCase();
      if (!["w", "a", "s", "d", "e", "q"].includes(key)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (key === "e") gesture.current?.down();
      else if (key === "q") sendMove(true);
      else {
        moveTarget.current = undefined;
        keys.current.add(key);
        sendMove();
      }
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key === "e") gesture.current?.up();
      else if (["w", "a", "s", "d"].includes(key)) {
        keys.current.delete(key);
        sendMove();
      }
    };
    const visibility = () => {
      if (document.hidden) stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibility);
    const interval = setInterval(() => sendMove(), 100);
    return () => {
      stop();
      clearInterval(interval);
      socket
        .off("connect", onConnect)
        .off("disconnect", onDisconnect)
        .off("state", onState)
        .off("replaced", onReplaced);
      socket.removeAllListeners("connect_error");
      socket.disconnect();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [sendMove, stop]);
  useEffect(() => {
    if (state?.phase !== "playing") stop();
  }, [state?.phase, stop]);
  useEffect(() => {
    if (state?.phase === "finished")
      resultRef.current?.scrollIntoView?.({
        behavior: "smooth",
        block: "center",
      });
  }, [state?.phase]);
  useEffect(() => {
    if (rules) stop();
  }, [rules, stop]);
  function call(event: string, payload?: unknown) {
    setError("");
    setBusy(true);
    const ack = (r: Reply) => {
      setBusy(false);
      if (!r.ok) setError(r.error ?? "Try again.");
    };
    if (payload === undefined)
      socket
        .timeout(5000)
        .emit(event, (err: unknown, r: Reply) =>
          err ? (setBusy(false), setError("Request timed out.")) : ack(r),
        );
    else
      socket
        .timeout(5000)
        .emit(event, payload, (err: unknown, r: Reply) =>
          err ? (setBusy(false), setError("Request timed out.")) : ack(r),
        );
  }
  function join(create: boolean, tutorial = false) {
    setBusy(true);
    setError("");
    socket.timeout(5000).emit(
      "join",
      {
        create,
        name: tutorial ? name.trim() || "Explorer" : name,
        code,
        mode,
        tutorial,
      },
      (err: unknown, r: Reply) => {
        setBusy(false);
        if (err) {
          setError("Request timed out.");
          return;
        }
        if (r.ok)
          sessionStorage.setItem(
            SESSION,
            JSON.stringify({ playerId: r.playerId, token: r.token }),
          );
        else setError(r.error ?? "Unable to join.");
      },
    );
  }
  function leave() {
    stop();
    const saved = sessionStorage.getItem(SESSION);
    sessionStorage.removeItem(SESSION);
    setState(undefined);
    setError("");
    if (saved) {
      try {
        socket.emit("leave", JSON.parse(saved));
      } catch {
        socket.emit("leave");
      }
    } else socket.emit("leave");
  }
  const self = state?.players.find((p) => p.id === state.selfId),
    rosterSelf = state?.roster.find((p) => p.id === state.selfId),
    target = state
      ? [...state.buildings, ...state.players].find(
          (t) => t.id === state.targetId,
        )
      : undefined;
  const friendly =
    target && "kind" in target && target.teamId === rosterSelf?.teamId;
  const targetCost =
    target && target.power !== undefined
      ? attackCost({ ...target, power: target.power })
      : undefined;
  const targetTitle = target
    ? "kind" in target
      ? target.kind === "core"
        ? "Core"
        : target.kind === "plant"
          ? "Power Plant"
          : "Fort"
      : target.name
    : "Explore the island";
  const targetHint = target
    ? friendly
      ? "Tap: half · Double: max · Hold: deposit"
      : `Attack costs ${targetCost} · Need > ${"kind" in target ? targetCost : target.power}`
    : "Find a building or a weaker enemy within range.";
  return (
    <div
      className={"app" + (state?.phase === "playing" ? " active-match" : "")}
      onBeforeInput={(e) => {
        if (state?.phase === "playing") e.preventDefault();
      }}
      onFocusCapture={(e) => {
        if (
          state?.phase === "playing" &&
          e.target.matches("input, textarea, [contenteditable]")
        )
          e.target.blur();
      }}
    >
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-symbol">⬡</span> POWER ISLAND
        </a>
        <div className="top-actions">
          <span className={"connection " + (connected ? "online" : "")}>
            <i />
            {connected ? "Connected" : "Reconnecting"}
          </span>
          <button className="text-button" onClick={() => setRules(true)}>
            How to play ↗
          </button>
        </div>
      </header>
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {!state ? (
        <main className="home">
          <section className="hero">
            <span className="eyebrow">A REAL-TIME STRATEGY GAME FOR 2–4</span>
            <h1>
              Carry your
              <br />
              <em>advantage.</em>
            </h1>
            <p>
              One island. A hidden enemy. Every bit of Power makes you
              stronger—and slower.
            </p>
            <div className="hero-map" aria-hidden="true">
              <div className="island-art">
                <span className="art-core">
                  ⬡<small>50</small>
                </span>
                <span className="art-plant">
                  ϟ<small>10</small>
                </span>
                <span className="art-fort">
                  ▣<small>37</small>
                </span>
                <span className="art-player" />
              </div>
              <span className="art-label">EXPLORE · TRANSPORT · CONQUER</span>
            </div>
            <div className="hero-footer">
              <span>NO LOGIN</span>
              <span>PHONE + LAPTOP</span>
              <span>1V1 / 2V2</span>
            </div>
          </section>
          <section className="join-card">
            <span className="eyebrow">YOUR NEXT MATCH</span>
            <h2>Meet on the island.</h2>
            <label htmlFor="name">Your callsign</label>
            <input
              id="name"
              maxLength={18}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Northstar"
              autoComplete="nickname"
            />
            <div className="mode-picker">
              <button
                className={mode === "1v1" ? "selected" : ""}
                onClick={() => setMode("1v1")}
              >
                <b>1 v 1</b>
                <span>A duel of decisions</span>
              </button>
              <button
                className={mode === "2v2" ? "selected" : ""}
                onClick={() => setMode("2v2")}
              >
                <b>2 v 2</b>
                <span>Share vision. Work together.</span>
              </button>
            </div>
            <button
              className="primary"
              disabled={!connected || busy || !name.trim()}
              onClick={() => join(true)}
            >
              Create a room <span>↗</span>
            </button>
            <button
              className="secondary tutorial-start"
              disabled={!connected || busy}
              onClick={() => join(true, true)}
            >
              Play tutorial ↗
            </button>
            <div className="divider">
              <span>OR JOIN FRIENDS</span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                join(false);
              }}
            >
              <label htmlFor="code">Room code</label>
              <div className="code-row">
                <input
                  id="code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  autoComplete="off"
                />
                <button
                  className="secondary"
                  disabled={!connected || busy || !name.trim() || !code.trim()}
                >
                  Join →
                </button>
              </div>
            </form>
            <p className="small-note">
              Share a room code. No accounts, no downloads.
              <br />
              Each player needs their own tab or device.
            </p>
          </section>
        </main>
      ) : (
        <main className="match">
          <div className="match-heading">
            <div>
              <span className="eyebrow">
                {state.tutorial ? "TUTORIAL" : state.mode} /{" "}
                {state.phase.toUpperCase()}
              </span>
              <h1>
                {state.phase === "lobby"
                  ? "Gather your team."
                  : state.phase === "placement"
                    ? "Choose your ground."
                    : state.phase === "finished"
                      ? state.tutorial
                        ? state.result?.winner === rosterSelf?.teamId
                          ? "Tutorial complete."
                          : "Try another approach."
                        : state.result?.winner === null
                          ? "A perfect draw."
                          : `${teamNames[state.result?.winner ?? 0]} team wins.`
                      : rosterSelf?.alive
                        ? "Hold your ground."
                        : "Your teammate carries on."}
              </h1>
            </div>
            {state.tutorial ? (
              <span className="tag">SOLO PRACTICE</span>
            ) : (
              <button
                className="room-badge"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(state.code)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    })
                    .catch(() =>
                      setError("Copy unavailable. Share the code shown above."),
                    );
                }}
                aria-label="Copy room code"
              >
                <small>{copied ? "COPIED" : "ROOM CODE"}</small>
                {state.code} <span>⧉</span>
              </button>
            )}
          </div>
          {state.phase === "lobby" ? (
            <section className="lobby">
              <div className="lobby-copy">
                <span className="eyebrow">BEFORE YOU BEGIN</span>
                <h2>
                  {state.mode === "1v1"
                    ? "A worthy opponent."
                    : "Two Cores. One team."}
                </h2>
                <p>
                  Send your room code to{" "}
                  {state.mode === "1v1" ? "a friend" : "three friends"}.{" "}
                  {state.mode === "2v2"
                    ? "Choose your team below. Full teams can exchange players with an accepted swap. Each team shares buildings and vision."
                    : "Each player commands one Core."}
                </p>
                <p>
                  When everyone is here, the host starts placement. You have 30
                  seconds to place a Core in your zone.
                </p>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    state.hostId !== state.selfId ||
                    state.roster.length !== (state.mode === "1v1" ? 2 : 4) ||
                    state.roster.some((p) => !p.connected) ||
                    [0, 1].some(
                      (t) =>
                        state.roster.filter((p) => p.teamId === t).length !==
                        (state.mode === "1v1" ? 1 : 2),
                    )
                  }
                  onClick={() => call("start")}
                >
                  {state.hostId === state.selfId
                    ? "Start match ↗"
                    : "Waiting for host"}
                </button>
                <button className="text-button leave" onClick={leave}>
                  Leave room
                </button>
              </div>
              <div className="team-list">
                {state.swapRequests
                  .filter((r) => r.toId === state.selfId)
                  .map((r) => (
                    <div className="swap-offer" key={r.fromId}>
                      <p>
                        {state.roster.find((p) => p.id === r.fromId)?.name}{" "}
                        wants to swap teams with you.
                      </p>
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          call("replySwap", { fromId: r.fromId, accept: true })
                        }
                      >
                        Accept swap
                      </button>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          call("replySwap", { fromId: r.fromId, accept: false })
                        }
                      >
                        Decline
                      </button>
                    </div>
                  ))}
                {[0, 1].map((t) => (
                  <section key={t} className={`team team-${t}`}>
                    <div className="team-heading">
                      <span className="eyebrow">{teamNames[t]} TEAM</span>
                      <button
                        className="secondary team-join"
                        disabled={
                          busy ||
                          rosterSelf?.teamId === t ||
                          state.roster.filter((p) => p.teamId === t).length >=
                            (state.mode === "1v1" ? 1 : 2)
                        }
                        onClick={() => call("chooseTeam", { teamId: t })}
                      >
                        {rosterSelf?.teamId === t
                          ? "Your team"
                          : `Join ${teamNames[t]}`}
                      </button>
                    </div>
                    {Array.from(
                      { length: state.mode === "1v1" ? 1 : 2 },
                      (_, i) => {
                        const p = state.roster.filter((p) => p.teamId === t)[i];
                        return (
                          <div className="seat" key={i}>
                            <span className="seat-avatar">
                              {p ? p.name[0].toUpperCase() : "+"}
                            </span>
                            <div>
                              <b>{p ? p.name : "Open seat"}</b>
                              <small>
                                {p
                                  ? p.connected
                                    ? p.id === state.selfId
                                      ? "You · ready"
                                      : "Ready"
                                    : "Reconnecting…"
                                  : "Waiting for a player"}
                              </small>
                            </div>
                            {p && p.teamId !== rosterSelf?.teamId && (
                              <button
                                className="text-button swap-button"
                                disabled={
                                  busy ||
                                  !p.connected ||
                                  state.swapRequests.some(
                                    (r) =>
                                      r.fromId === state.selfId &&
                                      r.toId === p.id,
                                  )
                                }
                                onClick={() =>
                                  call("requestSwap", { playerId: p.id })
                                }
                              >
                                {state.swapRequests.some(
                                  (r) =>
                                    r.fromId === state.selfId &&
                                    r.toId === p.id,
                                )
                                  ? "Swap requested"
                                  : "Request swap"}
                              </button>
                            )}
                            {p?.id === state.hostId && (
                              <span className="tag">HOST</span>
                            )}
                          </div>
                        );
                      },
                    )}
                  </section>
                ))}
              </div>
            </section>
          ) : (
            <div className="play-layout">
              {state.tutorial && state.phase !== "finished" && (
                <div className="tutorial-card" aria-live="polite">
                  <span className="eyebrow">FIELD TRAINING</span>
                  <h2>{tutorialGuide[state.tutorial.stage].title}</h2>
                  <p>{tutorialGuide[state.tutorial.stage].body}</p>
                  <small>
                    Markers are suggestions, even through fog. Explore freely.
                    The practice opponent will not move or attack. Destroy its
                    Core at any time to finish.
                  </small>
                </div>
              )}
              <section className="board">
                <World
                  state={state}
                  onPlace={(p) => call("place", p)}
                  onMove={(p) => {
                    if (!connected || rules) return;
                    keys.current.clear();
                    moveTarget.current = p;
                    sendMove();
                  }}
                  onInvalid={setError}
                />
                {state.phase === "finished" && (
                  <div className="match-result-layer" ref={resultRef}>
                    <section
                      className="match-result-card"
                      aria-label="Match result"
                      aria-live="assertive"
                    >
                      <span className="eyebrow">
                        {state.tutorial ? "FIELD TRAINING" : "MATCH FINISHED"}
                      </span>
                      <h2>
                        {state.tutorial
                          ? state.result?.winner === rosterSelf?.teamId
                            ? "Tutorial complete"
                            : "Practice ended"
                          : state.result?.winner === null
                            ? "Draw"
                            : state.result?.winner === rosterSelf?.teamId
                              ? "Victory"
                              : "Defeat"}
                      </h2>
                      <p className="result-outcome">
                        {state.tutorial
                          ? state.result?.winner === rosterSelf?.teamId
                            ? "Ready to meet a real opponent?"
                            : "Restart and try another approach."
                          : state.result?.winner === null
                            ? "Both teams share the result."
                            : `${teamNames[state.result?.winner ?? 0]} wins the island.`}
                      </p>
                      <p>
                        {state.result?.reason.startsWith("Both")
                          ? state.result.reason
                          : state.result?.winner === rosterSelf?.teamId
                            ? "All enemy Cores are gone."
                            : state.tutorial
                              ? "Your Core was lost."
                              : "Your team has no surviving Core."}
                      </p>
                      {state.result?.reason.startsWith("Both") && (
                        <p>
                          Mint {state.result.totals[0]} · Coral{" "}
                          {state.result.totals[1]} Power
                        </p>
                      )}
                      <button
                        className="primary"
                        disabled={
                          busy ||
                          state.hostId !== state.selfId ||
                          state.roster.some((p) => !p.connected)
                        }
                        onClick={() => call("rematch")}
                      >
                        {state.hostId === state.selfId
                          ? state.tutorial
                            ? "Restart tutorial ↗"
                            : "Rematch · new island ↗"
                          : "Waiting for host to rematch"}
                      </button>
                      <button className="text-button leave" onClick={leave}>
                        Back to Home
                      </button>
                    </section>
                  </div>
                )}
                {!connected && (
                  <div className="board-status">
                    Connection lost. Reconnecting with this tab’s session for up
                    to 30 seconds.
                  </div>
                )}
              </section>
              <aside className="hud">
                <div className="hud-team">
                  <span className="eyebrow">
                    {teamNames[rosterSelf?.teamId ?? 0]} TEAM
                  </span>
                  <span className="tag">
                    {rosterSelf?.alive ? "ACTIVE" : "ELIMINATED"}
                  </span>
                </div>
                {state.phase === "placement" ? (
                  <>
                    <h2>
                      {rosterSelf?.placed
                        ? "Core established."
                        : "Place your Core."}
                    </h2>
                    <p>
                      {rosterSelf?.placed
                        ? "Wait for the remaining players."
                        : "Click once to select a spot in your zone. Click the selected spot again to confirm; click elsewhere to move it. Neutral Power is hidden during placement."}
                    </p>
                    {!rosterSelf?.placed && (
                      <div className="power-number">
                        {Math.ceil((rosterSelf?.timeoutRemaining ?? 0) / 1000)}
                        <small>seconds remaining</small>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <span className="eyebrow">CARRIED POWER</span>
                    <div className="power-number">
                      {self?.power ?? "—"}
                      <small>
                        {self
                          ? `${normalSpeed(self.power).toFixed(1)} units / second`
                          : "Personal Core lost"}
                      </small>
                    </div>
                    {state.phase === "playing" && (
                      <div className="target-card">
                        <span className="eyebrow">
                          {target ? "HIGHLIGHTED TARGET" : "NO TARGET IN RANGE"}
                        </span>
                        <h3>{targetTitle}</h3>
                        <p>{targetHint}</p>
                      </div>
                    )}
                  </>
                )}
                <div className="mini-roster">
                  {state.roster.map((p) => (
                    <div key={p.id}>
                      <i className={`team-dot dot-${p.teamId}`} />
                      <span>{p.name}</span>
                      <small>
                        {!p.alive
                          ? "Out"
                          : !p.connected
                            ? `${Math.ceil((p.timeoutRemaining ?? 0) / 1000)}s`
                            : "Core " + (p.placed ? "alive" : "pending")}
                      </small>
                    </div>
                  ))}
                </div>
                {state.notice && (
                  <p className="notice" role="status">
                    {state.notice}
                  </p>
                )}
                {state.phase === "playing" && rosterSelf?.alive && (
                  <>
                    <div className="desktop-controls">
                      <p>
                        <kbd>WASD</kbd> Move
                      </p>
                      <p>
                        <kbd>E</kbd> Interact · tap / double / hold
                      </p>
                      <p>
                        <kbd>Q</kbd> Sprint ·{" "}
                        {self?.sprintTicks
                          ? "active"
                          : self && self.power > 10
                            ? "ready"
                            : "needs >10 Power"}
                      </p>
                    </div>
                    <div className="touch-controls">
                      <p>Tap the map to move in a straight line.</p>
                      <div className="touch-buttons">
                        <button
                          className="interaction-button"
                          aria-label="Interact: tap half, double tap maximum, hold deposit"
                          onPointerDown={(e) => {
                            e.currentTarget.setPointerCapture(e.pointerId);
                            gesture.current?.down();
                          }}
                          onPointerUp={() => gesture.current?.up()}
                          onPointerCancel={() => gesture.current?.cancel()}
                        >
                          Interact<small>tap / double / hold</small>
                        </button>
                        <button
                          className="sprint-button"
                          disabled={
                            !self || self.power <= 10 || !!self.sprintTicks
                          }
                          onPointerDown={(e) => {
                            e.preventDefault();
                            sendMove(true);
                          }}
                        >
                          Sprint<small>−10 Power</small>
                        </button>
                      </div>
                    </div>
                  </>
                )}
                {state.phase !== "finished" && rosterSelf?.alive && (
                  <button className="text-button leave" onClick={leave}>
                    Leave room immediately
                  </button>
                )}
                {state.phase !== "finished" &&
                  (rosterSelf?.alive ? (
                    <button
                      className="text-button leave"
                      onClick={() => call("surrender")}
                    >
                      Surrender your Core
                    </button>
                  ) : (
                    <button className="text-button leave" onClick={leave}>
                      Leave room
                    </button>
                  ))}
              </aside>
            </div>
          )}
        </main>
      )}
      <footer className="footer">
        <span>POWER ISLAND / PLAYTEST BUILD</span>
        <span>Power. Vision. Position.</span>
      </footer>
      {rules && <Rules close={() => setRules(false)} />}
    </div>
  );
}
