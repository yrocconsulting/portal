// The ProRankTracker 'Send to portal' button. Run after tests/e2e.cjs.
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


// A stand-in for ProRankTracker's result pop-up (same structure as the real one).
const FAKE_PRT = `<!doctype html><html><body>
<div style="display:none"><h3>Copilot Appearances: hidden old modal</h3></div>
<h2>frigiserve.com</h2><table><tr><td>Who offers blast freezing near Fort Worth</td><td>check_circle 3</td></tr></table>
<div class="modal"><div class="modal-header"><h3>AIO Appearances: Who offers blast freezing near Fort Worth</h3><button>x</button></div>
<div class="modal-body"><h4>Mentions</h4><table><thead><tr><th>Brand Name</th><th>Content</th></tr></thead><tbody>
<tr><td>FrigiServe</td><td>AI Overview AI Mode reply for Who offers blast freezing near Fort Worth FrigiServe Cold Storage offers blast freezing for food manufacturers near Fort Worth.</td></tr>
<tr><td>FrigiServe</td><td>FrigiServe Cold Storage, 1200 Industrial Blvd, Fort Worth, TX. Services: blast freezing, cold storage and distribution.</td></tr>
</tbody></table><h4>Links</h4><a href="https://frigiserve.com/blast-freezing">frigiserve.com/blast-freezing</a> <a href="https://othersite.example/list">othersite</a></div></div>
</body></html>`;

(async () => {
  // This week's results, so the prompt can be matched to FrigiServe.
  await fetch(`${BASE}/api/prt/ingest`, {
    method: "POST",
    headers: { authorization: "Bearer test-prt-secret", "content-type": "application/json" },
    body: JSON.stringify({
      report_date: "2026-11-16",
      sites: [{ domain: "frigiserve.com", appearances: 3, mentions: 2, links: 1, visibility: 50, prompts: 1, platforms: { aio: 3 } }],
      prompts: [{ domain: "frigiserve.com", prompt: "Who offers blast freezing near Fort Worth?", platforms: ["aio"], counts: { aio: 3 }, appearances: 3, visibility: 50 }],
    }),
  });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const a = await ctx.newPage();
  await signIn(a, "admin@yroc.test");

  // Setup page: the draggable bookmark.
  await a.goto(BASE + "/capture");
  const href = await a.getAttribute("a:has-text('Send to Yroc Portal')", "href");
  ok(href && href.startsWith("javascript:"), "bookmark button is a bookmarklet");
  await a.screenshot({ path: (process.argv[2] || "/tmp") + "/33-capture-setup.png" });
  const code = decodeURIComponent(href.slice("javascript:".length));

  // Nothing open: a friendly message, no portal tab.
  const prt = await ctx.newPage();
  await prt.setContent("<html><body><h2>frigiserve.com</h2></body></html>");
  let alerted = "";
  prt.once("dialog", async (d) => {
    alerted = d.message();
    await d.dismiss();
  });
  await prt.evaluate(code);
  ok(alerted.startsWith("Open a result first"), "asks you to open a result first");

  // Click it on an open result.
  await prt.setContent(FAKE_PRT);
  const [cap] = await Promise.all([ctx.waitForEvent("page"), prt.evaluate(code)]);
  await cap.waitForLoadState();
  await cap.waitForSelector("text=From ProRankTracker");
  await cap.waitForFunction(() => document.querySelector("#cap_client")?.value);
  const clientId = sql("select id from clients where name='FrigiServe Cold Storage'");
  ok((await cap.inputValue("#cap_client")) === clientId, "client matched from the prompt");
  ok((await cap.inputValue("#cap_platform")) === "aio", "platform read from the pop-up title");
  const t = await cap.textContent("main");
  ok(t.includes("FrigiServe Cold Storage offers blast freezing for food manufacturers near Fort Worth.") && !t.includes("reply for"), "mentions cleaned up");
  ok(!t.includes("hidden old modal"), "only the visible pop-up is read");
  await cap.screenshot({ path: (process.argv[2] || "/tmp") + "/34-capture.png", fullPage: true });

  // Untick the address line, save.
  await cap.locator("label", { hasText: "1200 Industrial Blvd" }).locator("input").uncheck();
  await cap.click("button:has-text('Add to the monthly report')");
  await cap.waitForSelector("text=Added 1 quote");
  ok(sql("select count(*) from report_quotes") === "1", "one quote saved");
  ok(sql("select platform || '|' || array_to_string(cited_urls, ',') from report_quotes") === "aio|https://frigiserve.com/blast-freezing", "platform and the client's cited page saved, other sites left out");

  // Sending the same thing again doesn't duplicate.
  const [cap2] = await Promise.all([ctx.waitForEvent("page"), prt.evaluate(code)]);
  await cap2.waitForSelector("text=From ProRankTracker");
  await cap2.waitForFunction(() => document.querySelector("#cap_client")?.value);
  await cap2.locator("label", { hasText: "1200 Industrial Blvd" }).locator("input").uncheck();
  await cap2.click("button:has-text('Add to the monthly report')");
  await cap2.waitForSelector("text=already on the report");
  ok(sql("select count(*) from report_quotes") === "1", "no duplicates");

  // It shows on the monthly report.
  await cap2.click("a:has-text('Open the monthly report')");
  await cap2.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  ok((await cap2.locator("[data-quote] textarea[aria-label='Quote']").first().inputValue()).startsWith("FrigiServe Cold Storage offers blast freezing"), "quote is on the monthly report, ready to check");

  await browser.close();
  console.log("CAPTURE E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
