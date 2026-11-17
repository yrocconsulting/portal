import "server-only";
import ExcelJS from "exceljs";
import { cleanDomain } from "@/lib/format";

/**
 * Reads the client workbook: a "Clients" summary tab, a "Template" tab, one tab per client
 * (label in column A, value in column B), and a "Past Clients" divider after which every tab is a
 * former client. Login rows (usernames, passwords, hosting, registrar) are dropped here and never
 * leave this function. Columns beyond B are ignored.
 */

export type ImportRecord = {
  tab: string;
  name: string;
  status: "active" | "former";
  white_label: boolean;
  contact: { name: string | null; phone: string | null; email: string | null };
  phone: string | null;
  address: string | null;
  package: string | null;
  services: string[];
  payment_method: string | null;
  drive_url: string | null;
  locations: string | null;
  website: string | null;
  domain: string | null;
  industry: string | null;
  start_date: string | null;
  links: Record<string, string>;
  warnings: string[];
};

// Anything that looks like a credential is skipped, along with the rows of a login block.
const SECRET_LABEL = /(pass(word)?|user ?name|login|pin\b|secret|api ?key|token|security|2fa|recovery|hosting|registrar)/i;
const LOGIN_BLOCK = /^(website login|hosting|domain registrar)$/i;

const LINK_LABELS: [RegExp, string][] = [
  [/^gbp|google business/i, "gbp"],
  [/^facebook/i, "facebook"],
  [/^youtube/i, "youtube"],
  [/^linkedin/i, "linkedin"],
  [/^instagram/i, "instagram"],
  [/^(x|twitter)( link)?$/i, "x"],
  [/^yelp/i, "yelp"],
  [/^tiktok/i, "tiktok"],
];

function text(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; hyperlink?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("").trim() || null;
    if (typeof o.text === "string") return o.text.trim() || null;
    if (o.hyperlink) return o.hyperlink;
    if (o.result !== undefined) return text(o.result as ExcelJS.CellValue);
    return null;
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

function toDate(v: string | null): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function servicesFrom(...parts: (string | null)[]): string[] {
  const s = parts.filter(Boolean).join(" ").toLowerCase();
  const out: string[] = [];
  if (/ai (search )?optimi|aio\b|geo\b|aeo\b/.test(s)) out.push("AI Search Optimization");
  if (/\bseo\b/.test(s)) out.push("SEO");
  if (/facebook ads|meta ads|paid social/.test(s)) out.push("Facebook Ads");
  if (/reputation/.test(s)) out.push("Reputation Management");
  if (/website|web design/.test(s)) out.push("Website Design");
  return out;
}

export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s*-\s*white\s*label(ed)?\s*$/i, "")
    .replace(/\(.*?\)/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(llc|pllc|inc|incorporated|co|corp|company|ltd|pc|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

type Summary = { industry: string | null; services: string | null; drive: string | null; contact: string | null };

function readSummary(ws: ExcelJS.Worksheet | undefined): Map<string, Summary> {
  const out = new Map<string, Summary>();
  if (!ws) return out;
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const name = text(row.getCell(1).value);
    if (!name) return;
    out.set(normName(name), {
      contact: text(row.getCell(2).value),
      industry: text(row.getCell(3).value),
      services: text(row.getCell(4).value),
      drive: text(row.getCell(5).value),
    });
  });
  return out;
}

