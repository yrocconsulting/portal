// End-to-end test of weekly AI visibility results: ingest endpoint, linking a domain, client page.
// Run after tests/e2e.cjs (FrigiServe Cold Storage with domain frigiserve.com exists) with
// PRT_INGEST_SECRET=test-prt-secret in .env.local. Uses made-up numbers.
const { chromium } = require("playwright");
const os = require("os");
const path = require("path");
const BASE = "http://127.0.0.1:3000";
const MAIL = "http://127.0.0.1:54324";
const OUT = process.argv[2] || os.tmpdir();
const ok = (c, m) => {
  if (!c) throw new Error("ASSERT: " + m);
  console.log("• ok:", m);
};

const week = (date, frigiVis, frigiApp, prompts) => ({
  report_date: date,
  sites: [
    { domain: "frigiserve.com", appearances: frigiApp, mentions: 6, links: 5, visibility: frigiVis, prompts: 2, platforms: { aio: 0, ai_mode: 0, chatgpt: frigiApp - 4, copilot: 0, gemini: 4, perplexity: 0 } },
    { domain: "otherclient.example", appearances: 7, mentions: 4, links: 3, visibility: 40, prompts: 1, platforms: { aio: 3, ai_mode: 0, chatgpt: 4, copilot: 0, gemini: 0, perplexity: 0 } },
  ],
  prompts,
});

const post = (body, secret = "test-prt-secret") =>
  fetch(`${BASE}/api/prt/ingest`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body) });

(async () => {
  ok((await post({ report_date: "2026-11-09", sites: [] }, "wrong")).status === 401, "ingest rejects a wrong secret");
  ok((await post({ report_date: "nope", sites: [] })).status === 400, "ingest rejects a bad date");

  let r = await post(
    week("2026-11-09", 60, 8, [
      { domain: "frigiserve.com", prompt: "Who offers blast freezing near Fort Worth?", platforms: ["chatgpt"], appearances: 5, visibility: 50 },
      { domain: "frigiserve.com", prompt: "Best cold storage in DFW?", platforms: ["chatgpt", "gemini"], appearances: 3, visibility: 100 },
    ]),
  );
  ok(r.status === 200, "week 1 ingested");
  r = await post(
    week("2026-11-16", 90, 11, [
      { domain: "frigiserve.com", prompt: "Who offers blast freezing near Fort Worth?", platforms: ["chatgpt", "gemini"], appearances: 7, visibility: 100 },
      { domain: "frigiserve.com", prompt: "Best cold storage in DFW?", platforms: ["chatgpt", "gemini"], appearances: 4, visibility: 100 },
      { domain: "otherclient.example", prompt: "Who is best?", platforms: ["aio", "chatgpt"], appearances: 7, visibility: 40 },
    ]),
  );
  const j = await r.json();
  ok(j.sites === 2 && j.prompts === 3, "week 2 ingested: " + JSON.stringify(j));
  ok((await post(week("2026-11-16", 90, 11, []))).status === 200, "re-sending a week replaces it");
  await post(
    week("2026-11-16", 90, 11, [
      { domain: "frigiserve.com", prompt: "Who offers blast freezing near Fort Worth?", platforms: ["chatgpt", "gemini"], appearances: 7, visibility: 100 },
      { domain: "frigiserve.com", prompt: "Best cold storage in DFW?", platforms: ["chatgpt", "gemini"], appearances: 4, visibility: 100 },
      { domain: "otherclient.example", prompt: "Who is best?", platforms: ["aio", "chatgpt"], appearances: 7, visibility: 40 },
    ]),
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await page.goto(BASE + "/login");
  await page.fill("input[name=email]", "admin@yroc.test");
  await page.click("text=Email me a sign in link");
  await page.waitForSelector("text=Check your inbox");
  await new Promise((r) => setTimeout(r, 1500));
  const list = await fetch(`${MAIL}/api/v1/messages?limit=1`).then((r) => r.json());
  const msg = await fetch(`${MAIL}/api/v1/message/${list.messages[0].ID}`).then((r) => r.json());
  await page.goto(msg.HTML.match(/href="([^"]+verify[^"]+)"/)[1].replace(/&amp;/g, "&"));
  await page.waitForLoadState("networkidle");

  // Overview
  await page.goto(BASE + "/visibility");
  const ov = await page.textContent("main");
  ok(ov.includes("FrigiServe Cold Storage") && ov.includes("90%") && ov.includes("▲30"), "overview links frigiserve.com and shows the change");
  ok(ov.includes("1 tracked site isn't linked"), "unlinked domain flagged");
  await page.screenshot({ path: path.join(OUT, "13-visibility.png"), fullPage: true });

  // Link otherclient.example to a new client
  await page.goto(BASE + "/clients/new");
  await page.fill("#name", "Other Client Co");
  await page.fill("#domain", "otherclient-website.example");
  await page.click("text=Create client");
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  await page.goto(BASE + "/visibility");
  await page.selectOption("select[name=client_id]", { label: "Other Client Co" });
  await page.click("button:has-text('Link')");
  await page.waitForSelector("text=Other Client Co");
  ok(!(await page.textContent("main")).includes("isn't linked"), "linking sets the tracked domain");

  // Client page
  await page.goto(BASE + "/clients?q=FrigiServe");
  ok((await page.textContent("tbody")).includes("90%"), "clients list shows latest visibility");
  await page.click("tbody a >> nth=0");
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  const cp = await page.textContent("#ai-visibility");
  ok(cp.includes("90%") && cp.includes("▲ 30 pts") && cp.includes("▲ 3"), "KPIs with week-over-week change");
  ok(cp.includes("Who offers blast freezing near Fort Worth?") && cp.includes("▲50"), "prompt table with change");
  ok(await page.isVisible("#ai-visibility svg[aria-label='Weekly appearances trend']"), "trend chart shown with 2 weeks");
  await page.locator("#ai-visibility").screenshot({ path: path.join(OUT, "14-client-visibility.png") });

  await page.goto(BASE + "/clients?q=Other+Client");
  await page.click("tbody a >> nth=0");
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  ok((await page.textContent("#ai-visibility")).includes("40%"), "linked client shows results from its tracked domain");

  await browser.close();
  console.log("VISIBILITY E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
