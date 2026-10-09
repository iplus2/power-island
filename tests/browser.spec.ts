import { validPoint } from "../src/shared/map";
import {
  restoreSnapshot,
  type Snapshot,
  type StatePacket,
} from "../src/shared/types";
import { test, expect, type Page } from "@playwright/test";
async function create(page: Page, mode: "1v1" | "2v2") {
  await page.goto("/");
  await page.getByLabel("Your callsign").fill("Northstar");
  await page
    .getByRole("button", { name: mode === "1v1" ? "1 v 1" : "2 v 2" })
    .click();
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.getByText("Gather your team.")).toBeVisible();
  return (
    await page.getByRole("button", { name: "Copy room code" }).innerText()
  ).match(/[A-F0-9]{6}/)![0];
}
async function join(page: Page, code: string, name: string) {
  await page.goto("/");
  await page.getByLabel("Your callsign").fill(name);
  await page.getByLabel("Room code", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Join →", exact: true }).click();
  await expect(page.getByText("Gather your team.")).toBeVisible();
}
async function place(
  page: Page,
  mode: "1v1" | "2v2",
  beforeConfirm?: () => Promise<void>,
) {
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const zone = Number(await canvas.getAttribute("data-zone"));
  const r = await canvas.boundingBox();
  if (!r) throw new Error("No canvas");
  const x =
      mode === "1v1" ? (zone === 0 ? 0.3 : 0.7) : zone % 2 === 0 ? 0.3 : 0.7,
    y = mode === "1v1" ? 0.5 : zone < 2 ? 0.3 : 0.7;
  // Try nearby valid points if a neutral building occupies the first candidate.
  for (const offset of [0, 0.06, -0.06, 0.12, -0.12]) {
    await canvas.click({
      position: { x: r.width * (x + offset), y: r.height * y },
    });
    if (await page.getByRole("alert").count()) {
      await page.getByRole("button", { name: "Dismiss error" }).click();
      continue;
    }
    await expect(canvas).toHaveAttribute("data-selected", /.+/);
    await beforeConfirm?.();
    await canvas.click({
      position: { x: r.width * (x + offset), y: r.height * y },
    });
    return;
  }
  throw new Error("No valid placement candidate");
}
test("Desktop 1v1: placement, WASD, E gestures, Q, surrender, rematch, session restore", async ({
  browser,
}) => {
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1280, height: 900 } }),
    browser.newContext({ viewport: { width: 1280, height: 900 } }),
  ]);
  const [a, b] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  try {
    await a.goto("/");
    await a.screenshot({
      path: "outputs/screenshots/home-desktop.png",
      fullPage: true,
    });
    const code = await create(a, "1v1");
    await a.getByRole("button", { name: "Join Coral", exact: true }).click();
    await join(b, code, "Southwind");
    await b.getByRole("button", { name: "Request swap", exact: true }).click();
    await a.getByRole("button", { name: "Accept swap", exact: true }).click();
    await expect(
      a.locator(".team-0").getByText("Northstar", { exact: true }),
    ).toBeVisible();
    await a.getByRole("button", { name: "Start match" }).click();
    await expect(a.getByText("Choose your ground.")).toBeVisible();
    await place(a, "1v1");
    await place(b, "1v1");
    await expect(a.getByText("Hold your ground.")).toBeVisible();
    await a.keyboard.press("e");
    await expect(a.locator(".power-number")).toContainText("11");
    await expect(a.getByText("Withdrew 10 Power.")).toBeVisible();
    await a.keyboard.down("e");
    await a.waitForTimeout(550);
    await a.keyboard.up("e");
    await expect(a.locator(".power-number")).toContainText("1");
    await expect(a.getByText("Deposited 10 Power.")).toBeVisible();
    await a.keyboard.press("e");
    await a.keyboard.press("e");
    await expect(a.getByText("Withdrew 10 Power.")).toBeVisible();
    await expect(a.locator(".power-number")).toContainText("11");
    await a.keyboard.press("q");
    await expect(a.locator(".power-number")).toContainText("1");
    await a.keyboard.down("d");
    await a.waitForTimeout(350);
    await a.keyboard.up("d");
    await a.screenshot({
      path: "outputs/screenshots/match-desktop.png",
      fullPage: true,
    });
    await a.reload();
    await expect(a.getByText("Hold your ground.")).toBeVisible();
    await a.getByRole("button", { name: "Surrender your Core" }).click();
    await expect(b.getByText("Coral team wins.")).toBeVisible();
    await b.getByRole("button", { name: "Rematch · new island" }).click();
    await expect(a.getByText("Gather your team.")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }
});
test("Four browser clients, phone viewport, team placement and individual surrender", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      browser.newContext(
        i === 1
          ? {
              viewport: { width: 390, height: 844 },
              hasTouch: true,
              isMobile: true,
            }
          : { viewport: { width: 1100, height: 850 } },
      ),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const [a, mobile] = pages;
  try {
    const code = await create(a, "2v2");
    for (let i = 1; i < 4; i++) await join(pages[i], code, `Player ${i}`);
    await a.getByRole("button", { name: "Start match" }).click();
    for (const p of pages) await place(p, "2v2");
    for (const p of pages)
      await expect(p.getByText("Hold your ground.")).toBeVisible();
    await mobile.locator(".interaction-button").tap();
    await expect(mobile.getByText("Withdrew 10 Power.")).toBeVisible();
    // Touch button down/up use the same arbitration as E.
    const btn = mobile.locator(".interaction-button");
    const box = await btn.boundingBox();
    if (!box) throw new Error("Missing interaction button");
    const cdp = await mobile.context().newCDPSession(mobile);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 },
      ],
    });
    await mobile.waitForTimeout(550);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(mobile.getByText("Deposited 10 Power.")).toBeVisible();
    expect(
      await mobile.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await mobile.screenshot({
      path: "outputs/screenshots/match-mobile.png",
      fullPage: true,
    });
    await a.getByRole("button", { name: "Surrender your Core" }).click();
    await expect(a.getByText("Your teammate carries on.")).toBeVisible();
    await expect(mobile.getByText("Hold your ground.")).toBeVisible();
    await mobile.getByRole("button", { name: "Surrender your Core" }).click();
    await expect(pages[2].getByText("Coral team wins.")).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }
});

