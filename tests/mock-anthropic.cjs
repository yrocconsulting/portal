// Stand-in for the Anthropic Messages API, for local tests. Run: node tests/mock-anthropic.cjs (port 4030)
// App settings: ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:4030
// Angles requests (structured output) get three angles. Draft requests first pause after a web fetch
// (stop_reason pause_turn), then return the piece, to exercise the resume loop.
const http = require("http");

const state = { requests: [] };
const usage = { input_tokens: 5000, output_tokens: 1500, cache_read_input_tokens: 0, cache_creation_input_tokens: 2000 };
const msg = (content, stop_reason) => ({
  id: "msg_" + Math.random().toString(36).slice(2),
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content,
  stop_reason,
  stop_sequence: null,
  usage,
});

function promptsFrom(text) {
  const block = text.split("<tracked_ai_prompts")[1]?.split("</tracked_ai_prompts>")[0] ?? "";
  return block
    .split("\n")
    .filter((l) => l.includes("% |"))
    .map((l) => l.split(" | ").slice(2).join(" | ").trim());
}

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.url === "/__state") return send(200, state);
      if (req.url === "/__reset") {
        state.requests = [];
        return send(200, { ok: true });
      }
      if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) return send(404, { type: "error", error: { type: "not_found_error", message: "nope" } });
      const body = JSON.parse(raw || "{}");
      state.requests.push({ headers: req.headers, body });
      const key = req.headers["x-api-key"] ?? (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (key !== "test-key") return send(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
      const user = typeof body.messages[0].content === "string" ? body.messages[0].content : JSON.stringify(body.messages[0].content);

      if (body.output_config?.format) {
        const p = promptsFrom(user);
        const angles = [0, 1, 2].map((i) => ({
          title: `Angle ${i + 1} title`,
          hook: `Hook number ${i + 1}`,
          why: `Visibility is low on this prompt (${i}% across platforms).`,
          target_prompts: [p[i] ?? `prompt ${i + 1}`],
          headline: `Working headline ${i + 1}`,
          needs: i === 0 ? ["Launch date"] : [],
        }));
        return send(200, msg([{ type: "text", text: JSON.stringify({ angles }) }], "end_turn"));
      }

      const resumed = body.messages.some((m) => m.role === "assistant");
      if (!resumed) {
        const domain = body.tools?.[0]?.allowed_domains?.[0] ?? "example.com";
        return send(
          200,
          msg(
            [
              { type: "text", text: "Let me read the site first." },
              { type: "server_tool_use", id: "srvtoolu_1", name: "web_fetch", input: { url: `https://${domain}/` } },
              {
                type: "web_fetch_tool_result",
                tool_use_id: "srvtoolu_1",
                content: {
                  type: "web_fetch_result",
                  url: `https://${domain}/`,
                  retrieved_at: new Date().toISOString(),
                  content: { type: "document", source: { type: "text", media_type: "text/plain", data: "Home page text" }, title: "Home", citations: null },
                },
              },
            ],
            "pause_turn",
          ),
        );
      }
      const headline = user.match(/Working headline: (.+)/)?.[1] ?? "Headline";
      const piece = `# ${headline}

FrigiServe Cold Storage adds blast freezing in Fort Worth.

FORT WORTH, TX ([[CONFIRM: release date]]) \u2014 FrigiServe Cold Storage today announced a new blast freezing service.

"We are proud of this," said [[CONFIRM: name, title, and that the quote is approved]].

## About FrigiServe Cold Storage

FrigiServe runs cold storage in DFW.

Media contact: [[CONFIRM: contact name, email, phone]]

## Notes for the team

- Target prompts: blast freezing near Fort Worth.
- To confirm: release date, quote, contact.
- Schema: NewsArticle.`;
      return send(200, msg([{ type: "text", text: piece }], "end_turn"));
    });
  })
  .listen(4030, "127.0.0.1", () => console.log("mock anthropic on 4030"));
