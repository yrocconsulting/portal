// End-to-end test of the client sheet import and client logins. Builds a fake workbook in the same
// layout as the real client sheet (summary tab, Template, one tab per client, "Past Clients" divider).
// Run after tests/e2e.cjs against a freshly reset local database, with CREDENTIALS_KEY set.
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const os = require("os");
const path = require("path");
const BASE = "http://127.0.0.1:3000";
const MAIL = "http://127.0.0.1:54324";
const OUT = process.argv[2] || os.tmpdir();
const ok = (c, m) => {
  if (!c) throw new Error("ASSERT: " + m);
  console.log("• ok:", m);
};

async function workbook(file) {
  const wb = new ExcelJS.Workbook();
  const sum = wb.addWorksheet("Clients");
  sum.addRow(["Company Name", "Primary Client Contact", "Industry", "Services We Provide", "Google Drive Link"]);
  sum.addRow(["Sunny Roofing", "Rita Sun", "Roofing", "White Labeled AI Optimization", "https://drive.google.com/x"]);
  sum.addRow(["FrigiServe Cold Storage", "Pat Example", "Storage", "SEO", ""]);
  wb.addWorksheet("Template").addRow(["Business Name"]);
  const tab = (name, rows) => {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
  };
  tab("Sunny Roofing", [
    ["Business Name", "Sunny Roofing LLC"],
    ["Primary Contact Name", "Rita Sun"],
    ["Phone", "555-0100"],
    ["Email", "Rita@SunnyRoof.example"],
    ["Address", "1 Main St, Dallas, TX"],
    ["Services/Package", "AI Optimization, $1,500/mo"],
    ["Payment Method", "Card"],
    ["Google Drive", "https://drive.google.com/sunny"],
    [],
    ["Locations", "Dallas"],
    [null, "Fort Worth"],
    ["Website URL", "www.sunnyroof.example"],
    ["Industry", "Roofing"],
    ["Start Date", new Date(Date.UTC(2025, 2, 3))],
    [],
    ["Website Login", "https://sunnyroof.example/wp-admin"],
    ["Username", "rita-admin"],
    ["Password", "SuperSecret-111"],
    [],
    ["Hosting", "SiteGround"],
    ["Username", "host-user"],
    ["Password", "HostPass-222"],
    [],
    ["GBP Link", "https://g.co/kgs/sunny"],
    ["Facebook Page Link", "https://facebook.com/sunny"],
  ]);
  tab("FrigiServe", [
    ["Business Name", "FrigiServe Cold Storage"],
    ["Primary Contact Name", "Pat Example"],
    ["Phone", "555-0200"],
    ["Website URL", "https://frigiserve.com"],
    ["Industry", "Cold storage"],
  ]);
  tab("Past Clients", [["Company Name"]]);
  tab("Old Pools - White Label", [["Business Name", "Old Pools - White Label"], ["Services/Package", "SEO"]]);
  await wb.xlsx.writeFile(file);
}

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
  const file = path.join(OUT, "fake-clients.xlsx");
  await workbook(file);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await signIn(page, "admin@yroc.test");

  // Preview
  await page.goto(BASE + "/clients/import");
  await page.setInputFiles("input[name=file]", file);
  await page.click("button:has-text('Preview')");
  await page.waitForSelector("text=3 clients found");
  const preview = await page.textContent("main");
  ok(!/SuperSecret|HostPass|rita-admin|host-user/.test(preview), "no logins in the preview");
  ok(/Update FrigiServe Cold Storage/.test(preview), "existing client matched for update");
  ok((await page.$$eval("text=White label", (e) => e.length)) >= 2, "white label flagged from summary and tab name");
  await page.screenshot({ path: path.join(OUT, "10-import-preview.png"), fullPage: true });

  // Commit
  await page.click("button:has-text('Import 3 clients')");
  await page.waitForSelector("text=Import finished");
  const res = await page.textContent("main");
  ok(/2 clients added, 1 updated/.test(res), "2 added, 1 updated: " + res.match(/\d+ clients added.*?added\./)?.[0]);

  // Re-import: no duplicates
  await page.goto(BASE + "/clients/import");
  await page.setInputFiles("input[name=file]", file);
  await page.click("button:has-text('Preview')");
  await page.waitForSelector("text=3 clients found");
  await page.click("button:has-text('Import 3 clients')");
  await page.waitForSelector("text=Import finished");
  ok(/0 clients added, 3 updated, 0 contacts added/.test(await page.textContent("main")), "re-import updates without duplicates");

  // Client page shows details
  await page.goto(BASE + "/clients?q=Sunny");
  await page.click("tbody a >> nth=0");
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  const sunnyUrl = page.url();
  const sunny = await page.textContent("main");
  ok(sunny.includes("Sunny Roofing LLC") && sunny.includes("White label"), "client imported with white label");
  ok(sunny.includes("Fort Worth") && sunny.includes("Mar 3, 2025") && sunny.includes("Card"), "locations, start date, payment imported");
  ok(sunny.includes("rita@sunnyroof.example") && sunny.includes("Rita Sun"), "primary contact imported");
  ok(sunny.includes("sunnyroof.example") && (await page.isVisible("a:has-text('Google Business Profile')")), "domain and profile links imported");
  ok(!/SuperSecret|HostPass|rita-admin/.test(sunny) && sunny.includes("No logins saved."), "logins left empty");

  await page.goto(BASE + "/clients?status=former");
  ok((await page.textContent("main")).includes("Old Pools"), "past client imported as former, suffix removed");
  ok(!(await page.textContent("main")).includes("Old Pools - White Label"), "white label suffix stripped from name");

  // Logins: add, reveal (logged), edit keeps password
  await page.goto(sunnyUrl);
  await page.click("text=+ Add login");
  await page.fill("input[name=label]", "WordPress admin");
  await page.fill("input[name=url]", "sunnyroof.example/wp-admin");
  await page.fill("input[name=username]", "yroc-admin");
  await page.fill("input[name=password]", "Tr0ub4dor&3");
  await page.click("button:text-is('Save')");
  await page.waitForSelector("text=WordPress admin");
  ok(!(await page.textContent("main")).includes("Tr0ub4dor&3"), "password hidden by default");
  await page.click("button:has-text('Reveal')");
  await page.waitForSelector("text=Tr0ub4dor&3");
  ok(true, "reveal shows the password");
  await page.reload();
  await page.click("summary:has-text('Access history')");
  ok(/viewed the password for WordPress admin/.test(await page.textContent("main")), "reveal recorded in access history");
  await page.screenshot({ path: path.join(OUT, "11-client-details.png"), fullPage: true });

  const html = await (await page.context().request.get(sunnyUrl)).text();
  ok(!html.includes("Tr0ub4dor") && !/v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:/.test(html), "neither the password nor its encrypted form is in the page source");

  await page.click("button:has-text('Edit') >> nth=0");
  await page.fill("input[name=username]", "yroc-admin-2");
  await page.click("button:text-is('Save')");
  await page.waitForSelector("text=yroc-admin-2");
  await page.click("button:has-text('Reveal')");
  await page.waitForSelector("text=Tr0ub4dor&3");
  ok(true, "editing without a new password keeps the old one");

  // Archive keeps everything but leaves the active list; restore brings it back.
  await page.goto(sunnyUrl);
  page.once("dialog", (d) => d.accept());
  await page.click("button:has-text('Archive client')");
  await page.waitForSelector("button:has-text('Restore to active clients')");
  ok((await page.textContent("main")).includes("WordPress admin"), "archived client keeps details and logins");
  await page.goto(BASE + "/clients");
  ok(!(await page.textContent("main")).includes("Sunny Roofing"), "archived client hidden from active list");
  await page.goto(BASE + "/clients?status=former");
  ok((await page.textContent("main")).includes("Sunny Roofing"), "archived client listed under Archived");
  await page.goto(BASE + "/tickets/new");
  ok(!(await page.textContent("#client_id")).includes("Sunny Roofing"), "archived client not offered for new tickets");
  await page.goto(sunnyUrl);
  await page.click("button:has-text('Restore to active clients')");
  await page.waitForSelector("button:has-text('Archive client')");
  await page.goto(BASE + "/clients");
  ok((await page.textContent("main")).includes("Sunny Roofing"), "restore returns it to the active list");

  await browser.close();
  console.log("CLIENTS E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