test("Touch 1v1: canceled placement gestures, straight destinations, DPR3/zoom, selection restoration and Leave", async ({
  browser,
}) => {
  const contexts = await Promise.all([
    browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
    }),
    browser.newContext({ viewport: { width: 1100, height: 850 } }),
  ]);
  const [mobile, other] = await Promise.all(contexts.map((c) => c.newPage()));
  let snapshot: Snapshot | undefined;
  const inputs: unknown[] = [];
  mobile.on("websocket", (ws) => {
    ws.on("framereceived", ({ payload }) => {
      const text = String(payload);
      if (text.startsWith('42["state",'))
        snapshot =
          restoreSnapshot(
            JSON.parse(text.slice(2))[1] as StatePacket,
            snapshot,
          ) ?? snapshot;
    });
    ws.on("framesent", ({ payload }) => {
      const text = String(payload);
      if (text.startsWith('42["input",'))
        inputs.push(JSON.parse(text.slice(2))[1]);
    });
  });
  const cdp = await mobile.context().newCDPSession(mobile);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    points: { x: number; y: number; id: number }[],
  ) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  async function mapPoint(x: number, y: number) {
    const r = await mobile.locator("canvas").boundingBox();
    if (!r) throw new Error("No map");
    const view = await mobile.locator("canvas").evaluate((el) => ({
      left: Number(el.getAttribute("data-map-left")),
      top: Number(el.getAttribute("data-map-top")),
      size: Number(el.getAttribute("data-map-size")),
    }));
    return {
      x: r.x + ((x - view.left) / view.size) * r.width,
      y: r.y + ((y - view.top) / view.size) * r.height,
      id: 1,
    };
  }
  try {
    const code = await create(mobile, "1v1");
    await join(other, code, "Opponent");
    await mobile.getByRole("button", { name: "Start match" }).click();
    const canvas = mobile.locator("canvas");
    await expect(canvas).toBeVisible();
    await canvas.scrollIntoViewIfNeeded();
    const point = await mapPoint(100, 100);
    await touch("touchStart", [point]);
    await touch("touchMove", [{ ...point, y: point.y - 60 }]);
    await touch("touchEnd", []);
    await expect(canvas).not.toHaveAttribute("data-selected", /.+/);
    await canvas.scrollIntoViewIfNeeded();
    const p = await mapPoint(100, 100);
    await touch("touchStart", [p, { ...p, x: p.x + 30, id: 2 }]);
    await touch("touchMove", [
      { ...p, x: p.x - 15 },
      { ...p, x: p.x + 50, id: 2 },
    ]);
    await touch("touchEnd", []);
    await expect(canvas).not.toHaveAttribute("data-selected", /.+/);
    // Explicit browser pointer cancellation also cannot leave a deployable tap.
    await canvas.dispatchEvent("pointerdown", {
      pointerId: 91,
      button: 0,
      clientX: p.x,
      clientY: p.y,
    });
    await canvas.dispatchEvent("pointercancel", { pointerId: 91 });
    await canvas.dispatchEvent("pointerup", {
      pointerId: 91,
      clientX: p.x,
      clientY: p.y,
    });
    await expect(canvas).not.toHaveAttribute("data-selected", /.+/);
    await place(mobile, "1v1", async () => {
      const selected = await canvas.getAttribute("data-selected");
      const [x, y] = selected!.split(",").map(Number);
      const q = await mapPoint(x, y);
      await touch("touchStart", [q]);
      await touch("touchMove", [{ ...q, y: q.y - 45 }]);
      await touch("touchEnd", []);
      await canvas.scrollIntoViewIfNeeded();
      const r = await mapPoint(x, y);
      await touch("touchStart", [r, { ...r, x: r.x + 25, id: 2 }]);
      await touch("touchMove", [
        { ...r, x: r.x - 10 },
        { ...r, x: r.x + 40, id: 2 },
      ]);
      await touch("touchEnd", []);
      await expect(canvas).toHaveAttribute("data-selected", selected!);
      expect(
        snapshot!.roster.find((p) => p.id === snapshot!.selfId)!.placed,
      ).toBe(false);
    });
    await place(other, "1v1");
    await expect(mobile.getByText("Hold your ground.")).toBeVisible();
    expect(
      await mobile
        .locator(".app")
        .evaluate((el) => getComputedStyle(el).userSelect),
    ).toBe("none");
    await expect(mobile.locator(".joystick")).toHaveCount(0);
    await canvas.scrollIntoViewIfNeeded();
    const self = snapshot!.players.find((p) => p.id === snapshot!.selfId)!;
    const destination = { x: self.x + (self.x < 100 ? 8 : -8), y: self.y };
    const dest = await mapPoint(destination.x, destination.y);
    await mobile.touchscreen.tap(dest.x, dest.y);
    await expect
      .poll(() => {
        const p = snapshot?.players.find((p) => p.id === snapshot!.selfId);
        return p ? Math.hypot(p.x - destination.x, p.y - destination.y) : 999;
      })
      .toBeLessThan(0.25);
    // A new tap replaces the destination; blur explicitly clears it.
    const retarget = await mapPoint(100, 100);
    await mobile.touchscreen.tap(retarget.x, retarget.y);
    await expect
      .poll(() =>
        inputs.some(
          (p: any) =>
            p.target && Math.hypot(p.target.x - 100, p.target.y - 100) < 1,
        ),
      )
      .toBe(true);
    await mobile.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect
      .poll(() => {
        const p = inputs.at(-1) as any;
        return !!p && !p.target && p.x === 0 && p.y === 0;
      })
      .toBe(true);
    await mobile.waitForTimeout(350);
    const count = inputs.filter((p: any) => p.target).length;
    const before = snapshot!.players.find((p) => p.id === snapshot!.selfId)!;
    const origin = await mapPoint(before.x, before.y);
    await touch("touchStart", [origin]);
    await touch("touchMove", [{ ...origin, y: origin.y - 60 }]);
    await touch("touchEnd", []);
    await mobile.waitForTimeout(350);
    expect(inputs.filter((p: any) => p.target).length).toBe(count);
    const after = snapshot!.players.find((p) => p.id === snapshot!.selfId)!;
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(
      0.25,
    );
    // Native Chromium page scale, not a CSS transform. Backing pixels follow DPR and visual viewport scale.
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await expect
      .poll(() => mobile.evaluate(() => window.visualViewport!.scale))
      .toBe(2);
    await expect
      .poll(() =>
        canvas.evaluate(
          (el: HTMLCanvasElement) =>
            el.width /
            Math.round(
              el.getBoundingClientRect().width *
                devicePixelRatio *
                window.visualViewport!.scale,
            ),
        ),
      )
      .toBe(1);
    const focus = await canvas.evaluate(
      (el, self) => {
        const r = el.getBoundingClientRect(),
          v = visualViewport!,
          size = Number(el.dataset.mapSize);
        return {
          xDistance: -(
            r.left +
            ((self.x - Number(el.dataset.mapLeft)) / size) * r.width -
            v.offsetLeft -
            v.width / 2
          ),
          yDistance: -(
            r.top +
            ((self.y - Number(el.dataset.mapTop)) / size) * r.height -
            v.offsetTop -
            v.height / 2
          ),
        };
      },
      snapshot!.players.find((p) => p.id === snapshot!.selfId)!,
    );
    await cdp.send("Input.synthesizeScrollGesture", {
      x: 80,
      y: 120,
      ...focus,
      gestureSourceType: "touch",
    });
    await mobile.screenshot({
      path: "outputs/screenshots/touch-dpr3-zoom.png",
    });
    const offset = await mobile.evaluate(() => ({
      x: visualViewport!.pageLeft,
      y: visualViewport!.pageTop,
    }));
    await cdp.send("Input.synthesizeScrollGesture", {
      x: 100,
      y: 150,
      yDistance: -100,
      gestureSourceType: "touch",
    });
    await expect
      .poll(() =>
        mobile.evaluate(
          (o) =>
            visualViewport!.pageLeft !== o.x || visualViewport!.pageTop !== o.y,
          offset,
        ),
      )
      .toBe(true);

    const mapping = await canvas.evaluate((el: HTMLCanvasElement) => {
      const r = el.getBoundingClientRect(),
        v = visualViewport!;
      return {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        offsetLeft: v.offsetLeft,
        offsetTop: v.offsetTop,
        scale: v.scale,
        viewportWidth: v.width,
        viewportHeight: v.height,
        mapLeft: Number(el.dataset.mapLeft),
        mapTop: Number(el.dataset.mapTop),
        mapSize: Number(el.dataset.mapSize),
      };
    });
    let mapped:
      { x: number; y: number; worldX: number; worldY: number } | undefined;
    for (let y = 60; y < mapping.viewportHeight - 20 && !mapped; y += 40)
      for (let x = 40; x < mapping.viewportWidth - 20 && !mapped; x += 40) {
        const worldX =
          mapping.mapLeft +
          ((x + mapping.offsetLeft - mapping.left) / mapping.width) *
            mapping.mapSize;
        const worldY =
          mapping.mapTop +
          ((y + mapping.offsetTop - mapping.top) / mapping.height) *
            mapping.mapSize;
        if (validPoint({ x: worldX, y: worldY }, snapshot!.boundary))
          mapped = { x, y, worldX, worldY };
      }
    expect(mapped).toBeDefined();
    await mobile.touchscreen.tap(mapped!.x, mapped!.y);
    await expect
      .poll(() =>
        inputs.some(
          (p: any) =>
            p.target &&
            Math.hypot(
              p.target.x - mapped!.worldX,
              p.target.y - mapped!.worldY,
            ) < 0.5,
        ),
      )
      .toBe(true);
    await mobile.evaluate(() => window.dispatchEvent(new Event("blur")));
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await canvas.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        canvas.evaluate(
          (el: HTMLCanvasElement) =>
            el.width /
            Math.round(el.getBoundingClientRect().width * devicePixelRatio),
        ),
      )
      .toBe(1);
    await mobile.screenshot({
      path: "outputs/screenshots/touch-dpr3.png",
      fullPage: true,
    });
    await mobile.getByRole("button", { name: "Surrender your Core" }).click();
    await expect(mobile.getByText("Coral team wins.")).toBeVisible();
    expect(
      await mobile
        .locator(".app")
        .evaluate((el) => getComputedStyle(el).userSelect),
    ).not.toBe("none");
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    const home = mobile.getByRole("button", { name: "Back to Home" });
    await home.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const homeTap = await home.evaluate((el) => {
      const r = el.getBoundingClientRect(),
        v = visualViewport!;
      return {
        x: r.left + Math.min(40, r.width / 2) - v.offsetLeft,
        y: r.top + r.height / 2 - v.offsetTop,
      };
    });
    await mobile.touchscreen.tap(homeTap.x, homeTap.y);
    await expect(mobile.getByLabel("Your callsign")).toBeEditable();
    expect(
      await mobile.evaluate(() =>
        sessionStorage.getItem("power-island-session"),
      ),
    ).toBeNull();
    expect(
      await mobile
        .locator(".app")
        .evaluate((el) => getComputedStyle(el).userSelect),
    ).not.toBe("none");
  } finally {
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  }
});

