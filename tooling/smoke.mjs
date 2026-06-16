// Dev-only smoke test for Rackoon Tycoon. NOT shipped with the game.
// Loads the game under the static server, captures console/page errors,
// drives the title->level transition, and screenshots both scenes.
import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://127.0.0.1:8000/game/game.html';
const errors = [];
const logs = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

page.on('console', (m) => {
  const t = m.type();
  logs.push(`[${t}] ${m.text()}`);
  if (t === 'error') errors.push(`console.error: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) =>
  errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText || ''}`)
);

await page.goto(URL, { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(1200); // let rAF + title animation settle
await page.screenshot({ path: 'tooling/shot-title.png' });

// Canvas UI: try common "start" affordances to reach the level scene.
await page.mouse.click(640, 400);
await page.keyboard.press('Enter');
await page.keyboard.press('Space');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'tooling/shot-level.png' });

// Exercise input a little: pan + a couple grid clicks (placement attempts).
await page.mouse.click(300, 300);
await page.mouse.click(700, 450);
await page.waitForTimeout(600);
await page.screenshot({ path: 'tooling/shot-interact.png' });

await browser.close();

console.log('--- CONSOLE LOG SAMPLE (last 15) ---');
console.log(logs.slice(-15).join('\n'));
console.log('--- ERRORS (' + errors.length + ') ---');
console.log(errors.length ? errors.join('\n') : 'none');
process.exit(errors.length ? 1 : 0);
