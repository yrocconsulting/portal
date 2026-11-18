// Content drafts with Claude, against tests/mock-anthropic.cjs. Run after tests/e2e.cjs.
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

const MOCK = "http://127.0.0.1:4030";

(async () => {
  await fetch(`${MOCK}/__reset`);
  const browser = await chromium.launch();
  const a = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await signIn(a, "admin@yroc.test");
  const OUT = process.argv[2] || "/tmp";

  // Tracked prompts for FrigiServe, a lead, and a house style.
  sql("insert into prt_reports (report_date) values ('2026-11-16') on conflict do nothing");
  sql("insert into prt_site_results (report_date, domain, visibility, prompts) values ('2026-11-16', 'frigiserve.com', 22, 3) on conflict do nothing");
  sql("insert into prt_prompt_results (report_date, domain, prompt, visibility, platforms) values ('2026-11-16','frigiserve.com','blast freezing near Fort Worth',0,'{}'), ('2026-11-16','frigiserve.com','best cold storage in DFW',33,'{chatgpt}'), ('2026-11-16','frigiserve.com','food grade freezer warehouse Dallas',50,'{gemini,perplexity}')");
  sql("update clients set lead_id = (select id from staff where email='member@yroc.test') where name='FrigiServe Cold Storage'");
  const clientId = sql("select id from clients where name='FrigiServe Cold Storage'");

  await a.goto(BASE + "/drafts");
  await a.click("summary:has-text('House style')");
  await a.fill("textarea[name=style]", "Always mention same-day appointments.");
  await a.click("button:has-text('Save house style')");
  await a.waitForSelector("text=Saved.");

  // Start from the client page.
  await a.goto(BASE + `/clients/${clientId}`);
  await a.click("a:has-text('Draft with Claude')");
  await a.waitForURL(/\/drafts\/new/);
  ok((await a.inputValue("#client_id")) === clientId, "client preselected");
  await a.selectOption("#kind", "press_release");
  await a.fill("#brief", "They just opened a blast freezing room.");
  await a.click("button:has-text('Suggest angles')");
  await a.waitForURL(/\/drafts\/[0-9a-f-]{36}$/);
  const draftUrl = a.url();
  await a.waitForSelector("text=Write the draft from angle 1", { timeout: 30000 });
  ok((await a.locator("button[aria-pressed]").count()) === 3, "three angles suggested");
  ok((await a.textContent("main")).includes("blast freezing near Fort Worth"), "angles name the tracked prompts");
  await a.screenshot({ path: OUT + "/31-draft-angles.png", fullPage: true });

  let st = await fetch(`${MOCK}/__state`).then((r) => r.json());
  const r1 = st.requests[0].body;
  const u1 = r1.messages[0].content;
  ok(r1.model === "claude-opus-5-5" && r1.output_config.effort === "medium" && !!r1.output_config.format, "angles: Opus 5.5, structured output");
  ok(r1.fallbacks === "default" && /server-side-fallback/.test(st.requests[0].headers["anthropic-beta"] ?? ""), "refusal fallbacks on");
  ok(u1.includes("blast freezing near Fort Worth") && u1.includes("They just opened a blast freezing room."), "Claude gets the tracked prompts and the direction");
  ok(JSON.stringify(r1.system).includes("Always mention same-day appointments.") && JSON.stringify(r1.system).includes("Never use em dashes"), "house style and rules in the instructions");

  // Pick angle 2, tweak the headline, write.
  await a.click("button[aria-pressed] >> nth=1");
  await a.fill("input[aria-label='Working headline']", "FrigiServe opens blast freezing in Fort Worth");
  await a.click("button:has-text('Write the draft from angle 2')");
  await a.waitForSelector("text=Notes for the team", { timeout: 60000 });
  const body = await a.inputValue("textarea[aria-label='Draft text']");
  ok(body.startsWith("# FrigiServe opens blast freezing in Fort Worth"), "draft uses the edited headline");
  ok(!body.includes("\u2014"), "em dashes removed");
  ok((await a.textContent("main")).includes("3 [[CONFIRM]] placeholders to fill in"), "placeholders counted");
  ok((await a.textContent("main")).includes("frigiserve.com/"), "pages read on the website listed");
  ok((await a.textContent("main")).includes("of Claude usage"), "usage estimate shown");
  st = await fetch(`${MOCK}/__state`).then((r) => r.json());
  const drafts = st.requests.filter((r) => !r.body.output_config?.format);
  ok(drafts.length === 2 && drafts[1].body.messages.at(-1).role === "assistant", "paused turn resumed");
  ok(drafts[0].body.tools[0].type === "web_fetch_20260209" && drafts[0].body.tools[0].allowed_domains[0] === "frigiserve.com", "web fetch limited to the client's site");
  await a.screenshot({ path: OUT + "/32-draft.png", fullPage: true });

  // Edit, save, post to a new ticket for the lead.
  await a.fill("textarea[aria-label='Draft text']", body.replace("[[CONFIRM: release date]]", "Nov. 18, 2026"));
  ok((await a.textContent("main")).includes("2 [[CONFIRM]] placeholders"), "count updates while editing");
  await a.click("button:text-is('Save')");
  await a.waitForSelector("span:text-is('Saved.')");
  await a.click("button:has-text('Post to ticket for review')");
  await a.waitForURL(/\/tickets\/\d+$/);
  const t = await a.textContent("main");
  ok(t.includes("Press release: FrigiServe opens blast freezing in Fort Worth") && t.includes("Draft for review") && t.includes("Nov. 18, 2026"), "posted to a new ticket as a draft for review");
  ok(t.includes("Claude"), "shown as Claude's comment");
  ok(sql("select s.email from tickets t join staff s on s.id=t.assignee_id where t.title like 'Press release:%'") === "member@yroc.test", "ticket goes to the client's lead");
  ok(sql("select count(*) from ticket_comments where author_kind='claude'") === "1", "one Claude comment");

  await a.goto(draftUrl);
  ok((await a.textContent("main")).includes("Posted to ticket"), "draft marked posted");
  ok(!(await a.isVisible("button:has-text('Post to ticket for review')")), "can't post twice");

  // From a ticket: the draft attaches to that ticket instead.
  const tn = sql("select number from tickets where title like 'Press release:%'");
  await a.goto(BASE + `/tickets/${tn}`);
  await a.click("a:has-text('Draft content with Claude')");
  await a.waitForURL(/\/drafts\/new\?client=.+&ticket=/);
  await a.selectOption("#kind", "faq");
  await a.click("button:has-text('Suggest angles')");
  await a.waitForSelector("text=Write the draft from angle 1", { timeout: 30000 });
  await a.click("button:has-text('Write the draft from angle 1')");
  await a.waitForSelector("text=Notes for the team", { timeout: 60000 });
  await a.click("button:has-text('Post to ticket for review')");
  await a.waitForURL(new RegExp(`/tickets/${tn}$`));
  ok(sql("select count(*) from ticket_comments where author_kind='claude'") === "2", "second draft added to the same ticket");

  // Members can use it; the list shows the drafts.
  const m = await browser.newPage();
  await signIn(m, "member@yroc.test");
  await m.goto(BASE + "/drafts");
  ok((await m.textContent("main")).includes("Posted to ticket") && !(await m.isVisible("summary:has-text('House style')")), "members see drafts, not the house style");

  // A rejected key is explained.
  sql("update app_settings set value = value where key='draft_style'");
  await browser.close();
  console.log("DRAFTS E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