function tutorialSnapshot(page: Page) {
  let snapshot: Snapshot | undefined;
  page.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) => {
      const text = String(payload);
      if (text.startsWith('42["state",'))
        snapshot =
          restoreSnapshot(
            JSON.parse(text.slice(2))[1] as StatePacket,
            snapshot,
          ) ?? snapshot;
    }),
  );
  return () => snapshot!;
}
async function mapPoint(page: Page, x: number, y: number) {
  const canvas = page.locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const rect = (await canvas.boundingBox())!;
  const view = await canvas.evaluate((el) => ({
    left: Number(el.getAttribute("data-map-left")),
    top: Number(el.getAttribute("data-map-top")),
    size: Number(el.getAttribute("data-map-size")),
  }));
  await canvas.click({
    position: {
      x: ((x - view.left) / view.size) * rect.width,
      y: ((y - view.top) / view.size) * rect.height,
    },
  });
}
async function selectTutorial(page: Page, part: number) {
  await page.goto("/");
  await page.getByRole("button", { name: "Play tutorial" }).click();
  const menu = page.getByRole("dialog", { name: "Choose a tutorial" });
  await expect(menu.getByRole("button")).toHaveCount(5);
  if (part === 1)
    await page.screenshot({
      path: "outputs/screenshots/tutorial-menu.png",
      fullPage: true,
    });
  await menu.getByRole("button", { name: new RegExp(`^${part}\\.`) }).click();
}
test("Tutorial Part 1: ordered movement and gestures, result, Next opens auto-placed Part 2", async ({
  page,
}) => {
  const view = tutorialSnapshot(page);
  await selectTutorial(page, 1);
  await expect.poll(() => view()?.tutorial?.stage).toBe("place");
  expect(view().buildings.every((b) => b.power === undefined)).toBe(true);
  await mapPoint(page, 45, 100);
  expect(view().phase).toBe("placement");
  await mapPoint(page, 45, 100);
  await expect.poll(() => view()?.tutorial?.stage).toBe("move");
  await mapPoint(page, 45, 110);
  await expect.poll(() => view()?.tutorial?.stage).toBe("half");
  await mapPoint(page, 45, 100);
  await expect
    .poll(() => view().players.find((p) => p.id === view().selfId)?.y)
    .toBeLessThan(102);
  await page.keyboard.press("e");
  await expect.poll(() => view()?.tutorial?.stage).toBe("max");
  await page.keyboard.press("e");
  await page.keyboard.press("e");
  await expect.poll(() => view()?.tutorial?.stage).toBe("deposit");
  await page.keyboard.down("e");
  await page.waitForTimeout(550);
  await page.keyboard.up("e");
  const result = page.getByRole("region", { name: "Match result" });
  await expect(
    result.getByRole("heading", { name: "Tutorial complete" }),
  ).toBeVisible();
  await expect(result.getByText("Part 1 objective completed.")).toBeVisible();
  await result.getByRole("button", { name: "Next tutorial" }).click();
  await expect.poll(() => view()?.tutorial?.part).toBe(2);
  expect(view().phase).toBe("playing");
  expect(view().tutorial?.stage).toBe("firstPlant");
  await page.getByRole("button", { name: "Leave room immediately" }).click();
});

