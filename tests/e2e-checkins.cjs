// Gentle check-in reminders: one bubble at a time, at most once a day, snooze, reset by real contact.
// Run after tests/e2e.cjs. Moves dates in the local database to simulate days passing.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const BASE = "http://127.0.0.1:3000";
const MAIL = "http://127.0.0.1:54324";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ok = (c, m) => {
  if (!c) throw new Error("ASSERT: " + m);
  console.log("• ok:", m);
};
const sql = (q) => execSync(`psql ${DB} -qtAc "${q.replace(/"/g, '\\"')}"`).toString().trim();

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

const bubbles = (page) => page.locator("[role=dialog][aria-label^='Check in with']");

(async () => {
  const browser = await chromium.launch();
  const m = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await signIn(m, "member@yroc.test");
  const a = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await signIn(a, "admin@yroc.test");

  // Three clients managed by admin, added long ago; one more with reminders off.
  const admin = sql("select id from staff where email='admin@yroc.test'");
  const mk = (name, daysAgo, cadence) =>
    sql(`insert into clients (name, status, account_manager_id, checkin_days, created_at) values ('${name}', 'active', '${admin}', ${cadence}, now() - interval '${daysAgo} days') returning id`);
  const oldest = mk("Oldest Client", 120, 30);
  const middle = mk("Middle Client", 60, 30);
  const recent = mk("Recent Client", 10, 30);
  mk("Quiet Client", 200, "null");

  await a.goto(BASE + "/");
  ok((await bubbles(a).count()) === 1, "only one reminder bubble at a time");
  ok((await bubbles(a).first().getAttribute("aria-label")) === "Check in with Oldest Client", "it's for the most overdue client");
  ok(!(await a.textContent("main")).includes("Check in with Quiet Client"), "reminders off: never asked");
  await a.screenshot({ path: (process.argv[2] || "/tmp") + "/29-checkin.png", fullPage: true });

  // Members who aren't the account manager never see it.
  await m.goto(BASE + "/");
  ok((await bubbles(m).count()) === 0, "only the account manager is asked");

  // Thumbs down: snoozed, and nothing else today.
  await bubbles(a).locator("button:has-text('Not yet')").click();
  await a.waitForSelector("text=I'll ask again in a few days");
  await a.goto(BASE + "/");
  ok((await bubbles(a).count()) === 0, "after answering, no more reminders today");

  // Next day: the snoozed client stays quiet; the next most overdue shows.
  sql(`update client_touchpoints set created_at = created_at - interval '1 day' where staff_id='${admin}' and via_nudge`);
  await a.goto(BASE + "/");
  ok((await bubbles(a).first().getAttribute("aria-label")) === "Check in with Middle Client", "next day: the next client, the snoozed one waits");
  await bubbles(a).locator("button:has-text('Yes')").click();
  await a.waitForSelector("text=Thanks! Noted.");
  ok(sql(`select count(*) from client_touchpoints where client_id='${middle}' and kind='checkin'`) === "1", "thumbs up records a check-in");

  // Three days after the snooze it comes back.
  sql(`update client_touchpoints set created_at = created_at - interval '3 days', until = until - 3 where staff_id='${admin}' and via_nudge`);
  await a.goto(BASE + "/");
  ok((await bubbles(a).first().getAttribute("aria-label")) === "Check in with Oldest Client", "snoozed client returns after a few days");

  // Real contact resets the clock: log a client message on a ticket for Oldest Client.
  await a.goto(BASE + `/tickets/new?client=${oldest}`);
  await a.fill("#title", "Question from client");
  await a.click("button:has-text('Create ticket')");
  await a.waitForURL(/\/tickets\/\d+$/);
  await a.check("input[name=from_client]");
  await a.fill("textarea[name=body]", "Called to ask about their report.");
  await a.click("button:has-text('Comment'):not(:has-text('mark'))");
  await a.waitForSelector("text=Called to ask about their report.");
  sql(`update client_touchpoints set created_at = created_at - interval '2 days' where staff_id='${admin}' and via_nudge`);
  await a.goto(BASE + "/");
  ok((await bubbles(a).count()) === 0, "a logged client call resets the clock (nothing left that's due)");
  ok((await a.locator("li", { has: a.locator(`a[href="/clients/${oldest}"]`) }).last().textContent()).includes("last contact today"), "dashboard shows last contact");

  // Recent client was added 10 days ago: not due.
  ok(!(await a.textContent("main")).includes("Check in with Recent Client"), "new clients aren't flagged early");

  // Client page: last contact and Log a check-in.
  await a.goto(BASE + `/clients/${recent}`);
  ok((await a.textContent("main")).includes("No contact logged"), "client page shows no contact yet");
  await a.click("button:has-text('Log a check-in')");
  await a.waitForSelector("text=Check-in logged");
  await a.reload();
  ok((await a.textContent("main")).includes("Last contact today"), "logging a check-in from the client page");

  await browser.close();
  console.log("CHECKINS E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
