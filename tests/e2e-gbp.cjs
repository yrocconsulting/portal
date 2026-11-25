// Google Business Profile: connect through Google sign-in (tests/mock-gbp.cjs), first sync, matching
// profiles to clients, the client page card, new-review emails (not on the first import), the report
// section. Run after tests/e2e.cjs (FrigiServe Cold Storage, frigiserve.com) with tests/mock-graph.cjs.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const BASE = "http://127.0.0.1:3000";
const MAIL = "http://127.0.0.1:54324";
const GBP = "http://127.0.0.1:4040";
const GRAPH = "http://127.0.0.1:4010";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ok = (c, m) => {
  if (!c) throw new Error("ASSERT: " + m);
  console.log("• ok:", m);
};
const sql = (q) => execSync(`psql ${DB} -qtAc "${q.replace(/"/g, '\\"')}"`).toString().trim();
const waitFor = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
};
const sentTo = async (email) => (await fetch(`${GRAPH}/__test/state`).then((r) => r.json())).sent.filter((m) => (m.toRecipients ?? []).some((t) => t.emailAddress.address === email));

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

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const frigi = sql("select id from clients where name='FrigiServe Cold Storage'");
  const member = sql("select id from staff where email='member@yroc.test'");
  sql(`update clients set lead_id='${member}', package_id=coalesce(package_id, (select id from packages where name='Search Growth')) where id='${frigi}'`);

  // 1. Members can see the page but not connect.
  await signIn(page, "member@yroc.test");
  await page.goto(BASE + "/business-profiles");
  ok(await page.isVisible("text=An admin needs to connect the Google account."), "starts not connected");
  ok(!(await page.isVisible("a:has-text('Connect Google account')")), "only admins see Connect");

  // 2. Admin connects: Google sign-in, back to the portal, first sync runs.
  await signIn(page, "admin@yroc.test");
  await page.goto(BASE + "/business-profiles");
  await page.click("a:has-text('Connect Google account')");
  await page.waitForURL(/\/business-profiles\?connected=1/);
  ok(await page.isVisible("text=Connected. The first sync runs now"), "connected message");
  ok(await waitFor(() => sql("select count(*) from gbp_locations where last_synced_at is not null") === "2"), "first sync stored both profiles");
  const setting = sql("select value::text from app_settings where key='gbp_oauth'");
  ok(!setting.includes("rt-test") && setting.includes("refresh_enc"), "refresh token stored encrypted, never in plain text");
  ok(sql(`select client_id from gbp_locations where name='locations/1'`) === frigi, "FrigiServe matched by its website domain");
  ok(sql(`select coalesce(client_id::text,'none') from gbp_locations where name='locations/2'`) === "none", "a profile with no matching client stays unmatched");
  ok(Number(sql("select count(*) from gbp_daily where location='locations/1'")) > 500, "first sync pulls about 18 months of daily numbers");
  ok(sql("select count(*) from gbp_keywords where location='locations/1' and below") !== "0", "search terms stored, with Google's 'fewer than' values");
  ok(sql("select count(*) from gbp_reviews") === "4", "reviews stored");
  ok(sql("select count(*) from notifications where kind='new_review'") === "0", "no review emails for the first import");
  await page.reload();
  ok(await page.isVisible("text=Connected as yroc.manager@gmail.test"), "shows which Google account is connected");
  ok(await page.isVisible("tr:has-text('FrigiServe Cold Storage') >> text=Fort Worth"), "profiles table lists the address");

  // 3. Admin assigns the unmatched profile; a sync keeps the admin's choice.
  await page.locator("tr", { hasText: "Corner Bakery Test" }).locator("select[aria-label='Client for this profile']").selectOption(frigi);
  ok(await waitFor(() => sql("select matched_by from gbp_locations where name='locations/2'") === "admin"), "admin choice saved");
  await page.click("button:has-text('Sync now')");
  await page.waitForSelector("text=/Synced 2 profiles/");
  ok(sql("select client_id from gbp_locations where name='locations/2'") === frigi && sql("select matched_by from gbp_locations where name='locations/2'") === "admin", "sync keeps the admin's choice");
  await page.locator("tr", { hasText: "Corner Bakery Test" }).locator("select[aria-label='Client for this profile']").selectOption("");
  ok(await waitFor(() => sql("select coalesce(client_id::text,'none') from gbp_locations where name='locations/2'") === "none"), "set back to not a client");

  // 4. Client page card.
  await page.goto(BASE + `/clients/${frigi}`);
  const card = page.locator("#business-profile");
  ok(await card.isVisible(), "client page shows the Business Profile card");
  const cardText = await card.innerText();
  ok(cardText.includes("Calls") && cardText.includes("Direction requests") && cardText.includes("Google rating"), "card has the main numbers");
  ok(cardText.includes("Lee M") && !cardText.includes("Dana K"), "reviews waiting for a reply, replied ones left out");
  ok(cardText.includes("cold storage fort worth") && cardText.includes("under 15"), "top search terms");

  // 5. A new review: the next sync (daily cron) emails the client's lead.
  await fetch(`${GBP}/__test/review`, { method: "POST", body: JSON.stringify({ id: "new1", reviewer: "Chris P", stars: "TWO", comment: "Waited an hour at the dock." }) });
  const before = (await sentTo("member@yroc.test")).length;
  const cron = await fetch(`${BASE}/api/cron/daily`, { headers: { authorization: "Bearer test-cron-secret" } }).then((r) => r.json());
  ok(cron.businessProfiles?.locations === 2 && cron.businessProfiles.newReviews === 1, "cron syncs and finds the new review: " + JSON.stringify(cron.businessProfiles));
  ok(cron.businessProfiles.days < 2 * 20, "later syncs only fetch recent days");
  const mail = await waitFor(async () => (await sentTo("member@yroc.test")).slice(before).find((m) => m.subject === "New 2-star Google review for FrigiServe Cold Storage"));
  ok(mail && mail.body.content.includes("Chris P") && mail.body.content.includes("Waited an hour") && mail.body.content.includes(`/clients/${frigi}`), "lead gets the review email with the text and a link");
  await fetch(`${BASE}/api/cron/daily`, { headers: { authorization: "Bearer test-cron-secret" } });
  await new Promise((r) => setTimeout(r, 1500));
  ok((await sentTo("member@yroc.test")).filter((m) => m.subject.includes("Google review")).length === 1, "the same review is never emailed twice");

  // 6. The member's switch for review emails.
  const m = await browser.newPage();
  await signIn(m, "member@yroc.test");
  await m.goto(BASE + "/profile");
  ok((await m.getAttribute("button[role=switch][aria-label='A client I manage or lead gets a new Google review']", "aria-checked")) === "true", "review emails are on by default");

  // 7. Monthly report: Business Profile numbers in the results and on the client report.
  await page.goto(BASE + "/reports?month=2026-11");
  const row = page.locator("tr", { hasText: "FrigiServe Cold Storage" });
  if (await row.locator("button:has-text('Start')").count()) {
    await row.locator("button:has-text('Start')").click();
    await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  } else {
    await page.goto(BASE + "/reports/" + sql(`select id from monthly_reports where client_id='${frigi}' and month='2026-11-01'`));
  }
  await page.click("button:has-text('Refresh results')");
  await page.waitForSelector("text=Maps calls");
  ok(await page.isVisible("text=Business Profile: data through"), "results card shows Business Profile numbers");
  const results = JSON.parse(sql(`select results::text from monthly_reports where client_id='${frigi}' and month='2026-11-01'`));
  ok(results.gbp && results.gbp.month.calls > results.gbp.previous.calls && results.gbp.partial_days, "month totals compared with the same days last month: " + JSON.stringify(results.gbp.month));
  await page.click("[data-design] > summary");
  ok(await page.isVisible("#gbp_display") && (await page.isVisible("text=Showing on the report.")), "design section has the Business Profile setting (auto: showing)");
  await page.click("button:has-text('Publish and get link'), button:has-text('Update published report')");
  await page.waitForSelector("input[readonly][value*='/r/']");
  const link = await page.inputValue("input[readonly][value*='/r/']");
  const anon = await browser.newPage();
  await anon.goto(link);
  const pub = await anon.locator("[data-gbp]").innerText();
  ok(pub.includes("Calls from your profile") && pub.includes("Direction requests") && /stars from \d+ Google reviews/.test(pub), "client report has the Google Maps section");
  const html = await anon.content();
  ok(!html.includes("Chris P") && !html.includes("Waited an hour"), "review names and text never reach the client report");

  // Hide it, republish: gone.
  await page.selectOption("#gbp_display", "hide");
  await page.click("button:has-text('Save headline and settings')");
  await page.waitForSelector("[data-design] >> text=Saved.");
  await page.click("button:has-text('Update published report')");
  await page.waitForSelector("text=/^Updated\\. The same link/");
  await anon.reload();
  ok((await anon.locator("[data-gbp]").count()) === 0, "hidden when the team says so");

  // 8. Disconnect.
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/business-profiles");
  await page.click("button:has-text('Disconnect')");
  await page.waitForSelector("text=Not connected");
  ok(sql("select count(*) from app_settings where key='gbp_oauth'") === "0", "disconnect removes the stored connection");
  ok(sql("select count(*) from gbp_locations") === "2", "synced data stays");

  await browser.close();
  console.log("\nGoogle Business Profile e2e passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