test("Tutorial Part 2: actual Plant production, full Fort cost, resume and next part", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const view = tutorialSnapshot(page);
  await selectTutorial(page, 2);
  await expect.poll(() => view()?.tutorial?.stage).toBe("firstPlant");
  await page.keyboard.press("e");
  await expect
    .poll(() => view().players.find((p) => p.id === view().selfId)!.power)
    .toBe(6);
  await mapPoint(page, 60.443, 99.511);
  await expect.poll(() => view()?.targetId).toBe("b0");
  await page.keyboard.press("e");
  await expect.poll(() => view()?.tutorial?.stage).toBe("fort");
  const version = view().mapVersion;
  await page.reload();
  await expect.poll(() => view()?.tutorial?.stage).toBe("fort");
  expect(view().mapVersion).toBe(version);
  await expect
    .poll(() => view()?.buildings.find((b) => b.id === "b0")?.power, {
      timeout: 40_000,
    })
    .toBeGreaterThan(12);
  await page.keyboard.press("e");
  await page.keyboard.press("e");
  await expect.poll(() => view()?.tutorial?.stage).toBe("fort");
  await mapPoint(page, 65.441, 56.962);
  await expect.poll(() => view()?.targetId, { timeout: 10_000 }).toBe("b14");
  await page.keyboard.press("e");
  const result = page.getByRole("region", { name: "Match result" });
  await expect(
    result.getByRole("heading", { name: "Tutorial complete" }),
  ).toBeVisible();
  await result.getByRole("button", { name: "Next tutorial" }).click();
  await expect.poll(() => view()?.tutorial?.part).toBe(3);
  await page.getByRole("button", { name: "Leave room immediately" }).click();
});

