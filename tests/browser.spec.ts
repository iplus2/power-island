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
async function place(page: Page, mode: "1v1" | "2v2") {
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
    await a.screenshot({ path: "outputs/home-desktop.png", fullPage: true });
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
    await a.screenshot({ path: "outputs/match-desktop.png", fullPage: true });
    await a.reload();
    await expect(a.getByText("Hold your ground.")).toBeVisible();
    await a.getByRole("button", { name: "Surrender your Core" }).click();
    await expect(b.getByText("Coral team wins.")).toBeVisible();
    await a.getByRole("button", { name: "Rematch · new island" }).click();
    await expect(a.getByText("Gather your team.")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
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
      path: "outputs/match-mobile.png",
      fullPage: true,
    });
    await a.getByRole("button", { name: "Surrender your Core" }).click();
    await expect(a.getByText("Your teammate carries on.")).toBeVisible();
    await expect(mobile.getByText("Hold your ground.")).toBeVisible();
    await mobile.getByRole("button", { name: "Surrender your Core" }).click();
    await expect(pages[2].getByText("Coral team wins.")).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