export async function readClientWorkbook(data: ArrayBuffer): Promise<ImportRecord[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const tabs = wb.worksheets;
  const summary = new Map([...readSummary(wb.getWorksheet("Clients")), ...readSummary(wb.getWorksheet("Past Clients"))]);
  const pastIdx = tabs.findIndex((t) => /^past clients$/i.test(t.name.trim()));

  const records: ImportRecord[] = [];
  tabs.forEach((ws, idx) => {
    const tab = ws.name.trim();
    if (/^(clients|template|past clients)$/i.test(tab)) return;

    const fields = new Map<string, string>();
    const extraLocations: string[] = [];
    let inLogin = false;
    let lastLabel = "";
    for (let r = 1; r <= Math.min(ws.rowCount, 200); r++) {
      const row = ws.getRow(r);
      const label = text(row.getCell(1).value)?.replace(/:\s*$/, "").trim() ?? "";
      const value = text(row.getCell(2).value);
      if (!label) {
        // Continuation rows: only collect them under Locations.
        if (lastLabel === "locations" && value && !inLogin) extraLocations.push(value);
        continue;
      }
      if (LOGIN_BLOCK.test(label)) {
        inLogin = true;
        lastLabel = "";
        continue;
      }
      if (SECRET_LABEL.test(label)) {
        lastLabel = "";
        continue;
      }
      inLogin = false;
      lastLabel = label.toLowerCase();
      if (value && !fields.has(lastLabel)) fields.set(lastLabel, value);
    }

    const f = (k: string) => fields.get(k) ?? null;
    // Names may end in "- White Label"; tab names are cut at 31 characters ("... - W").
    const WL_SUFFIX = /\s*-\s*white\s*label(ed)?\s*$/i;
    const rawName = f("business name");
    const tabName = tab.replace(WL_SUFFIX, "").replace(/\s*-\s*w(h(i(t(e)?)?)?)?\s*$/i, "");
    // A tab-only name like "Team (Contact Person)": the parenthetical is a person, not the business.
    const tabPerson = !rawName ? tabName.match(/\(([^)]+)\)\s*$/)?.[1] ?? null : null;
    const name = (rawName ?? tabName).replace(WL_SUFFIX, "").replace(tabPerson ? /\s*\([^)]+\)\s*$/ : /$^/, "").trim();
    const sum = summary.get(normName(name)) ?? summary.get(normName(tab)) ?? null;
    const warnings: string[] = [];

    const website = f("website url") ?? f("website");
    const links: Record<string, string> = {};
    for (const [k, v] of fields) {
      const hit = LINK_LABELS.find(([re]) => re.test(k));
      if (hit && /^https?:\/\//i.test(v) && !links[hit[1]]) links[hit[1]] = v;
    }

    const pkg = f("services/package") ?? f("services") ?? null;
    const whiteLabel = /white\s*label/i.test(tab) || /\s-\s*w(h(i(t(e)?)?)?)?\s*$/i.test(tab) || /white\s*label/i.test(rawName ?? "") || /white\s*label/i.test(sum?.services ?? "") || /white\s*label/i.test(pkg ?? "");
    const email = f("email")?.toLowerCase() ?? null;
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) warnings.push("Contact email doesn't look valid; skipped.");
    if (!fields.size) warnings.push("Tab is empty; only the name was imported.");

    records.push({
      tab,
      name,
      status: pastIdx >= 0 && idx > pastIdx ? "former" : "active",
      white_label: whiteLabel,
      contact: {
        name: f("primary contact name") ?? sum?.contact ?? tabPerson,
        phone: f("phone"),
        email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
      },
      phone: f("business phone") ?? f("business phone number"),
      address: f("address"),
      package: pkg,
      services: servicesFrom(pkg, sum?.services ?? null),
      payment_method: f("payment method"),
      drive_url: f("google drive") ?? sum?.drive ?? null,
      locations: [f("locations"), ...extraLocations].filter(Boolean).join("\n") || null,
      website: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website,
      domain: cleanDomain(website),
      industry: f("industry") ?? sum?.industry ?? null,
      start_date: toDate(f("start date")),
      links,
      warnings,
    });
  });
  // Two tabs with the same business name (e.g. two locations): keep both, name the second by its tab.
  const seen = new Map<string, number>();
  for (const r of records) {
    const k = normName(r.name);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    if (n > 1) {
      r.name = `${r.name} (${r.tab})`;
      r.warnings.push("Same business name as another tab; renamed using the tab name. Check it after import.");
    }
  }
  return records;
}
