// End-to-end test of monthly reports: package on a client, start the month, record work and actions,
// results snapshot, archive (read-only), reopen, print view, package editor. Run after tests/e2e.cjs
// (FrigiServe Cold Storage exists) and ideally tests/e2e-gsc.cjs (Search Console data for frigiserve.com).
const { chromium } = require("playwright");
const os = require("os");
const path = require("path");
const BASE = "http://127.0.0.1:3000";
const MAIL = "http://127.0.0.1:54324";
const OUT = process.argv[2] || os.tmpdir();
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("dialog", (d) => d.accept());
  await signIn(page, "admin@yroc.test");

  // Packages seeded from the deliverables sheet.
  await page.goto(BASE + "/packages");
  const pk = await page.textContent("main");
  ok(pk.includes("Search Foundation") && pk.includes("Search Growth") && pk.includes("Search Authority"), "three packages from the sheet");
  await page.click("a:has-text('Search Growth')");
  await page.waitForSelector("h2:has-text('Search Growth')");
  ok((await page.textContent("main")).includes("Publish GBP content & media") && (await page.textContent("main")).includes("~2 posts/week, 4 Q&A/month, 5 media/week"), "SOP tasks with package volumes");
  ok((await page.textContent("main")).includes("Create / distribute PR when included"), "Growth includes the PR task");

  // Put FrigiServe on Search Growth.
  await page.goto(BASE + "/clients?q=FrigiServe");
  await page.click("tbody a >> nth=0");
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}/);
  const clientUrl = page.url();
  await page.click("summary:has-text('Client details')");
  await page.selectOption("#package_id", { label: "Search Growth" });
  await page.click("button:has-text('Save changes')");
  await page.waitForSelector("text=Saved.");

  // Start this month (a month with Search Console data from the mock: use November 2026).
  await page.goto(BASE + "/reports?month=2026-11");
  const row = page.locator("tr", { hasText: "FrigiServe Cold Storage" });
  ok((await row.textContent()).includes("Search Growth"), "reports list shows the package");
  await row.locator("button:has-text('Start')").click();
  await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
  const reportUrl = page.url();
  const t = await page.textContent("main");
  ok(t.includes("FrigiServe Cold Storage: November 2026") && t.includes("Search Growth"), "record created for November");
  ok(t.includes("Google clicks"), "results snapshot saved with Google Search numbers");
  ok(t.includes("Search Growth Actions") && t.includes("of 10 delivered"), "actions log with the package target");

  // Log two actions.
  for (const [type, title] of [
    ["New service / landing page", "Blast freezing Fort Worth page"],
    ["Content refresh", "Updated cold storage pricing guide"],
  ]) {
    await page.selectOption("select[name=action_type]", { label: type });
    await page.fill("input[name=title]", title);
    await page.fill("input[name=url]", "frigiserve.com/blast-freezing");
    await page.click("form button:has-text('Add')");
    await page.waitForSelector(`text=${title}`);
  }
  ok((await page.textContent("main")).includes("2 of 10 delivered"), "actions counted");

  // Work through the SOP in order: the first open task is next up, and it moves on when ticked.
  const nextUp = async () => (await page.locator("li[data-next=true]").textContent()) ?? "";
  ok((await nextUp()).includes("Review monthly performance") && (await nextUp()).includes("Done when:"), "first task is next up, with its definition of done");
  await page.locator("li[data-next=true]").locator("button:text-is('Done')").click();
  ok((await nextUp()).includes("Choose monthly priorities"), "next up moves on to the next task");
  ok((await page.locator("li", { hasText: "Analyze AI citations" }).textContent()).includes("Client sees this") === false, "internal tasks aren't marked client-facing");

  // Fill in items: GBP links, a check item, an N/A item, wins.
  const gbp = page.locator("li", { hasText: "Publish GBP content & media" });
  await gbp.locator("button:text-is('Done')").click();
  await gbp.locator("button:has-text('+ Add links/notes')").click();
  await gbp.locator("textarea").first().fill("https://g.page/post1\nhttps://g.page/post2");
  const titles = page.locator("li", { hasText: "Improve AI readability & on-page signals" });
  await titles.locator("button:text-is('Done')").click();
  const speed = page.locator("li", { hasText: "Perform 90-day strategy reset" });
  await speed.locator("button:text-is('N/A')").click();
  await page.fill("#wins", "Now cited by ChatGPT for blast freezing in DFW.");
  await page.fill("#summary", "Launched the blast freezing page.");
  await page.fill("#organic_leads", "6");
  ok(await page.isVisible("text=Unsaved changes"), "unsaved changes flagged");
  await page.click("button:has-text('Save'):not(:has-text('profile'))");
  await page.waitForSelector("span:text-is('Saved.')");
  await page.waitForSelector("text=Unsaved changes", { state: "detached" });
  await page.reload();
  ok((await gbp.locator("textarea").first().inputValue()).includes("post2"), "links saved");
  ok((await page.inputValue("#wins")).includes("cited by ChatGPT"), "wins saved");
  await page.screenshot({ path: path.join(OUT, "19-report.png"), fullPage: true });

  // Archive
  await page.click("button:has-text('Mark complete')");
  await page.waitForSelector("text=This month is complete and archived");
  ok(!(await page.isVisible("input[name=title]")), "archived month is read-only (no add form)");
  ok(await page.locator("textarea#wins").evaluate((e) => e.readOnly), "wins read-only");
  ok(await page.isVisible("button:has-text('Reopen for editing')"), "admin can reopen");

  // Print view
  await page.goto(reportUrl + "/print");
  const pr = await page.textContent("main");
  ok(pr.includes("Monthly work record") && pr.includes("Wins") && pr.includes("Blast freezing Fort Worth page") && pr.includes("Publish GBP content & media"), "print view shows wins, actions and counts");
  await page.screenshot({ path: path.join(OUT, "20-report-print.png"), fullPage: true });

  // History on the client page and list status.
  await page.goto(clientUrl);
  ok((await page.textContent("main")).includes("November 2026") && (await page.textContent("main")).includes("Archived"), "client page lists the archived month");
  await page.goto(BASE + "/reports?month=2026-11");
  ok((await page.locator("tr", { hasText: "FrigiServe" }).textContent()).includes("Complete, archived"), "reports list shows archived");

  // Editing a package later doesn't change the archived month.
  await page.goto(BASE + "/packages");
  await page.click("a:has-text('Search Growth')");
  const li = page.locator("li", { hasText: "Improve AI readability & on-page signals" });
  await li.locator("button:has-text('Remove')").click();
  await page.waitForTimeout(800);
  await page.goto(reportUrl);
  ok((await page.textContent("main")).includes("Improve AI readability & on-page signals"), "archived month keeps its own copy after a package change");

  // Member can't reopen.
  const m = await browser.newPage();
  await signIn(m, "member@yroc.test");
  await m.goto(reportUrl);
  ok(!(await m.isVisible("button:has-text('Reopen for editing')")), "members can't reopen archived months");
  await m.goto(BASE + "/packages");
  ok(new URL(m.url()).pathname === "/", "members can't edit packages");

  // Admin reopens and edits again.
  await page.click("button:has-text('Reopen for editing')");
  await page.waitForSelector("button:has-text('Mark complete')");
  ok(await page.isVisible("input[name=title]"), "reopened month is editable");

  await browser.close();
  console.log("REPORTS E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
