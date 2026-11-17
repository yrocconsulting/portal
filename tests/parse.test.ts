// Run: node --experimental-strip-types --test tests/parse.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanSubject, parseForward, parseParty, ticketNumberFromSubject } from "../src/lib/email/parse.ts";

const OWN = ["yrocconsulting.com"];

test("Outlook desktop forward", () => {
  const body = `Can someone update the hours on their site? Thanks

Account Manager
Yroc Consulting

________________________________
From: Pat Example <pat@frigiserve.com>
Sent: Monday, November 16, 2026 3:12 PM
To: Account Manager <am@yrocconsulting.com>
Subject: Holiday hours

Hi, we're closed Thanksgiving Day.
Please update the site.

Pat`;
  const r = parseForward("FW: Holiday hours", body, OWN);
  assert.deepEqual(r.original, { name: "Pat Example", email: "pat@frigiserve.com" });
  assert.equal(r.subject, "Holiday hours");
  assert.match(r.note, /^Can someone update the hours/);
  assert.doesNotMatch(r.note, /From:/);
  assert.match(r.body, /^Hi, we're closed Thanksgiving Day\./);
  assert.equal(r.isForward, true);
});

test("Gmail forward with bold markers and quoted name", () => {
  const body = `---------- Forwarded message ---------
*From:* "Jane Q. Client" <Jane@Client.co>
Date: Mon, Nov 16, 2026 at 9:00 AM
Subject: Re: Reviews widget
To: <am@yrocconsulting.com>

The widget is broken on mobile.`;
  const r = parseForward("Fwd: Re: Reviews widget", body, OWN);
  assert.deepEqual(r.original, { name: "Jane Q. Client", email: "jane@client.co" });
  assert.equal(r.subject, "Reviews widget");
  assert.equal(r.note, "");
  assert.equal(r.body, "The widget is broken on mobile.");
});

test("Outlook web with mailto brackets", () => {
  const body = `See below.

From: Sam Owner [mailto:sam@bbq.com]
Sent: Tuesday
Subject: Menu PDF

New menu attached.`;
  const r = parseForward("FW: Menu PDF", body, OWN);
  assert.equal(r.original?.email, "sam@bbq.com");
  assert.equal(r.subject, "Menu PDF");
  assert.equal(r.note, "See below.");
});

test("skips our own address in nested forwards", () => {
  const body = `From: Account Manager <am@yrocconsulting.com>
Sent: Monday
Subject: FW: Question

From: Real Client <rc@acme.com>
Sent: Sunday
Subject: Question

Body here`;
  const r = parseForward("FW: FW: Question", body, OWN);
  assert.equal(r.original?.email, "rc@acme.com");
  assert.equal(r.subject, "Question");
});

test("not a forward", () => {
  const r = parseForward("Need help", "Plain message with no headers.", OWN);
  assert.equal(r.original, null);
  assert.equal(r.subject, "Need help");
  assert.equal(r.body, "Plain message with no headers.");
});

test("helpers", () => {
  assert.equal(cleanSubject("RE: FW: Fwd:  Hello "), "Hello");
  assert.equal(cleanSubject(""), "(no subject)");
  assert.equal(ticketNumberFromSubject("FW: Update [#1042] hours"), 1042);
  assert.equal(ticketNumberFromSubject("Ticket 1043 follow up"), 1043);
  assert.equal(ticketNumberFromSubject("Call me at #12"), null);
  assert.deepEqual(parseParty("Pat <PAT@x.com>"), { name: "Pat", email: "pat@x.com" });
  assert.equal(parseParty("no email here"), null);
});
