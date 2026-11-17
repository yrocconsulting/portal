// Onboarding checklist editing and per-step assignees. Run after tests/e2e.cjs and tests/e2e-leads.cjs
// (FrigiServe: lead = member, account manager = admin). Checks ticket assignees in the local database.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const BASE = "http://127.0.0.1:3000";
const MAIL = "http://127.0.0.1:54324";
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ok = (c, m) => {
  if (!c) throw new Error("ASSERT: " + m);
  console.log("• ok:", m);
};
const sql = (q) => execSync(`psql ${DB} -tAc "${q.replace(/"/g, '\\"')}"`).toString().trim();

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on("dialog", (d) => d.accept());
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

  await page.goto(BASE + "/onboarding");
  const t = await page.textContent("main");
  ok(t.includes("Goes to: Account manager") && t.includes("Goes to: Client's lead"), "steps show who they go to (kickoff call to the account manager)");

  // Edit step 2: new title, due day, and a specific person.
  const row = page.locator("li", { hasText: "Add client to ProRankTracker" });
  await row.locator("button:has-text('Edit')").click();
  const form = page.locator("li form").first();
  await form.locator("input[name=title]").fill("Set up ProRankTracker project");
  await form.locator("input[name=due_offset_days]").fill("4");
  await form.locator("select[name=assign_to]").selectOption({ label: "admin" });
  await form.locator("button:has-text('Save step')").click();
  await page.waitForSelector("text=Set up ProRankTracker project");
  const edited = await page.locator("li", { hasText: "Set up ProRankTracker project" }).textContent();
  ok(edited.includes("Due day 4") && edited.includes("Goes to: admin"), "step edited: title, due day, specific person");

  // Add a step for whoever starts it.
  await page.locator("form", { hasText: "Add a step" }).locator("input[name=title]").fill("Welcome gift sent");
  await page.locator("form", { hasText: "Add a step" }).locator("select[name=assign_to]").selectOption("starter");
  await page.locator("form", { hasText: "Add a step" }).locator("button:has-text('Add step')").click();
  await page.waitForSelector("text=Welcome gift sent");

  // Rename the checklist.
  await page.click("button:has-text('Rename')");
  await page.fill("header input[name=name]", "AI Search onboarding");
  await page.click("header button:has-text('Save')");
  await page.waitForSelector("h2:has-text('AI Search onboarding')");
  ok(true, "checklist renamed");

  // Start onboarding for FrigiServe using each step's assignee.
  await page.goto(BASE + "/clients?q=FrigiServe");
  await page.click("tbody a >> nth=0");
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  const clientId = page.url().split("/").pop().split("#")[0];
  ok((await page.inputValue("select[name=assignee_id]")) === "", "start uses each step's assignee by default");
  const before = Number(sql(`select count(*) from tickets where client_id='${clientId}'`));
  await page.click("button:has-text('Start onboarding')");
  await page.waitForSelector("text=/Created \\d+ tickets/");
  const who = (title) => sql(`select coalesce(s.email,'unassigned') from tickets t left join staff s on s.id=t.assignee_id where t.client_id='${clientId}' and t.title='${title}' order by t.created_at desc limit 1`);
  ok(who("Kickoff call and access checklist") === "admin@yroc.test", "kickoff call went to the account manager");
  ok(who("Set up ProRankTracker project") === "admin@yroc.test", "edited step went to the specific person");
  ok(who("Baseline AI visibility audit") === "member@yroc.test", "lead steps went to the client's lead");
  ok(who("Welcome gift sent") === "admin@yroc.test", "'whoever starts' went to the person who started it");
  ok(sql(`select (due_date - current_date) from tickets where client_id='${clientId}' and title='Set up ProRankTracker project' order by created_at desc limit 1`) === "4", "due date uses the edited day");

  // Override: assign all to the member.
  await page.selectOption("select[name=assignee_id]", { label: "Assign all to member" });
  await page.click("button:has-text('Start onboarding')");
  await page.waitForTimeout(1500);
  const after = sql(`select count(distinct assignee_id) from (select assignee_id from tickets where client_id='${clientId}' order by created_at desc limit 8) x`);
  ok(after === "1" && who("Kickoff call and access checklist") === "member@yroc.test", "Assign all overrides every step");
  ok(Number(sql(`select count(*) from tickets where client_id='${clientId}'`)) - before === 16, "two runs of 8 steps");

  await browser.close();
  console.log("ONBOARDING E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
