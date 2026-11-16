// End-to-end test of the portal against local Supabase (Mailpit catches magic links).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = 'http://127.0.0.1:3000';
const MAIL = 'http://127.0.0.1:54324';
const OUT = process.argv[2] || require('os').tmpdir();
const log = (...a) => console.log('•', ...a);

async function latestLink(email) {
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}&limit=1`).then((r) => r.json());
    const m = r.messages?.[0];
    if (m) {
      const msg = await fetch(`${MAIL}/api/v1/message/${m.ID}`).then((r) => r.json());
      const href = (msg.HTML || msg.Text).match(/href="([^"]+verify[^"]+)"/)?.[1] || (msg.Text || '').match(/(http\S+verify\S+)/)?.[1];
      if (href) return href.replace(/&amp;/g, '&');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no email for ' + email);
}

async function signIn(page, email) {
  await fetch(`${MAIL}/api/v1/messages`, { method: 'DELETE' });
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', email);
  await page.click('text=Email me a sign in link');
  await page.waitForSelector('text=Check your inbox');
  const link = await latestLink(email);
  await page.goto(link);
  await page.waitForLoadState('networkidle');
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  // 1. Uninvited user is blocked.
  await signIn(page, 'stranger@example.com');
  log('uninvited lands on', new URL(page.url()).pathname);
  await page.screenshot({ path: `${OUT}/01-no-access.png` });
  await page.click('button:visible:has-text("Sign out")');
  await page.waitForURL('**/login');

  // 2. Admin signs in.
  await page.screenshot({ path: `${OUT}/00-login.png` });
  await signIn(page, 'admin@yroc.test');
  log('admin lands on', new URL(page.url()).pathname, '|', await page.textContent('h1'));

  // 3. Create a client with a contact.
  await page.goto(BASE + '/clients/new');
  await page.fill('#name', 'FrigiServe Cold Storage');
  await page.fill('#domain', 'https://www.FrigiServe.com/about');
  await page.fill('#city', 'Fort Worth, TX');
  await page.check('input[value="AI Search Optimization"]');
  await page.check('input[value="Schema & Structured Data"]');
  await page.fill('input[name=contact_name]', 'Pat Example');
  await page.fill('input[name=contact_email]', 'Pat@frigiserve.com');
  await page.click('text=Create client');
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  const clientUrl = page.url();
  log('client created', (await page.textContent('h1')), '|', await page.textContent('main p.mt-1'));

  // White-label client.
  await page.goto(BASE + '/clients/new');
  await page.fill('#name', 'Partner Client Co');
  await page.fill('#domain', 'partnerclient.com');
  await page.check('input[name=white_label]');
  await page.fill('#partner', 'Example Agency');
  await page.click('text=Create client');
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  log('white label badge shown:', await page.isVisible('text=White label'));

  // Duplicate domain is rejected nicely.
  await page.goto(BASE + '/clients/new');
  await page.fill('#name', 'Dupe');
  await page.fill('#domain', 'frigiserve.com');
  await page.click('text=Create client');
  await page.waitForSelector('text=Another client already uses that domain.');
  log('duplicate domain rejected');

  // 4. Create a ticket for the client.
  await page.goto(clientUrl);
  await page.click('text=+ New ticket');
  await page.fill('#title', 'Add FAQ schema to the blast freezing page');
  await page.fill('#description', 'Gemini quotes the competitor FAQ. Add FAQPage markup with the 5 questions from the call.');
  await page.selectOption('#contact_id', { label: 'Pat Example' });
  await page.selectOption('#priority', 'high');
  await page.fill('#due_date', '2026-11-10');
  await page.click('text=Create ticket');
  await page.waitForURL(/\/tickets\/\d+$/);
  const ticketUrl = page.url();
  log('ticket created', ticketUrl.split('/').pop(), '| overdue flag:', await page.isVisible('text=Overdue'));

  // 5. Change status + assignee, comment, attach a file.
  await page.selectOption('select:near(:text("Status"))', 'in_progress');
  await page.waitForTimeout(1200);
  await page.fill('textarea[name=body]', 'Drafted the markup, sending for review.');
  await page.click('button:has-text("Comment"):not(:has-text("mark"))');
  await page.waitForSelector('text=Drafted the markup');
  const f = path.join(OUT, 'faq-draft.txt');
  fs.writeFileSync(f, 'FAQ draft');
  await page.setInputFiles('input[type=file]', f);
  await page.waitForSelector('a:has-text("faq-draft.txt")', { timeout: 15000 });
  const href = await page.getAttribute('a:has-text("faq-draft.txt")', 'href');
  const dl = await fetch(href).then((r) => r.text());
  log('attachment downloads:', dl === 'FAQ draft');
  await page.reload();
  log('activity:', (await page.$$eval('ol li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').slice(0, 70)))).join(' | '));
  await page.screenshot({ path: `${OUT}/04-ticket.png`, fullPage: true });

  // Edit title.
  await page.click('button:has-text("Edit")');
  await page.fill('input[name=title]', 'Add FAQ schema to the blast freezing page (v2)');
  await page.click('button:has-text("Save")');
  await page.waitForSelector('h1:has-text("(v2)")');
  log('title edit saved');

  // Comment and mark done.
  await page.fill('textarea[name=body]', 'Live and validated.');
  await page.click('text=Comment and mark done');
  await page.waitForSelector('text=Live and validated.');
  await page.reload();
  log('status after mark done:', await page.$eval('select', (s) => s.value), '| resolved shown:', await page.isVisible('dt:has-text("Resolved")'));

  // 6. Onboarding on the client.
  await page.goto(clientUrl);
  page.once('dialog', (d) => d.accept());
  await page.click('text=Start onboarding');
  await page.waitForSelector('text=Created 7 tickets.');
  await page.reload();
  log('client open tickets after onboarding:', await page.$$eval('tbody tr', (r) => r.length));
  await page.screenshot({ path: `${OUT}/05-client.png`, fullPage: true });

  // 7. Ticket list filters + search.
  await page.goto(BASE + '/tickets?q=kickoff');
  log('search "kickoff":', await page.$$eval('tbody tr', (r) => r.length));
  await page.goto(BASE + '/tickets?status=all');
  log('all tickets:', await page.$$eval('tbody tr', (r) => r.length));
  await page.screenshot({ path: `${OUT}/03-tickets.png` });

  // 8. Team: invite a person; dashboard.
  await page.goto(BASE + '/team');
  await page.fill('input[name=email]', 'New.Person@yrocconsulting.com');
  await page.click('button:has-text("Invite")');
  await page.waitForSelector('text=new.person@yrocconsulting.com');
  log('invite listed');
  await page.goto(BASE + '/');
  await page.screenshot({ path: `${OUT}/02-dashboard.png`, fullPage: true });
  await page.goto(BASE + '/onboarding');
  await page.screenshot({ path: `${OUT}/06-onboarding.png`, fullPage: true });

  // 9. Member: no Team page, cannot delete.
  await page.click('button:visible:has-text("Sign out")');
  await signIn(page, 'member@yroc.test');
  log('member nav has Team:', await page.isVisible('nav >> text=Team'));
  await page.goto(BASE + '/team');
  log('member /team ->', new URL(page.url()).pathname);
  await page.goto(ticketUrl);
  log('member sees delete:', await page.isVisible('text=Delete ticket'));

  // Mobile.
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
  const mp = await m.newPage();
  await mp.goto(ticketUrl);
  await mp.screenshot({ path: `${OUT}/07-mobile-ticket.png`, fullPage: true });
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  log('mobile horizontal overflow px:', overflow);

  log('browser errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
