// Client lead and account manager: set on the client, "My clients" filters, new tickets default to the lead.
// Run after tests/e2e.cjs (FrigiServe Cold Storage, admin@yroc.test, member@yroc.test exist).
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:3000";
const MAIL = "http://127.0.0.1:54324";
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

(async () => {
  const browser = await chromium.launch();
  const m = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await signIn(m, "member@yroc.test"); // creates the member's staff row
  const a = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await signIn(a, "admin@yroc.test");

  // Admin makes the member FrigiServe's lead and themselves the account manager.
  await a.goto(BASE + "/clients?q=FrigiServe");
  await a.click("tbody a >> nth=0");
  await a.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  const clientId = a.url().split("/").pop().split("#")[0];
  await a.click("summary:has-text('Client details')");
  await a.selectOption("#lead_id", { label: "member" });
  await a.selectOption("#account_manager_id", { label: "admin" });
  await a.click("button:has-text('Save changes')");
  await a.waitForSelector("text=Saved.");
  await a.reload();
  const head = await a.textContent("main");
  ok(head.includes("Lead: member") && head.includes("Account manager: admin"), "lead and account manager shown on the client");

  // Clients list: Lead column and My clients.
  await a.goto(BASE + "/clients");
  ok((await a.locator("tr", { hasText: "FrigiServe" }).textContent()).includes("member"), "lead column on the clients list");
  await a.goto(BASE + "/clients?lead=me");
  ok(!(await a.textContent("main")).includes("FrigiServe"), "admin's My clients excludes FrigiServe");
  await m.goto(BASE + "/clients?lead=me");
  ok((await m.textContent("main")).includes("FrigiServe"), "member's My clients includes FrigiServe");

  // New ticket defaults to the lead; a manual choice sticks when the client changes.
  await a.goto(BASE + `/tickets/new?client=${clientId}`);
  const memberId = await a.$eval("#assignee_id", (s) => [...s.options].find((o) => o.text === "member").value);
  ok((await a.inputValue("#assignee_id")) === memberId, "new ticket for the client defaults to its lead");
  await a.selectOption("#client_id", "");
  ok((await a.inputValue("#assignee_id")) !== memberId, "no client: back to me");
  await a.selectOption("#client_id", clientId);
  await a.selectOption("#assignee_id", { label: "admin" });
  await a.selectOption("#client_id", "");
  await a.selectOption("#client_id", clientId);
  ok((await a.$eval("#assignee_id", (s) => s.options[s.selectedIndex].text)) === "admin", "a hand-picked assignee isn't overwritten");

  // Monthly reports: Only my clients.
  await m.goto(BASE + "/reports?month=2026-11&mine=1");
  ok((await m.textContent("main")).includes("FrigiServe"), "member's reports list includes their client");
  await a.goto(BASE + "/reports?month=2026-11&mine=1");
  ok(!(await a.textContent("tbody")).includes("FrigiServe"), "admin's own list excludes it");

  // Onboarding defaults to the lead.
  await a.goto(BASE + `/clients/${clientId}`);
  ok((await a.inputValue("select[name=assignee_id]")) === memberId, "onboarding assigns to the lead by default");

  await browser.close();
  console.log("LEADS E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
