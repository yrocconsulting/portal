// End-to-end test of the Google Search Console sync and pages, against tests/mock-google.cjs.
// Run after tests/e2e.cjs (FrigiServe Cold Storage, domain frigiserve.com, exists).
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

(async () => {
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

  await page.goto(BASE + "/search-console");
  ok((await page.textContent("main")).includes("gsc-test@yroc-portal.iam.gserviceaccount.com"), "shows the service account email to share with");
  await page.click("button:has-text('Sync now')");
  await page.waitForSelector("text=/Synced 2 properties/", { timeout: 60000 });
  ok(true, "sync ran: " + (await page.textContent("p.text-green-d")));
  await page.reload();
  const ov = await page.textContent("main");
  ok(ov.includes("FrigiServe Cold Storage") && ov.includes("sc-domain:frigiserve.com"), "domain property matched to FrigiServe");
  ok(!ov.includes("notverified.example"), "unverified properties skipped");
  ok(ov.includes("1 property isn't linked"), "unmatched property flagged");
  await page.screenshot({ path: path.join(OUT, "17-search-console.png"), fullPage: true });

  // Link the unmatched property to a client.
  await page.goto(BASE + "/clients/new");
  await page.fill("#name", "Unlinked Client");
  await page.fill("#domain", "different-site.example");
  await page.click("text=Create client");
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  await page.goto(BASE + "/search-console");
  await page.selectOption("select[name=client_id]", { label: "Unlinked Client" });
  await page.click("button:has-text('Link')");
  await page.waitForSelector("a:has-text('Unlinked Client')");
  ok(!(await page.textContent("main")).includes("isn't linked"), "linking clears the warning");

  // Client page
  await page.goto(BASE + "/clients?q=FrigiServe");
  await page.click("tbody a >> nth=0");
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  const g = await page.textContent("#google-search");
  ok(/Clicks/.test(g) && /Impressions/.test(g) && /Avg\. position/.test(g), "KPIs shown");
  ok(g.includes("▲"), "change vs previous 28 days shown");
  ok(g.includes("blast freezing fort worth") && g.includes("/blast-freezing/"), "top queries and pages shown");
  ok(await page.isVisible("#google-search svg[aria-label^='Daily clicks']"), "90 day chart shown");
  await page.locator("#google-search").screenshot({ path: path.join(OUT, "18-client-google.png") });

  // Second sync only fetches recent days (incremental) and cron runs it with the secret.
  const st1 = await fetch("http://127.0.0.1:4020/__state").then((r) => r.json());
  const cron = await fetch(`${BASE}/api/cron/daily`, { headers: { authorization: "Bearer test-cron-secret" } }).then((r) => r.json());
  ok(cron.searchConsole?.sites === 2 && cron.searchConsole.days <= 2 * 12, "daily cron syncs incrementally: " + JSON.stringify(cron.searchConsole));
  const st2 = await fetch("http://127.0.0.1:4020/__state").then((r) => r.json());
  ok(st2.queries > st1.queries, "cron called Search Console");
  ok((await fetch(`${BASE}/api/cron/daily`)).status === 401, "cron requires the secret");

  await browser.close();
  console.log("GSC E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
