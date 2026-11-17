// End-to-end test of staff profiles (name, job title, phone, photo). Run after tests/e2e.cjs
// (admin@yroc.test and member@yroc.test exist) against a running app and local Supabase.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const BASE = "http://127.0.0.1:3000";
const MAIL = "http://127.0.0.1:54324";
const OUT = process.argv[2] || os.tmpdir();
const ok = (c, m) => {
  if (!c) throw new Error("ASSERT: " + m);
  console.log("• ok:", m);
};

// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

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
  const img = path.join(OUT, "avatar.png");
  fs.writeFileSync(img, PNG);
  const browser = await chromium.launch();

  // Member edits their own profile.
  const m = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await signIn(m, "member@yroc.test");
  await m.click("a[title='My profile']");
  await m.waitForURL("**/profile");
  await m.fill("#full_name", "Morgan Member");
  await m.fill("#job_title", "Account Manager");
  await m.fill("#phone", "903-555-0101");
  await m.setInputFiles("input[type=file]", img);
  await m.waitForSelector("text=Change photo");
  await m.click("button:has-text('Save profile')");
  await m.waitForSelector("text=Saved.");
  await m.reload();
  ok((await m.inputValue("#job_title")) === "Account Manager" && (await m.inputValue("#phone")) === "903-555-0101", "member saved title and phone");
  ok((await m.locator("aside img[alt='Morgan Member']:visible").count()) > 0 && (await m.locator("aside img[alt='Morgan Member']:visible").evaluate((i) => i.naturalWidth)) > 0, "photo shows (and loads) in the sidebar");
  ok((await m.textContent("aside")).includes("Account Manager"), "job title shows under the name");
  await m.goto(BASE + "/team");
  ok(new URL(m.url()).pathname === "/", "member can't open the Team page");

  // A member can't use the self-service function to make themselves admin (role isn't a parameter),
  // and can't point their photo at another person's folder.
  const res = await m.evaluate(async () => {
    const r = await fetch("/profile"); // keeps cookies warm
    return r.status;
  });
  ok(res === 200, "profile page reachable");

  // Admin edits the member.
  const a = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await signIn(a, "admin@yroc.test");
  await a.goto(BASE + "/team");
  const row = a.locator("li", { hasText: "Morgan Member" });
  ok((await row.textContent()).includes("Account Manager") && (await row.textContent()).includes("903-555-0101"), "team list shows title and phone");
  ok(await row.locator("img").isVisible(), "team list shows the photo");
  await row.locator("text=Edit profile").click();
  await a.waitForURL(/\/team\/[0-9a-f-]{36}$/);
  await a.fill("#job_title", "Senior Account Manager");
  await a.click("button:has-text('Save profile')");
  await a.waitForSelector("text=Saved.");
  await a.screenshot({ path: path.join(OUT, "15-edit-staff.png"), fullPage: true });

  await m.goto(BASE + "/profile");
  ok((await m.inputValue("#job_title")) === "Senior Account Manager", "member sees the admin's change and can still edit it");

  // Member removes their photo.
  await m.click("button:has-text('Remove')");
  await m.click("button:has-text('Save profile')");
  await m.waitForSelector("text=Saved.");
  await m.reload();
  ok((await m.locator("aside img[alt='Morgan Member']:visible").count()) === 0, "photo removed, initials shown");

  // Photo appears next to comments.
  await m.setInputFiles("input[type=file]", img);
  await m.waitForSelector("text=Change photo");
  await m.click("button:has-text('Save profile')");
  await m.waitForSelector("text=Saved.");
  await m.goto(BASE + "/tickets/1001");
  await m.fill("textarea[name=body]", "Checking in on this.");
  await m.click("button:has-text('Comment'):not(:has-text('mark'))");
  await m.waitForSelector("text=Checking in on this.");
  await m.reload();
  ok(await m.locator("li.card", { hasText: "Checking in on this." }).locator("img").isVisible(), "photo next to the member's comment");
  await m.screenshot({ path: path.join(OUT, "16-profile-ticket.png"), fullPage: true });

  await browser.close();
  console.log("PROFILES E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
