// A tiny stand-in for Microsoft login + Graph, for local tests of email intake.
// Run: node tests/mock-graph.cjs  (port 4010). Point the app at it with
// MS_GRAPH_BASE=http://127.0.0.1:4010 MS_LOGIN_BASE=http://127.0.0.1:4010
// Test controls: POST /__test/messages {from, fromName, subject, body, attachments?}, GET /__test/state
const http = require("http");

const state = { messages: [], sent: [], subscriptions: [], patches: 0 };
let seq = 0;

function json(res, code, data) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(data === undefined ? "" : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const p = decodeURIComponent(url.pathname);
    const body = await readBody(req);

    if (req.method === "POST" && p.endsWith("/oauth2/v2.0/token")) {
      const f = new URLSearchParams(body);
      if (f.get("client_secret") !== "test-secret") return json(res, 401, { error_description: "bad secret" });
      return json(res, 200, { access_token: "tok", expires_in: 3600 });
    }
    if (p.startsWith("/v1.0/") && req.headers.authorization !== "Bearer tok") return json(res, 401, { error: { message: "no token" } });

    if (p === "/__test/messages" && req.method === "POST") {
      const m = JSON.parse(body);
      const id = `msg-${++seq}`;
      state.messages.push({
        id,
        internetMessageId: `<${id}@test>`,
        subject: m.subject,
        from: { emailAddress: { name: m.fromName ?? null, address: m.from } },
        body: { contentType: "text", content: m.body },
        receivedDateTime: new Date(Date.now() + seq).toISOString(),
        hasAttachments: !!(m.attachments && m.attachments.length),
        internetMessageHeaders: m.authAs ? [{ name: "X-MS-Exchange-Organization-AuthAs", value: m.authAs }] : undefined,
        isRead: false,
        attachments: m.attachments ?? [],
      });
      return json(res, 200, { id });
    }
    if (p === "/__test/state") return json(res, 200, state);

    let m;
    if ((m = p.match(/^\/v1\.0\/users\/([^/]+)\/mailFolders\('Inbox'\)\/messages$/)) && req.method === "GET") {
      const unread = state.messages.filter((x) => !x.isRead).map(({ attachments, isRead, ...rest }) => rest);
      return json(res, 200, { value: unread });
    }
    if ((m = p.match(/^\/v1\.0\/users\/([^/]+)\/messages\/([^/]+)\/attachments$/))) {
      const msg = state.messages.find((x) => x.id === m[2]);
      return json(res, 200, { value: msg ? msg.attachments : [] });
    }
    if ((m = p.match(/^\/v1\.0\/users\/([^/]+)\/messages\/([^/]+)$/)) && req.method === "PATCH") {
      const msg = state.messages.find((x) => x.id === m[2]);
      if (msg) Object.assign(msg, JSON.parse(body));
      state.patches++;
      return json(res, 200, {});
    }
    if ((m = p.match(/^\/v1\.0\/users\/([^/]+)\/sendMail$/)) && req.method === "POST") {
      state.sent.push({ from: m[1], ...JSON.parse(body).message });
      return json(res, 202);
    }
    if (p === "/v1.0/subscriptions" && req.method === "POST") {
      const s = { id: `sub-${++seq}`, ...JSON.parse(body) };
      state.subscriptions.push(s);
      return json(res, 201, s);
    }
    if ((m = p.match(/^\/v1\.0\/subscriptions\/(.+)$/)) && req.method === "PATCH") {
      const s = state.subscriptions.find((x) => x.id === m[1]);
      if (!s) return json(res, 404, { error: { message: "not found" } });
      Object.assign(s, JSON.parse(body));
      return json(res, 200, s);
    }
    json(res, 404, { error: { message: `mock: no route ${req.method} ${p}` } });
  })
  .listen(4010, "127.0.0.1", () => console.log("mock graph on :4010"));
