// Monthly fees and the Revenue page. Run after tests/e2e.cjs and tests/e2e-clients.cjs (which imports
// "Sunny Roofing LLC" with "AI Optimization, $1,500/mo" in the sheet).
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

async function openClient(page, q) {
  await page.goto(BASE + "/clients?status=all&q=" + encodeURIComponent(q));
  await page.click("tbody a >> nth=0");
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  return page.url();
}

(async () => {
  const browser = await chromium.launch();
  const a = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await signIn(a, "admin@yroc.test");

  // Imported client got its fee from the sheet text; the text stays as a reference.
  const sunny = await openClient(a, "Sunny Roofing");
  await a.click("summary:has-text('Client details')");
  ok((await a.inputValue("#monthly_fee")) === "1500", "fee read from the sheet's package text ($1,500/mo)");
  ok((await a.textContent("main")).includes("From the client sheet: AI Optimization, $1,500/mo"), "original text kept for reference");

  // Admin sets FrigiServe's fee.
  const frigi = await openClient(a, "FrigiServe");
  await a.click("summary:has-text('Client details')");
  await a.fill("#monthly_fee", "3750");
  await a.click("button:has-text('Save changes')");
  await a.waitForSelector("text=Saved.");
  await a.reload();
  ok((await a.textContent("main")).includes("$3,750/mo"), "fee shown in client details for admins");

  // Fees stay off the clients list.
  await a.goto(BASE + "/clients");
  ok(!(await a.textContent("thead")).includes("Fee"), "no fee column on the clients list");

  // Revenue page
  await a.goto(BASE + "/revenue");
  const rev = await a.textContent("main");
  ok(rev.includes("$5,250"), "expected per month = 3,750 + 1,500");
  ok(rev.includes("$63,000"), "per year at this rate");
  ok(/Fee not set\s*\d+/.test(rev), "clients without a fee counted");
  ok(rev.includes("Set to") && rev.includes("$3,750"), "fee change history");
  ok(rev.includes(new Date().toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" })), "this month saved in month-by-month");
  await a.screenshot({ path: (process.argv[2] || "/tmp") + "/26-revenue.png", fullPage: true });

  // Archived clients drop out of the total.
  await a.goto(sunny);
  a.once("dialog", (d) => d.accept());
  await a.click("button:has-text('Archive client')");
  await a.waitForSelector("button:has-text('Restore to active clients')");
  await a.goto(BASE + "/revenue");
  ok((await a.textContent("main")).includes("$3,750") && !(await a.textContent("section.grid")).includes("$5,250"), "archived client no longer counted");

  // Members: no fee anywhere, and editing a client doesn't wipe the fee.
  const m = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await signIn(m, "member@yroc.test");
  ok(!(await m.isVisible("nav >> text=Revenue")), "members don't see Revenue in the menu");
  await m.goto(BASE + "/revenue");
  ok(new URL(m.url()).pathname === "/", "members can't open Revenue");
  await m.goto(frigi);
  ok(!(await m.textContent("main")).includes("3,750"), "members don't see the fee on the client");
  await m.click("summary:has-text('Client details')");
  ok(!(await m.isVisible("#monthly_fee")), "members don't get the fee field");
  await m.fill("#city", "Fort Worth, Texas");
  await m.click("button:has-text('Save changes')");
  await m.waitForSelector("text=Saved.");
  await m.goto(BASE + "/clients");
  ok(!(await m.textContent("thead")).includes("Fee"), "no fee column for members");
  await a.goto(frigi);
  ok((await a.textContent("main")).includes("$3,750/mo"), "member's edit kept the fee");

  await browser.close();
  console.log("REVENUE E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
