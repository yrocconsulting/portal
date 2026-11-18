// End-to-end test of email intake: mock Graph (tests/mock-graph.cjs) + local Supabase + the app.
// Assumes tests/e2e.cjs already ran (admin@yroc.test exists, client FrigiServe with domain frigiserve.com,
// contact pat@frigiserve.com, ticket #1001) and the app runs with the MS_* test settings.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const BASE = "http://127.0.0.1:3000";
const MAIL = "http://127.0.0.1:54324";
const GRAPH = "http://127.0.0.1:4010";
const log = (...a) => console.log("•", ...a);
const ok = (cond, msg) => {
  if (!cond) throw new Error("ASSERT: " + msg);
  log("ok:", msg);
};

async function add(m) {
  return fetch(`${GRAPH}/__test/messages`, { method: "POST", body: JSON.stringify(m) }).then((r) => r.json());
}

async function latestLink(email) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent("to:" + email)}&limit=1`).then((r) => r.json());
    const m = r.messages?.[0];
    if (m) {
      const msg = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
      const href = (msg.HTML || "").match(/href="([^"]+verify[^"]+)"/)?.[1];
      if (href) return href.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no email");
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await fetch(`${MAIL}/api/v1/messages`, { method: "DELETE" });
  await page.goto(BASE + "/login");
  await page.fill("input[name=email]", "admin@yroc.test");
  await page.click("text=Email me a sign in link");
  await page.waitForSelector("text=Check your inbox");
  await page.goto(await latestLink("admin@yroc.test"));
  await page.waitForLoadState("networkidle");

  // 1. Forward from staff, client matched by contact, with a PDF and an inline logo.
  await add({
    from: "admin@yroc.test",
    fromName: "Admin",
    subject: "FW: New blast freezer photos",
    body: "Please add these to the gallery page.\n\n________________________________\nFrom: Pat Example <pat@frigiserve.com>\nSent: Monday\nTo: Admin <admin@yroc.test>\nSubject: New blast freezer photos\n\nHi! Photos attached.\nPat",
    attachments: [
      { "@odata.type": "#microsoft.graph.fileAttachment", name: "photos.pdf", contentType: "application/pdf", isInline: false, contentBytes: Buffer.from("PDFDATA").toString("base64") },
      { "@odata.type": "#microsoft.graph.fileAttachment", name: "logo.png", contentType: "image/png", isInline: true, contentBytes: Buffer.from("x").toString("base64") },
    ],
  });
  // 2. Forward from staff, new person at a known client domain (contact gets created).
  await add({
    from: "admin@yroc.test",
    subject: "Fwd: Holiday hours",
    body: "---------- Forwarded message ---------\nFrom: Lee New <lee@frigiserve.com>\nDate: today\nSubject: Holiday hours\nTo: <admin@yroc.test>\n\nClosed Thanksgiving.",
  });
  // 3. Follow-up for ticket #1001.
  await add({
    from: "admin@yroc.test",
    subject: "FW: RE: Add FAQ schema [#1001]",
    body: "From: Pat Example <pat@frigiserve.com>\nSent: Tuesday\nSubject: RE: Add FAQ schema\n\nLooks great, thanks!",
  });
  // 4. Unknown sender straight to helpdesk.
  await add({ from: "spam@junk.biz", fromName: "Deals", subject: "Cheap SEO!!!", body: "Buy now" });
  // 5. Unknown client forwarded by staff (no client match).
  await add({ from: "admin@yroc.test", subject: "FW: Quote request", body: "From: Someone <someone@newprospect.com>\nSubject: Quote request\n\nHow much for a website?" });

  // 8. A note about a client from a sender we don't know: the client is named in the subject.
  execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -qtAc "update clients set lead_id = (select id from staff where email='member@yroc.test') where name='FrigiServe Cold Storage'"`);
  await add({ from: "admin@yroc.test", subject: "FW: FrigiServe Cold Storage gallery refresh", body: "From: Sam Vendor <sam@photostudio.biz>\nSubject: Photos ready\n\nThe new photos are ready." });
  // 6. Spoofed staff address from outside the organisation.
  await add({ from: "admin@yroc.test", authAs: "Anonymous", subject: "FW: Wire money", body: "From: Boss <boss@evil.com>\nSubject: Wire money\n\nNow." });
  // 7. Genuine internal forward carries the Internal stamp.
  await add({ from: "admin@yroc.test", authAs: "Internal", subject: "FW: Logo files", body: "From: Pat Example <pat@frigiserve.com>\nSubject: Logo files\n\nAttached soon." });

  // Webhook validation + bad clientState are handled.
  const v = await fetch(`${BASE}/api/email/webhook?validationToken=abc%20123`, { method: "POST" });
  ok(v.status === 200 && (await v.text()) === "abc 123", "webhook echoes validation token");
  const bad = await fetch(`${BASE}/api/email/webhook`, { method: "POST", body: JSON.stringify({ value: [{ clientState: "nope" }] }) });
  ok(bad.status === 202, "webhook ignores a wrong clientState");
  const cronNoAuth = await fetch(`${BASE}/api/email/cron`);
  ok(cronNoAuth.status === 401, "cron requires the secret");

  // Run intake from the Inbox page.
  await page.goto(BASE + "/inbox");
  await page.click("text=Check mailbox now");
  await page.waitForSelector("text=/Checked 8 new emails/", { timeout: 30000 });
  log("result:", (await page.textContent("p.text-green-d, p.text-red-700")).trim());

  // Second run finds nothing (marked read, no duplicates).
  await page.click("text=Check mailbox now");
  await page.waitForSelector("text=Checked 0 new emails");
  ok(true, "second run creates no duplicates");

  await page.reload();
  ok(await page.isVisible("text=Cheap SEO!!!"), "spam waits in Needs review");
  ok(await page.isVisible("text=FW: Wire money"), "spoofed staff sender waits in Needs review");
  ok(await page.isVisible("text=FW: Logo files"), "internal forward processed");
  await page.screenshot({ path: (process.argv[2] || "/tmp") + "/08-inbox.png", fullPage: true });

  // Ticket from #1
  await page.goto(BASE + "/tickets?q=blast+freezer+photos&status=all");
  await page.click("tbody tr a >> nth=0");
  await page.waitForURL(/\/tickets\/\d+$/);
  const t1 = await page.textContent("main");
  ok(t1.includes("FrigiServe Cold Storage") && t1.includes("Pat Example"), "ticket linked to client and contact");
  ok(t1.includes("Please add these to the gallery page.") && t1.includes("Photos attached."), "note and original body kept");
  ok(t1.includes("photos.pdf") && !t1.includes("logo.png"), "file attached, inline logo skipped");
  ok(t1.includes("From email"), "source shows email");
  await page.screenshot({ path: (process.argv[2] || "/tmp") + "/09-email-ticket.png", fullPage: true });

  // #2 created a contact
  await page.goto(BASE + "/tickets?q=Holiday+hours&status=all");
  await page.click("tbody tr a >> nth=0");
  await page.waitForURL(/\/tickets\/\d+$/);
  ok((await page.textContent("main")).includes("Lee New"), "new contact created from client domain");

  // #8 client named in the subject (sender unknown), assigned to the client's lead
  await page.goto(BASE + "/tickets?q=Photos+ready&status=all");
  await page.click("tbody tr a >> nth=0");
  await page.waitForURL(/\/tickets\/\d+$/);
  const t8 = await page.textContent("main");
  ok(t8.includes("FrigiServe Cold Storage"), "client found by name in the subject");
  ok(execSync(`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -qtAc "select s.email from tickets t join staff s on s.id=t.assignee_id where t.title='Photos ready'"`).toString().trim() === "member@yroc.test", "assigned to the client's lead");

  // #3 comment on #1001
  await page.goto(BASE + "/tickets/1001");
  const t3 = await page.textContent("main");
  ok(t3.includes("Looks great, thanks!") && t3.includes("via email"), "follow-up added to #1001");

  // #5 no client
  await page.goto(BASE + "/tickets?q=Quote+request&status=all");
  await page.click("tbody tr a >> nth=0");
  await page.waitForURL(/\/tickets\/\d+$/);
  await page.waitForURL(/\/tickets\/\d+$/);
  ok(!(await page.isVisible("a[href^='/clients/']")), "unknown sender's ticket has no client");

  // Confirmations were emailed to the forwarder from no-reply.
  const st = await fetch(`${GRAPH}/__test/state`).then((r) => r.json());
  ok(st.sent.length === 6, `6 confirmations sent (got ${st.sent.length})`);
  ok(st.sent.some((m) => /found by name in the email/.test(m.body.content) && /assigned to/.test(m.body.content)), "confirmation says the client was found by name and who it went to");
  ok(st.sent.every((m) => m.from === "noreply@yroc.test"), "confirmations come from no-reply");
  ok(st.sent.some((m) => /No client matched someone@newprospect.com/.test(m.body.content)), "no-client confirmation explains next step");
  ok(st.messages.every((m) => m.isRead), "all messages marked read");

  // Create a ticket from the spam by hand, then dismiss nothing else.
  await page.goto(BASE + "/inbox");
  await page.click("button:has-text('Dismiss') >> nth=0");
  await page.waitForTimeout(800);
  await page.click("button:has-text('Dismiss') >> nth=0");
  await page.waitForSelector("text=Nothing waiting.");
  ok(true, "dismiss clears Needs review");

  // Manual client message logging.
  await page.goto(BASE + "/tickets/1001");
  await page.check("input[name=from_client]");
  await page.fill("textarea[name=body]", "Called: wants the FAQ live by Friday.");
  await page.click("button:has-text('Comment'):not(:has-text('mark'))");
  await page.waitForSelector("text=Called: wants the FAQ live by Friday.");
  await page.reload();
  ok((await page.textContent("main")).includes("client message, logged by"), "logged client message labelled");

  // Cron with the secret creates the subscription.
  const cron = await fetch(`${BASE}/api/email/cron`, { headers: { authorization: "Bearer test-cron-secret" } }).then((r) => r.json());
  ok(/subscription created/.test(cron.subscription), "cron creates the Graph subscription: " + cron.subscription);
  const cron2 = await fetch(`${BASE}/api/email/cron`, { headers: { authorization: "Bearer test-cron-secret" } }).then((r) => r.json());
  ok(/subscription renewed/.test(cron2.subscription), "second cron renews it");

  await browser.close();
  console.log("EMAIL E2E PASSED");
})().catch((e) => {
  console.error("FAIL", e.message);
  process.exit(1);
});
