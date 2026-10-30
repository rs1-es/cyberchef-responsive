"use strict";
/*
 * Smoke test for a built CyberChef Responsive site.
 *
 * Usage:
 *   npm install            # once, installs Playwright
 *   npx playwright install chromium
 *   ./cyberchef-responsive.sh --skip-deploy
 *   node tests/smoke.js cyberchef-responsive-build/CyberChef/build/prod [--title "CyberChef Responsive"]
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const ti = args.indexOf("--title");
const TITLE = ti >= 0 ? args[ti + 1] : "CyberChef Responsive";
if (!dir || !fs.existsSync(path.join(dir, "index.html"))) {
  console.error("Usage: node tests/smoke.js <build/prod directory> [--title TITLE]");
  process.exit(2);
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon",
  ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".wasm": "application/wasm", ".txt": "text/plain"
};
const root = path.resolve(dir);
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+$/, "/index.html"));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || detail === undefined ? "" : "  -> " + JSON.stringify(detail)));
}

const recipeLen = (p) => p.evaluate(() => document.querySelectorAll("#rec-list li.operation").length);
const recipeNames = (p) => p.evaluate(() => [...document.querySelectorAll("#rec-list .op-title")].map((e) => e.textContent));
const FIRST_OP = "#catFavourites li.operation";

async function open(browser, url, opts) {
  const ctx = await browser.newContext(Object.assign({ locale: "en-US" }, opts));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check("no page errors", false, e.message));
  await page.goto(url);
  await page.waitForSelector(FIRST_OP, { state: "attached", timeout: 60000 });
  await page.waitForTimeout(2500);
  return { ctx, page };
}

async function touchScroll(ctx, page, x, y0, y1) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
  for (let y = y0; y >= y1; y -= 20) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(500);
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port + "/index.html";
  const browser = await chromium.launch();

  console.log("Phone (touch, 390px wide)");
  {
    const { ctx, page } = await open(browser, url, { viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
    check("page title", (await page.title()) === TITLE, await page.title());
    check("tab bar is shown", await page.isVisible("#cc-m-tabs"));
    check("touch interaction is on", await page.evaluate(() => document.body.classList.contains("cc-touch")));

    await page.tap('.cc-m-tab[data-tab="operations"]');
    await page.waitForSelector(FIRST_OP, { state: "visible" });
    await touchScroll(ctx, page, 195, 600, 300);
    check("swiping over operations scrolls the list", (await page.evaluate(() => document.getElementById("operations").scrollTop)) > 0);
    check("swiping does not start a drag", (await page.evaluate(() => document.querySelectorAll(".sortable-chosen,.sortable-drag").length)) === 0);
    check("swiping does not add operations", (await recipeLen(page)) === 0);
    await page.evaluate(() => { document.getElementById("operations").scrollTop = 0; });

    await page.tap(FIRST_OP + " >> nth=0");
    await page.waitForTimeout(500);
    check("a single tap adds one operation", (await recipeLen(page)) === 1, await recipeLen(page));
    check("an 'Added' message is shown", /^Added: /.test(await page.evaluate(() => (document.getElementById("cc-m-toast") || {}).textContent || "")));
    check("page title follows the recipe", (await page.title()) === "To Base64 - " + TITLE, await page.title());

    const y = await page.evaluate((sel) => Math.round([...document.querySelectorAll(sel)][1].getBoundingClientRect().y + 10), FIRST_OP);
    await page.touchscreen.tap(60, y);
    await page.touchscreen.tap(60, y);
    await page.waitForTimeout(700);
    check("two quick taps add exactly two operations", (await recipeLen(page)) === 3, await recipeLen(page));

    await page.tap('.cc-m-tab[data-tab="recipe"]');
    await page.waitForTimeout(500);
    const before = await recipeNames(page);
    await page.tap("#rec-list li.operation:nth-child(1) .cc-m-op-btn[data-act=down]");
    await page.waitForTimeout(300);
    const after = await recipeNames(page);
    check("the 'move down' button reorders the recipe", after[0] === before[1] && after[1] === before[0], { before, after });
    await page.tap("#rec-list li.operation:nth-child(1) .cc-m-op-btn[data-act=del]");
    await page.waitForTimeout(300);
    check("the 'remove' button removes an operation", (await recipeLen(page)) === 2, await recipeLen(page));

    await page.tap("#support");
    await page.waitForTimeout(900);
    const about = await page.evaluate(() => document.getElementById("support-modal").textContent);
    check("About dialog says it is a modified build", /Modified build/.test(about));
    check("About dialog explains where to report problems", /Using the modified \(responsive\) version\?/.test(about));
    check("About dialog uses the new title", about.includes(TITLE + " - The Cyber Swiss Army Knife"));
    await ctx.close();
  }

  console.log("Tablet in landscape (touch, 1280px wide)");
  {
    const { ctx, page } = await open(browser, url, { viewport: { width: 1280, height: 720 }, isMobile: true, hasTouch: true });
    check("desktop layout (no tab bar)", !(await page.evaluate(() => document.body.classList.contains("cc-mobile"))));
    check("touch interaction is on", await page.evaluate(() => document.body.classList.contains("cc-touch")));
    await page.tap(FIRST_OP + " >> nth=0");
    await page.waitForTimeout(500);
    check("a single tap adds one operation", (await recipeLen(page)) === 1, await recipeLen(page));
    await touchScroll(ctx, page, 100, 560, 260);
    check("swiping over operations scrolls the list", (await page.evaluate(() => document.getElementById("operations").scrollTop)) > 0);
    await ctx.close();
  }

  console.log("Narrow desktop window (mouse, 390px wide)");
  {
    const { ctx, page } = await open(browser, url, { viewport: { width: 390, height: 780 } });
    check("tab bar is shown", await page.isVisible("#cc-m-tabs"));
    check("touch interaction is off", !(await page.evaluate(() => document.body.classList.contains("cc-touch"))));
    await page.click('.cc-m-tab[data-tab="operations"]');
    await page.waitForSelector(FIRST_OP, { state: "visible" });
    await page.click(FIRST_OP + " >> nth=0");
    await page.waitForTimeout(400);
    check("a single click does not add anything", (await recipeLen(page)) === 0, await recipeLen(page));
    await page.dblclick(FIRST_OP + " >> nth=0");
    await page.waitForTimeout(500);
    check("a double click adds one operation", (await recipeLen(page)) === 1, await recipeLen(page));
    await ctx.close();
  }

  console.log("Download dialog (desktop, mouse)");
  {
    const { ctx, page } = await open(browser, url, { viewport: { width: 1280, height: 720 } });
    check("no tab bar on desktop", (await page.locator("#cc-m-tabs").count()) === 0);
    await page.click('a[data-target="#download-modal"]');
    await page.waitForTimeout(900);
    check("download dialog says it is a modified version", /This is a modified version of CyberChef/.test(await page.locator("#download-modal").textContent()));
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log(failures ? "\n" + failures + " check(s) failed" : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
