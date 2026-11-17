// Stand-in for Google's token endpoint and the Search Console API, for local tests.
// Run: node tests/mock-google.cjs <public-key.pem>   (port 4020)
// App settings: GSC_API_BASE=http://127.0.0.1:4020 GOOGLE_TOKEN_URL=http://127.0.0.1:4020/token
const http = require("http");
const fs = require("fs");
const { createVerify } = require("crypto");

const publicKey = fs.readFileSync(process.argv[2], "utf8");
const state = { tokens: 0, queries: 0 };

const sites = [
  { siteUrl: "sc-domain:frigiserve.com", permissionLevel: "siteRestrictedUser" },
  { siteUrl: "https://www.unlinked-client.example/", permissionLevel: "siteFullUser" },
  { siteUrl: "https://notverified.example/", permissionLevel: "siteUnverifiedUser" },
];

function days(start, end, site) {
  const out = [];
  for (let t = new Date(start).getTime(); t <= new Date(end).getTime(); t += 86400000) {
    const d = new Date(t);
    const i = Math.floor((t - new Date(start).getTime()) / 86400000);
    const base = site.includes("frigiserve") ? 20 : 5;
    const clicks = base + (i % 7) + Math.floor(i / 30); // grows slowly
    out.push({ keys: [d.toISOString().slice(0, 10)], clicks, impressions: clicks * 25, ctr: 0.04, position: 12 - Math.min(6, i / 60) });
  }
  return out;
}

const json = (res, code, data) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      if (req.method === "POST" && url.pathname === "/token") {
        const assertion = new URLSearchParams(body).get("assertion") || "";
        const [h, c, sig] = assertion.split(".");
        const ok = h && c && sig && createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
        const claims = ok ? JSON.parse(Buffer.from(c, "base64").toString()) : {};
        if (!ok || claims.scope !== "https://www.googleapis.com/auth/webmasters.readonly") return json(res, 400, { error: "invalid_grant", error_description: "bad assertion" });
        state.tokens++;
        return json(res, 200, { access_token: "gtok", expires_in: 3600 });
      }
      if (url.pathname === "/__state") return json(res, 200, state);
      if (req.headers.authorization !== "Bearer gtok") return json(res, 401, { error: { message: "no token" } });
      if (req.method === "GET" && url.pathname === "/webmasters/v3/sites") return json(res, 200, { siteEntry: sites });
      const m = url.pathname.match(/^\/webmasters\/v3\/sites\/(.+)\/searchAnalytics\/query$/);
      if (m && req.method === "POST") {
        state.queries++;
        const site = decodeURIComponent(m[1]);
        const q = JSON.parse(body);
        if (q.dimensions[0] === "date") return json(res, 200, { rows: days(q.startDate, q.endDate, site) });
        if (q.dimensions[0] === "query")
          return json(res, 200, { rows: [{ keys: ["blast freezing fort worth"], clicks: 120, impressions: 2400, ctr: 0.05, position: 3.2 }, { keys: ["cold storage dfw"], clicks: 80, impressions: 4000, ctr: 0.02, position: 7.9 }] });
        if (q.dimensions[0] === "page")
          return json(res, 200, { rows: [{ keys: ["https://frigiserve.com/blast-freezing/"], clicks: 150, impressions: 3000, ctr: 0.05, position: 4.1 }] });
      }
      json(res, 404, { error: { message: `mock: no route ${req.method} ${url.pathname}` } });
    });
  })
  .listen(4020, "127.0.0.1", () => console.log("mock google on :4020"));
