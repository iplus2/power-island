import { test } from "node:test";
import assert from "node:assert/strict";
import { InteractionGesture, type Timer } from "../src/client/gesture";
function fixture() {
  let now = 0,
    id = 0;
  const jobs = new Map<number, { at: number; fn: () => void }>();
  const timer: Timer = {
    now: () => now,
    set: (fn, ms) => {
      jobs.set(++id, { at: now + ms, fn });
      return id;
    },
    clear: (id) => {
      jobs.delete(id as number);
    },
  };
  const events: string[] = [];
  const g = new InteractionGesture(
    () => events.push("begin"),
    (kind) => events.push(kind),
    timer,
  );
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      jobs.delete(next[0]);
      next[1].fn();
    }
    now = end;
  };
  return { g, events, advance };
}
test("Single emits half only after double window", () => {
  const { g, events, advance } = fixture();
  g.down();
  advance(30);
  g.up();
  advance(259);
  assert.deepEqual(events, ["begin"]);
  advance(1);
  assert.deepEqual(events, ["begin", "half"]);
});
test("Double emits exactly one max with original target lock", () => {
  const { g, events, advance } = fixture();
  g.down();
  g.up();
  advance(120);
  g.down();
  g.up();
  advance(1000);
  assert.deepEqual(events, ["begin", "max"]);
});
test("Hold emits one deposit with no accidental half", () => {
  const { g, events, advance } = fixture();
  g.down();
  advance(480);
  g.up();
  advance(1000);
  assert.deepEqual(events, ["begin", "deposit"]);
});
test("Repeat keydown does not retrigger and cancel clears pending actions", () => {
  const { g, events, advance } = fixture();
  g.down();
  g.down();
  g.up();
  g.cancel();
  advance(1000);
  assert.deepEqual(events, ["begin"]);
});
