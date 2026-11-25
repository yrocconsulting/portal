// Stand-in for Google sign-in and the Business Profile APIs (port 4040). Point the portal at it with
// GBP_API_BASE=http://127.0.0.1:4040 GBP_AUTH_URL=http://127.0.0.1:4040/auth GBP_TOKEN_URL=http://127.0.0.1:4040/token.
// Two profiles: FrigiServe (frigiserve.com, matched by domain) and a bakery that isn't a client.
// Numbers grow month over month so the report section shows. POST /__test/review adds a new review.
const http = require("http");

const state = { tokens: 0, refreshes: 0, calls: [], reviews: { 1: [], 2: [] } };
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
state.reviews[1].push(
  { reviewId: "r1", reviewer: { displayName: "Dana K" }, starRating: "FIVE", comment: "Fast, clean, on time.", createTime: iso(40), updateTime: iso(39), reviewReply: { comment: "Thank you!", updateTime: iso(39) } },
  { reviewId: "r2", reviewer: { displayName: "Lee M" }, starRating: "FOUR", comment: "Good storage, parking is tight.", createTime: iso(20), updateTime: iso(20) },
  { reviewId: "r3", reviewer: { isAnonymous: true }, starRating: "FIVE", createTime: iso(5), updateTime: iso(5) },
);
state.reviews[2].push({ reviewId: "b1", reviewer: { displayName: "Sam" }, starRating: "FIVE", comment: "Great bread", createTime: iso(30), updateTime: iso(30) });

const LOCATIONS = [
  { name: "locations/1", title: "FrigiServe Cold Storage", websiteUri: "https://www.frigiserve.com/", storefrontAddress: { addressLines: ["100 Ice Rd"], locality: "Fort Worth", administrativeArea: "TX", postalCode: "76102" }, metadata: { mapsUri: "https://maps.google.com/?cid=1" } },
  { name: "locations/2", title: "Corner Bakery Test", websiteUri: "bakery.example", metadata: { mapsUri: "https://maps.google.com/?cid=2" } },
];

const send = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const dayNum = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);

http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      state.calls.push(`${req.method} ${u.pathname}`);
      if (u.pathname === "/__test/state") return send(res, 200, { tokens: state.tokens, refreshes: state.refreshes, calls: state.calls.length });
      if (u.pathname === "/__test/review" && req.method === "POST") {
        const r = JSON.parse(body || "{}");
        state.reviews[r.location ?? 1].unshift({ reviewId: r.id ?? `n${Date.now()}`, reviewer: { displayName: r.reviewer ?? "New Person" }, starRating: r.stars ?? "TWO", comment: r.comment ?? "Waited too long.", createTime: iso(0), updateTime: iso(0) });
        return send(res, 200, { ok: true });
      }
      // Google sign-in: send the browser straight back with a code.
      if (u.pathname === "/auth") {
        const back = new URL(u.searchParams.get("redirect_uri"));
        back.searchParams.set("code", "test-code");
        back.searchParams.set("state", u.searchParams.get("state"));
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      if (u.pathname === "/token") {
        const f = new URLSearchParams(body);
        if (f.get("grant_type") === "authorization_code") {
          if (f.get("code") !== "test-code") return send(res, 400, { error: "invalid_grant" });
          state.tokens++;
          return send(res, 200, { access_token: "at", refresh_token: "rt-test", expires_in: 3600, id_token: `${b64({ alg: "none" })}.${b64({ email: "yroc.manager@gmail.test" })}.sig` });
        }
        if (f.get("refresh_token") !== "rt-test") return send(res, 400, { error: "invalid_grant" });
        state.refreshes++;
        return send(res, 200, { access_token: "at", expires_in: 3600 });
      }
      if (req.headers.authorization !== "Bearer at") return send(res, 401, { error: { message: "no token" } });

      if (u.pathname === "/accounts/v1/accounts") return send(res, 200, { accounts: [{ name: "accounts/111", accountName: "Yroc", type: "PERSONAL" }] });
      if (u.pathname === "/info/v1/accounts/111/locations") {
        if (!u.searchParams.get("readMask")) return send(res, 400, { error: { message: "readMask required" } });
        return send(res, 200, { locations: LOCATIONS });
      }
      let m = u.pathname.match(/^\/performance\/v1\/locations\/(\d+):fetchMultiDailyMetricsTimeSeries$/);
      if (m) {
        const g = (k) => Number(u.searchParams.get(k));
        const start = dayNum(g("dailyRange.start_date.year"), g("dailyRange.start_date.month"), g("dailyRange.start_date.day"));
        const end = dayNum(g("dailyRange.end_date.year"), g("dailyRange.end_date.month"), g("dailyRange.end_date.day"));
        if (!start || !end) return send(res, 400, { error: { message: "dailyRange required" } });
        const loc = Number(m[1]);
        const series = u.searchParams.getAll("dailyMetric").length ? u.searchParams.getAll("dailyMetric") : u.searchParams.getAll("dailyMetrics");
        return send(res, 200, {
          multiDailyMetricTimeSeries: [
            {
              dailyMetricTimeSeries: series.map((metric) => ({
                dailyMetric: metric,
                timeSeries: {
                  datedValues: Array.from({ length: end - start + 1 }, (_, i) => {
                    const d = new Date((start + i) * 86400000);
                    // Grows by about one a day per month, so this month beats last month.
                    const v = loc * (metric === "CALL_CLICKS" ? 2 : metric.startsWith("BUSINESS_IMPRESSIONS") ? 10 : 1) + Math.floor((start + i) / 30) - 690;
                    const date = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
                    return v > 0 && metric !== "BUSINESS_BOOKINGS" ? { date, value: String(v) } : { date }; // zero values have no "value"
                  }),
                },
              })),
            },
          ],
        });
      }
      m = u.pathname.match(/^\/performance\/v1\/locations\/(\d+)\/searchkeywords\/impressions\/monthly$/);
      if (m) {
        return send(res, 200, {
          searchKeywordsCounts: [
            { searchKeyword: "cold storage fort worth", insightsValue: { value: "180" } },
            { searchKeyword: "frigiserve", insightsValue: { value: "95" } },
            { searchKeyword: "blast freezing near me", insightsValue: { threshold: "15" } },
          ],
        });
      }
      m = u.pathname.match(/^\/v4\/v4\/accounts\/111\/locations\/(\d+)\/reviews$/);
      if (m) {
        const list = state.reviews[m[1]] ?? [];
        const avg = list.length ? list.reduce((s, r) => s + { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }[r.starRating], 0) / list.length : 0;
        return send(res, 200, {
          reviews: list.map((r) => ({ ...r, name: `accounts/111/locations/${m[1]}/reviews/${r.reviewId}` })),
          averageRating: avg,
          totalReviewCount: list.length,
        });
      }
      send(res, 404, { error: { message: `mock-gbp: no route ${u.pathname}` } });
    });
  })
  .listen(4040, "127.0.0.1", () => console.log("mock-gbp on 4040"));
