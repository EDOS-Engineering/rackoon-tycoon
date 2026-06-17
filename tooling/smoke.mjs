// Dev-only smoke + behaviour test for Rackoon Tycoon. NOT shipped with the game.
// Boots the served game, drives title → briefing → play, and asserts the Phase 2
// loop behaves: the briefing pauses the sim, a legal route flows guests, and the
// AWS bill draws the budget down without bankrupting a sensible build.
import { chromium } from "playwright";

const URL = process.env.GAME_URL || "http://127.0.0.1:8000/game/game.html";
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console.error: " + m.text());
});
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) =>
  errors.push("requestfailed: " + r.url() + " " + (r.failure()?.errorText || ""))
);

await page.goto(URL, { waitUntil: "networkidle", timeout: 20000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: "tooling/shot-title.png" });

// Title → level (Enter starts the campaign's continue level).
await page.keyboard.press("Enter");
await page.waitForTimeout(800);
await page.screenshot({ path: "tooling/shot-briefing.png" });

// The briefing must pause the sim: not started, full budget, no packets in flight.
const briefing = await page.evaluate(() => {
  const s = window.__rackoon.scenes.current;
  return {
    scene: s.constructor.name,
    started: s.started,
    budget: Math.round(s.budget),
    startBudget: s.level.budget,
    packets: s.packets.length,
  };
});

// Help overlay toggles (H).
await page.keyboard.press("KeyH");
await page.waitForTimeout(300);
await page.screenshot({ path: "tooling/shot-help.png" });
const helpOpen = await page.evaluate(() => window.__rackoon.scenes.current.showHelp);
await page.keyboard.press("KeyH"); // close
await page.waitForTimeout(150);

// Begin the shift, build a legal gate→ALB→EC2→RDS route, let guests flow.
const begin = await page.evaluate(async () => {
  const s = window.__rackoon.scenes.current;
  s.started = true;
  const cat = await import("./src/services/catalog.js");
  const S = cat.SERVICES;
  const [gc, gr] = s.gateKeys[0].split(",").map(Number);
  const K = (c, r) => c + "," + r;
  s.grid.place(S.alb, gc + 1, gr);
  s.grid.place(S.ec2, gc + 2, gr);
  s.grid.place(S.rds, gc + 3, gr);
  s.grid.addEdge(K(gc, gr), K(gc + 1, gr));
  s.grid.addEdge(K(gc + 1, gr), K(gc + 2, gr));
  s.grid.addEdge(K(gc + 2, gr), K(gc + 3, gr));
  s._routeDirty = true;
  return { placed: s.grid.buildings.size };
});
await page.waitForTimeout(5000); // let guests round-trip + the bill tick

const playing = await page.evaluate(() => {
  const s = window.__rackoon.scenes.current;
  return {
    started: s.started,
    routeOk: s.routeOk,
    success: s.success,
    failed: s.failed,
    budget: Math.round(s.budget),
    startBudget: s.level.budget,
    burn: +s.bill.burnRate.toFixed(2),
    billTotal: +s.bill.totalSpent.toFixed(1),
  };
});
await page.screenshot({ path: "tooling/shot-playing.png" });

await browser.close();

console.log("briefing:", JSON.stringify(briefing));
console.log("help open:", helpOpen);
console.log("begin:", JSON.stringify(begin));
console.log("playing:", JSON.stringify(playing));
console.log("ERRORS(" + errors.length + "):", errors.join("\n") || "none");

// Behaviour assertions.
const problems = [];
if (briefing.scene !== "LevelScene") problems.push("did not reach LevelScene");
if (briefing.started) problems.push("briefing did not pause the sim");
if (briefing.packets !== 0) problems.push("guests spawned during the briefing");
if (Math.abs(briefing.budget - briefing.startBudget) > 1)
  problems.push("budget drained during the briefing");
if (!helpOpen) problems.push("H help overlay did not open");
if (!playing.routeOk) problems.push("route not valid after a legal build");
if (playing.success <= 0) problems.push("no guests routed after begin");
if (playing.budget >= playing.startBudget) problems.push("bill did not draw the budget down");
if (playing.budget <= 0) problems.push("budget hit $0 within ~5s (too harsh)");
console.log("PROBLEMS(" + problems.length + "):", problems.join(" | ") || "none");

process.exit(errors.length || problems.length ? 1 : 0);
