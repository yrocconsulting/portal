// Run: node --experimental-strip-types --test tests/capture.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMention, decodeCapture, mentionsOf, platformKey } from "../src/lib/capture.ts";

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

test("platform labels", () => {
  assert.equal(platformKey("AIO"), "aio");
  assert.equal(platformKey("AI Overviews"), "aio");
  assert.equal(platformKey("AI Mode"), "ai_mode");
  assert.equal(platformKey("ChatGPT"), "chatgpt");
  assert.equal(platformKey("Gemini"), "gemini");
  assert.equal(platformKey("Something"), null);
});

test("lead-in removed", () => {
  assert.equal(
    cleanMention("AI Overview AI Mode reply for AI Search company in Sherman TX Yroc Consulting, LLC is an AI search company.", "AI Search company in Sherman TX"),
    "Yroc Consulting, LLC is an AI search company.",
  );
  assert.equal(cleanMention("Would you like help contacting Yroc Consulting?", "x"), "Would you like help contacting Yroc Consulting?");
});

test("decode, with unicode", () => {
  const d = decodeCapture("#" + enc({ v: 1, platform: "AIO", prompt: "Roofers – Port Neches", mentions: [{ brand: "Droddy", content: "Droddy Roofing is rated 5.0 ★ by customers." }], links: ["https://droddyroofing.com/", "javascript:alert(1)"], text: "" }));
  assert.ok(d);
  assert.equal(d.prompt, "Roofers – Port Neches");
  assert.deepEqual(d.links, ["https://droddyroofing.com/"]);
  assert.deepEqual(mentionsOf(d), ["Droddy Roofing is rated 5.0 ★ by customers."]);
});

test("falls back to the pop-up text when there was no table", () => {
  const d = decodeCapture("#" + enc({ v: 1, platform: "ChatGPT", prompt: "p", mentions: [], links: [], text: "Mentions\nBrand Name\tContent\nAcme\tAcme Roofing is the best choice in town.\nAcme\tCall Acme Roofing today for a free quote." }));
  assert.deepEqual(mentionsOf(d!), ["Acme Roofing is the best choice in town.", "Call Acme Roofing today for a free quote."]);
});

test("garbage is rejected", () => {
  assert.equal(decodeCapture("#not-base64!!"), null);
  assert.equal(decodeCapture("#" + enc({ v: 2 })), null);
});

test("falls back to long lines when the pop-up isn't a table", () => {
  const d = decodeCapture("#" + enc({ v: 1, platform: "Gemini", prompt: "p", mentions: [], links: [], text: "Mentions\nBrand Name\nContent\nAcme\nAcme Roofing is a locally owned roofer with a 5.0 rating.\nAcme" }));
  assert.deepEqual(mentionsOf(d!), ["Acme Roofing is a locally owned roofer with a 5.0 rating."]);
});
