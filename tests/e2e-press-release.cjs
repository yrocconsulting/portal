// Press release reminders for leads: after the 15th, PR task empty on this month's report.
// Run after tests/e2e.cjs on a day of the month from the 16th on. Moves dates to simulate days passing.
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

const bubbles = (page) => page.locator("[role=dialog][aria-label^='Press release for']");

(async () => {
  if (new Date().toLocaleString("en-CA", { timeZone: "America/Chicago", day: "numeric" }) < 16) {
    console.log("PR E2E SKIPPED (runs from the 16th of the month)");
    return;
  }
  const browser = await chromium.launch();
  const m = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await signIn(m, "member@yroc.test");
  const a = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await signIn(a, "admin@yroc.test");

  const member = sql("select id from staff where email='member@yroc.test'");
  const admin = sql("select id from staff where email='admin@yroc.test'");
  const pkg = (n) => sql(`select id from packages where name='${n}'`);
  const mk = (name, p) =>
    sql(`insert into clients (name, status, lead_id, account_manager_id, package_id, checkin_days) values ('${name}', 'active', '${member}', '${admin}', '${p}', null) returning id`);
  const growth = mk("Alpha PR Client", pkg("Search Growth"));
  const linked = mk("Beta PR Client", pkg("Search Authority"));
  const gamma = mk("Gamma Foundation Client", pkg("Search Foundation"));
  ok(sql(`select count(*) from package_items where package_id='${pkg("Search Foundation")}' and name ilike '%distribute pr%'`) === "1", "Foundation package includes the PR task");

  // Beta already has a link on its PR task: never asked.
  const month = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }).slice(0, 7) + "-01";
  sql(`insert into monthly_reports (client_id, month, package_id) values ('${linked}', '${month}', '${pkg("Search Authority")}')`);
  sql(`insert into monthly_reports (client_id, month, package_id) values ('${gamma}', '${month}', '${pkg("Search Foundation")}')`);
  sql(`insert into report_items (report_id, section, name, status) select r.id, 'AI Visibility & Authority', 'Create / distribute PR when included', 'na' from monthly_reports r where r.client_id='${gamma}'`);
  sql(`insert into report_items (report_id, section, name, links) select r.id, 'Off-page', 'Create / distribute PR when included', array['https://news.example.com/pr'] from monthly_reports r where r.client_id='${linked}'`);

  await m.goto(BASE + "/");
  ok((await bubbles(m).count()) === 1, "one press release reminder for the lead");
  ok((await bubbles(m).first().getAttribute("aria-label")) === "Press release for Alpha PR Client", "for the client with nothing on the PR task");
  await m.screenshot({ path: (process.argv[2] || "/tmp") + "/30-press-release.png" });
  await a.goto(BASE + "/");
  ok((await bubbles(a).count()) === 0, "the account manager isn't asked about press releases");

  // Not yet: quiet for a couple of days, and nothing else today.
  await bubbles(m).locator("button:has-text('Not yet')").click();
  await m.waitForSelector("text=I'll ask again in a couple of days");
  await m.goto(BASE + "/");
  ok((await m.locator("[role=dialog]").count()) === 0, "after answering, no more reminders today");
  sql(`update nudge_answers set created_at = created_at - interval '1 day' where staff_id='${member}'`);
  await m.goto(BASE + "/");
  ok((await bubbles(m).count()) === 0, "next day: still snoozed");
  sql(`update nudge_answers set created_at = created_at - interval '1 day', until = until - 2 where staff_id='${member}'`);
  await m.goto(BASE + "/");
  ok((await bubbles(m).count()) === 1, "asks again after a couple of days");
  ok((await m.locator("li", { has: m.locator(`a[href="/clients/${growth}"]`) }).last().textContent()).includes("press release not yet"), "card shows press release not yet");

  // Submitted: starts the report and ticks the PR task.
  await bubbles(m).locator("button:has-text('Submitted')").click();
  await m.waitForSelector("text=Ticked on this month's report");
  ok(sql(`select ri.status from report_items ri join monthly_reports r on r.id=ri.report_id where r.client_id='${growth}' and ri.name ilike '%distribute pr%'`) === "done", "PR task ticked on the report");
  sql(`update nudge_answers set created_at = created_at - interval '1 day' where staff_id='${member}'`);
  await m.goto(BASE + "/");
  ok((await bubbles(m).count()) === 0, "nothing left to ask about (Gamma's PR is N/A this month)");
  ok((await m.locator("li", { has: m.locator(`a[href="/clients/${growth}"]`) }).last().textContent()).includes("press release in"), "card shows press release in");

  await browser.close();
  console.log("PR E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