test("Tutorial Part 3: ordinary keyboard sprints catch moving opponent and complete", async ({
  page,
}) => {
  const view = tutorialSnapshot(page);
  await selectTutorial(page, 3);
  await expect.poll(() => view()?.tutorial?.stage).toBe("chase");
  await expect(page.locator(".tutorial-card small")).toHaveCount(0);
  await expect(page.locator(".tutorial-card")).not.toContainText("coast");
  await page.keyboard.press("e");
  await expect
    .poll(() => view().players.find((p) => p.id === view().selfId)!.power)
    .toBeGreaterThan(20);
  await page.keyboard.down("d");
  await page.keyboard.press("q");
  await expect
    .poll(() => view()?.targetId, { timeout: 3000 })
    .toMatch(/^practice-/);
  await page.keyboard.press("e");
  await expect(
    page.getByRole("heading", { name: "Tutorial complete", exact: true }),
  ).toBeVisible();
  await page.keyboard.up("d");
  await page.getByRole("button", { name: "Next tutorial" }).click();
  await expect.poll(() => view()?.tutorial?.part).toBe(4);
  await page.getByRole("button", { name: "Leave room immediately" }).click();
});

test("Tutorial Part 4: narrow touch menu, no markers until shared discovery, final result only Home", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const view = tutorialSnapshot(page);
  try {
    await selectTutorial(page, 4);
    await expect.poll(() => view()?.tutorial?.stage).toBe("frontier");
    expect(view().tutorial!.markers).toEqual([]);
    await expect(
      page.getByText(/Travel light: leave stored Power/),
    ).toBeVisible();
    await mapPoint(page, 145, 150);
    await expect
      .poll(() => view()?.tutorial?.stage, { timeout: 12_000 })
      .toBe("enemyPlant");
    expect(view().tutorial!.markers[0].label).toBe("Enemy Plant");
    await page.getByRole("button", { name: "Surrender your Core" }).click();
    const result = page.getByRole("region", { name: "Match result" });
    await expect(result).toBeVisible();
    await expect(result.getByRole("button")).toHaveCount(1);
    const button = result.getByRole("button", { name: "Back to Home" });
    const bounds = await button.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    await page.screenshot({
      path: "outputs/screenshots/tutorial-four-mobile.png",
      fullPage: true,
    });
    await button.click();
    await expect(
      page.getByRole("button", { name: "Play tutorial" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("Tutorial Part 4: real production and movement fund ordered Plant/Fort/Core victory", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const view = tutorialSnapshot(page);
  const self = () => view().players.find((p) => p.id === view().selfId)!;
  async function approach(x: number, y: number) {
    await mapPoint(page, x, y);
    await expect
      .poll(() => Math.hypot(self().x - x, self().y - y), { timeout: 18_000 })
      .toBeLessThan(1);
  }
  async function maxWithdraw() {
    const before = self().power;
    await page.keyboard.press("e");
    await page.keyboard.press("e");
    await expect.poll(() => self().power).toBeGreaterThan(before);
  }
  await selectTutorial(page, 4);
  await expect.poll(() => view()?.tutorial?.stage).toBe("frontier");
  await maxWithdraw();
  await approach(132, 149);
  await expect.poll(() => view().tutorial?.stage).toBe("enemyPlant");
  await approach(133.591, 146.862);
  await expect.poll(() => view().targetId).toBe("b7");
  await page.keyboard.press("e");
  await expect.poll(() => view().tutorial?.stage).toBe("enemyFort");
  await expect(page.locator(".tutorial-card")).toContainText(
    "stockpile Power near the front line",
  );
  await expect(page.locator(".tutorial-card small")).toHaveCount(0);
  await page.screenshot({
    path: "outputs/screenshots/tutorial-fort-guide.png",
    fullPage: true,
  });
  await approach(127.922, 136.368);
  await expect.poll(() => view().targetId).toBe("b12");
  await page.keyboard.press("e");
  await expect.poll(() => view().tutorial?.stage).toBe("core");
  await approach(60.443, 99.511);
  await expect
    .poll(() => view().buildings.find((b) => b.id === "b0")!.power, {
      timeout: 60_000,
    })
    .toBeGreaterThanOrEqual(25);
  await maxWithdraw();
  await approach(60.076, 119.648);
  await maxWithdraw();
  await approach(79.435, 72.491);
  await maxWithdraw();
  await approach(145, 150);
  await expect.poll(() => view().targetId).toMatch(/^core-practice-/);
  await page.keyboard.press("e");
  const result = page.getByRole("region", { name: "Match result" });
  await expect(
    result.getByRole("heading", { name: "Tutorial complete", exact: true }),
  ).toBeVisible();
  await expect(result.getByRole("button")).toHaveCount(1);
  await page.screenshot({
    path: "outputs/screenshots/tutorial-four-victory.png",
    fullPage: true,
  });
  await result.getByRole("button", { name: "Back to Home" }).click();
});
