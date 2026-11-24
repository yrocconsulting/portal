// Ticket emails to staff: assignment and client replies, per-person switches. Run after tests/e2e.cjs with tests/mock-graph.cjs.
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

const GRAPH = "http://127.0.0.1:4010";
const sentTo = async (email) => (await fetch(`${GRAPH}/__test/state`).then((r) => r.json())).sent.filter((m) => (m.toRecipients ?? []).some((t) => t.emailAddress.address === email));
const waitFor = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
};

(async () => {
  const browser = await chromium.launch();
  const a = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await signIn(a, "admin@yroc.test");
  const member = sql("select id from staff where email='member@yroc.test'");
  const before = (await sentTo("member@yroc.test")).length;

  // 1. Admin creates a ticket for the member: an email right away, from no-reply.
  await a.goto(BASE + "/tickets/new");
  await a.fill("#title", "Update the holiday hours");
  await a.fill("#description", "Client called: closed Dec 24 to Jan 1.");
  await a.selectOption("#assignee_id", member);
  await a.selectOption("#priority", "high");
  await a.click("button:has-text('Create ticket')");
  await a.waitForURL(/\/tickets\/\d+$/);
  const n1 = a.url().split("/").pop();
  const got = await waitFor(async () => (await sentTo("member@yroc.test")).find((m) => m.subject === `New ticket for you: #${n1} Update the holiday hours`));
  ok(got, "assignee gets an email right away");
  ok(got.from === "noreply@yroc.test", "sent from the no-reply mailbox");
  ok(got.body.content.includes("admin") && got.body.content.includes("Priority: High") && got.body.content.includes("closed Dec 24") && got.body.content.includes(`/tickets/${n1}`), "email has who, priority, description and the link");
  ok(got.body.content.includes("/profile"), "email says where to change settings");

  // 2. Assigning yourself: no email.
  const adminBefore = (await sentTo("admin@yroc.test")).length;
  await a.goto(BASE + "/tickets/new");
  await a.fill("#title", "My own task");
  await a.selectOption("#assignee_id", sql("select id from staff where email='admin@yroc.test'"));
  await a.click("button:has-text('Create ticket')");
  await a.waitForURL(/\/tickets\/\d+$/);
  await a.waitForTimeout(2500);
  ok((await sentTo("admin@yroc.test")).filter((m) => m.subject.startsWith("New ticket")).length === adminBefore, "no email about your own action");

  // 3. Client reply logged on the member's ticket: an email.
  await a.goto(BASE + `/tickets/${n1}`);
  await a.check("input[name=from_client]");
  await a.fill("input[name=client_name]", "Pat Example");
  await a.fill("textarea[name=body]", "Actually we're open Dec 26.");
  await a.click("button:has-text('Comment'):not(:has-text('mark'))");
  const reply = await waitFor(async () => (await sentTo("member@yroc.test")).find((m) => m.subject === `Client reply on #${n1}: Update the holiday hours`));
  ok(reply && reply.body.content.includes("Pat Example") && reply.body.content.includes("open Dec 26"), "client reply email with the message");

  // 4. The member's own switches: turn off new-ticket emails, then nothing arrives.
  const m = await browser.newPage();
  await signIn(m, "member@yroc.test");
  await m.goto(BASE + "/profile");
  ok((await m.getAttribute("button[role=switch][aria-label='A ticket is assigned to me']", "aria-checked")) === "true", "new-ticket emails are on by default");
  ok((await m.getAttribute("button[role=switch][aria-label='A client replies on a ticket assigned to me']", "aria-checked")) === "true", "client reply emails are on by default");
  await m.click("button[role=switch][aria-label='A ticket is assigned to me']");
  await m.waitForSelector("text=Off. You won't get these emails.");
  await m.reload();
  ok((await m.getAttribute("button[role=switch][aria-label='A ticket is assigned to me']", "aria-checked")) === "false", "switch saved");
  const count = (await sentTo("member@yroc.test")).length;
  await a.goto(BASE + "/tickets/new");
  await a.fill("#title", "Should not email");
  await a.selectOption("#assignee_id", member);
  await a.click("button:has-text('Create ticket')");
  await a.waitForURL(/\/tickets\/\d+$/);
  await a.waitForTimeout(2500);
  ok((await sentTo("member@yroc.test")).length === count, "switched off: no email");
  await m.goto(BASE + "/profile");
  await m.click("button[role=switch][aria-label='A ticket is assigned to me']");
  await m.waitForSelector("text=On. You'll get these emails.");

  // 5. Several at once (like an onboarding checklist): one email listing them.
  sql(`insert into tickets (title, assignee_id) values ('Kickoff call', '${member}'), ('Set up tracking', '${member}')`);
  await a.goto(BASE + "/tickets/new");
  await a.fill("#title", "Write the welcome email");
  await a.selectOption("#assignee_id", member);
  await a.click("button:has-text('Create ticket')");
  await a.waitForURL(/\/tickets\/\d+$/);
  const group = await waitFor(async () => (await sentTo("member@yroc.test")).find((m) => m.subject === "3 new tickets for you"));
  ok(group && ["Kickoff call", "Set up tracking", "Write the welcome email"].every((t) => group.body.content.includes(t)), "several at once arrive as one email");

  // 6. Never emails anyone outside the team, and nothing is sent twice.
  const st = await fetch(`${GRAPH}/__test/state`).then((r) => r.json());
  const staff = sql("select string_agg(email, ',') from staff").split(",");
  ok(st.sent.every((x) => x.toRecipients.every((t) => staff.includes(t.emailAddress.address))), "only staff are ever emailed");
  ok(sql("select count(*) from notifications where sent_at is null") === "0", "queue is empty");
  ok((await sentTo("member@yroc.test")).filter((x) => x.subject === `New ticket for you: #${n1} Update the holiday hours`).length === 1, "no duplicates");
  console.log("member emails this run:", (await sentTo("member@yroc.test")).length - before);

  await browser.close();
  console.log("NOTIFY E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
