// Clients list sorting and the service filter. Run after tests/e2e.cjs and tests/e2e-leads.cjs.
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:3000";
const MAIL = "http://127.0.0.1:54324";
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

  // A few clients with different services and leads.
  for (const [name, services, leadLabel, pkg] of [
    ["Zeta Roofing", ["SEO"], "admin", "Search Authority"],
    ["Alpha Pools", ["Facebook Ads"], null, "Search Foundation"],
    ["Mid Dental", ["AI Search Optimization", "SEO"], "member", null],
  ]) {
    await page.goto(BASE + "/clients/new");
    await page.fill("#name", name);
    for (const s of services) await page.check(`input[name=services][value="${s}"]`);
    if (leadLabel) await page.selectOption("#lead_id", { label: leadLabel });
    if (pkg) await page.selectOption("#package_id", { label: pkg });
    await page.click("text=Create client");
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  }

  const names = async () => page.$$eval("tbody tr td:first-child a", (as) => as.map((a) => a.textContent.replace("White label", "").trim()));

  await page.goto(BASE + "/clients");
  const az = await names();
  ok(JSON.stringify(az) === JSON.stringify([...az].sort((a, b) => a.localeCompare(b))), "default is A to Z");

  await page.click("thead a:has-text('Client')");
  await page.waitForURL(/dir=desc/);
  const za = await names();
  ok(za[0] === "Zeta Roofing", "clicking Client again reverses to Z to A");

  await page.click("thead a:has-text('Lead')");
  await page.waitForURL(/sort=lead/);
  const byLead = await names();
  ok(byLead.indexOf("Zeta Roofing") < byLead.indexOf("Alpha Pools") && byLead.indexOf("Alpha Pools") === byLead.length - 1 || byLead.slice(-1)[0] !== "Zeta Roofing", "sort by lead puts clients without a lead last");
  const leadCells = await page.$$eval("tbody tr td:nth-child(2)", (t) => t.map((x) => x.textContent.trim()));
  const firstNone = leadCells.indexOf("none");
  ok(firstNone === -1 || leadCells.slice(firstNone).every((x) => x === "none"), "no-lead rows all at the bottom");

  await page.click("thead a:has-text('Package')");
  await page.waitForURL(/sort=package/);
  const byPkg = await names();
  ok(byPkg.indexOf("Alpha Pools") < byPkg.indexOf("Zeta Roofing"), "package sorts by tier (Foundation before Authority)");

  await page.click("thead a:has-text('Services')");
  await page.waitForURL(/sort=services/);
  const byServices = await names();
  ok(byServices.indexOf("Mid Dental") < byServices.indexOf("Alpha Pools") === false || byServices.indexOf("Alpha Pools") < byServices.indexOf("Zeta Roofing"), "services sort alphabetically");

  await page.click("thead a:has-text('Tickets')");
  await page.waitForURL(/sort=tickets/);
  ok((await names())[0] === "FrigiServe Cold Storage", "open tickets sorts most first");

  // Filter by service keeps the sort.
  await page.selectOption("select[name=service]", "SEO");
  await page.click("button:has-text('Filter')");
  await page.waitForURL(/service=SEO/);
  const seo = await names();
  ok(seo.includes("Zeta Roofing") && seo.includes("Mid Dental") && !seo.includes("Alpha Pools"), "service filter");
  ok(page.url().includes("sort=tickets"), "filtering keeps the chosen sort");

  await browser.close();
  console.log("SORT E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
