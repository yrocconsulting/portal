// End-to-end test of the client-facing report: publish, secret link without sign in, nothing internal
// leaks, white-label reports never mention Yroc, switch off and re-publish. Run after tests/e2e.cjs and
// tests/e2e-gsc.cjs, with PRT_INGEST_SECRET=test-prt-secret.
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

async function signIn(page, email) {
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await page.goto(BASE + "/login");
  await page.fill("input[name=email]", email);
  await page.click("text=Email me a sign in link");
  await page.waitForSelector("text=Check your inbox");
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + email)}&limit=1`).then((r) => r.json());
    if (r.messages?.[0]) {
      const m = await fetch(`${MAIL}/api/v1/message/${r.messages[0].ID}`).then((r) => r.json());
      const href = m.HTML.match(/href="([^"]+verify[^"]+)"/)?.[1];
      if (href) {
        await page.goto(href.replace(/&amp;/g, "&"));
        await page.waitForLoadState("networkidle");
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no sign in email");
}

async function setupMonth(page, clientName, { whiteLabel = false, domain } = {}) {
  if (whiteLabel) {
    await page.goto(BASE + "/clients/new");
    await page.fill("#name", clientName);
    await page.fill("#domain", domain);
    await page.check("input[name=white_label]");
    await page.fill("#partner", "Example Agency");
    await page.selectOption("#package_id", { label: "Search Foundation" });
    await page.click("text=Create client");
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  } else {
    await page.goto(BASE + "/clients?q=" + encodeURIComponent(clientName));
    await page.click("tbody a >> nth=0");
    await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
    await page.click("summary:has-text('Client details')");
    await page.selectOption("#package_id", { label: "Search Growth" });
    await page.click("button:has-text('Save changes')");
    await page.waitForSelector("text=Saved.");
  }
  await page.goto(BASE + "/reports?month=2026-11");
  await page.locator("tr", { hasText: clientName }).locator("button:has-text('Start')").click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  return page.url();
}

async function publish(page) {
  await page.click("button:has-text('Publish and get link'), button:has-text('Update published report')");
  await page.waitForSelector("text=/^(Published\. Copy the link|Updated\. The same link)/");
  await page.waitForSelector("input[readonly][value*='/r/']");
  return page.inputValue("input[readonly][value*='/r/']");
}

(async () => {
  // AI results for frigiserve.com in November (two prompts won).
  await fetch(`${BASE}/api/prt/ingest`, {
    method: "POST",
    headers: { authorization: "Bearer test-prt-secret", "content-type": "application/json" },
    body: JSON.stringify({
      report_date: "2026-11-16",
      sites: [{ domain: "frigiserve.com", appearances: 11, mentions: 6, links: 5, visibility: 90, prompts: 3, platforms: { chatgpt: 7, gemini: 4 } }],
      prompts: [
        { domain: "frigiserve.com", prompt: "Who offers blast freezing near Fort Worth?", platforms: ["chatgpt", "gemini"], appearances: 7, visibility: 100 },
        { domain: "frigiserve.com", prompt: "Best cold storage in DFW?", platforms: ["chatgpt", "gemini", "aio"], appearances: 4, visibility: 75 },
        { domain: "frigiserve.com", prompt: "Cheapest freezer rental?", platforms: [], appearances: 0, visibility: 0 },
      ],
    }),
  });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on("dialog", (d) => d.accept());
  await signIn(page, "admin@yroc.test");

  // Direct client: FrigiServe.
  const reportUrl = await setupMonth(page, "FrigiServe Cold Storage");
  await page.selectOption("select[name=action_type]", { label: "New service / landing page" });
  await page.fill("input[name=title]", "Blast freezing Fort Worth page");
  await page.fill("input[name=url]", "frigiserve.com/blast-freezing");
  await page.click("form button:has-text('Add')");
  await page.waitForSelector("text=Blast freezing Fort Worth page");
  const gbp = page.locator("li", { hasText: "Publish GBP content & media" });
  await gbp.locator("button:text-is('Done')").click();
  await page.locator("li", { hasText: "Review monthly performance" }).locator("button:text-is('Done')").click();
  await gbp.locator("button:has-text('+ Add links/notes')").click();
  await gbp.locator("textarea").nth(1).fill("INTERNAL: client was slow to send photos");
  await page.locator("li", { hasText: "Improve AI readability & on-page signals" }).locator("button:text-is('Done')").click();
  await page.fill("#wins", "Now recommended by ChatGPT and Gemini for blast freezing in DFW\nNew blast freezing page is live");
  await page.fill("#next_priorities", "Add a cold storage pricing guide.");
  await page.click("button:text-is('Save')");
  await page.waitForSelector("span:text-is('Saved.')");
  await page.click("button:has-text('Refresh results')");
  await page.waitForTimeout(1500);

  await page.fill("#client_note", "Great month, thanks for the photos!");
  const link1 = await publish(page);
  ok(/\/r\/[A-Za-z0-9_-]{32,}$/.test(link1), "published with a secret link");

  // Preview
  const pv = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await pv.context().addCookies(await page.context().cookies());
  await pv.goto(reportUrl + "/client");
  ok((await pv.textContent("body")).includes("Preview: this is what the client will see"), "staff preview works");
  await pv.close();

  // The client opens the link without signing in.
  const anon = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const c = await anon.newPage();
  await c.goto(link1);
  const body = await c.textContent("body");
  const html = await c.content();
  ok(body.includes("FrigiServe Cold Storage") && body.includes("November 2026 report"), "client sees their report without signing in");
  ok(body.includes("Now recommended by ChatGPT and Gemini") && body.includes("Great month, thanks for the photos!"), "wins and message shown");
  ok(body.includes("Blast freezing Fort Worth page") && body.includes("View it live"), "actions with links");
  ok(body.includes("Publish GBP content & media") && body.includes("Improve AI readability & on-page signals"), "completed client-facing tasks");
  ok(!body.includes("Review monthly performance"), "internal tasks (white rows) never shown, even when done");
  ok(body.includes("Who offers blast freezing near Fort Worth?") && !body.includes("Cheapest freezer rental?"), "only prompts AI recommends them for");
  ok(body.includes("Clicks from Google") && (await c.isVisible("svg[aria-label^='Daily Google clicks']")), "Google results and chart");
  ok(body.includes("Add a cold storage pricing guide."), "next month's plan");
  ok(!/INTERNAL: client was slow/.test(html), "internal item notes never shown");
  ok(!/Not done/.test(body) && !/Maintain schema & entity signals/.test(body), "unfinished items never shown");
  ok(!/admin@yroc\.test|Search Growth|\$3,750|3750/.test(html), "no staff, package name or price");
  ok(await c.isVisible("img[alt='Yroc Consulting']"), "Yroc branding for direct clients");
  await c.screenshot({ path: path.join(OUT, "22-client-report.png"), fullPage: true });
  const mob = await anon.newPage({ viewport: { width: 390, height: 844 } });
  await mob.goto(link1);
  ok((await mob.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0, "no sideways scrolling on a phone");
  await mob.screenshot({ path: path.join(OUT, "23-client-report-mobile.png"), fullPage: true });

  // Edits after publishing don't show until Update.
  await page.fill("#wins", "CHANGED AFTER PUBLISH");
  await page.click("button:text-is('Save')");
  await page.waitForSelector("span:text-is('Saved.')");
  await c.reload();
  ok(!(await c.textContent("body")).includes("CHANGED AFTER PUBLISH"), "client sees the published snapshot, not live edits");
  await page.reload();
  ok(await page.isVisible("text=has changed since it was published"), "team is told the record changed since publishing");
  const link1b = await publish(page);
  ok(link1b === link1, "update keeps the same link");
  await c.reload();
  ok((await c.textContent("body")).includes("CHANGED AFTER PUBLISH"), "update shows the latest version");
  await page.reload();
  ok(/opened [1-9]\d* time/.test(await page.textContent("main")), "views counted");

  // Turn off, then publish again: old link dead, new link works.
  await page.click("button:has-text('Turn off link')");
  await page.waitForSelector("text=Not shared");
  await c.reload();
  ok((await c.textContent("body")).includes("This report link isn't available"), "switched-off link stops working");
  const link2 = await publish(page);
  ok(link2 !== link1, "publishing again creates a new link");
  await c.goto(link1);
  ok((await c.textContent("body")).includes("isn't available"), "old link stays dead");

  // White-label client: no Yroc anywhere.
  const wlUrl = await setupMonth(page, "Partner Roofing Co", { whiteLabel: true, domain: "partner-roofing.example" });
  ok((await page.textContent("main")).includes("no Yroc name or logo"), "team is warned it's white label");
  await page.fill("#wins", "Ranked in the map pack for roof repair");
  await page.click("button:text-is('Save')");
  await page.waitForSelector("span:text-is('Saved.')");
  const wl = await publish(page);
  await c.goto(wl);
  const wlHtml = await c.content();
  ok((await c.textContent("body")).includes("Partner Roofing Co") && (await c.textContent("body")).includes("Ranked in the map pack"), "white-label report renders");
  ok(!/yroc/i.test(wlHtml), "white-label report has no 'Yroc' anywhere in the page source");
  ok(!/yroc/i.test(await c.title()), "white-label tab title has no Yroc");
  await c.screenshot({ path: path.join(OUT, "24-client-report-whitelabel.png"), fullPage: true });

  // Garbage tokens.
  await c.goto(BASE + "/r/not-a-real-token-but-long-enough-to-check-it-1234");
  ok((await c.textContent("body")).includes("isn't available"), "unknown token shows not available");

  await browser.close();
  console.log("CLIENT REPORT E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
