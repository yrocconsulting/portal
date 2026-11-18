/** Pure helpers for reading forwarded emails (Outlook, Outlook on the web, Gmail, Apple Mail). */

export type Party = { name: string | null; email: string };

export type ParsedForward = {
  /** The person who originally wrote the email (the client), when found. */
  original: Party | null;
  /** The original subject, without FW:/Fwd: prefixes. */
  subject: string;
  /** What the forwarder wrote above the forwarded message. */
  note: string;
  /** The forwarded message body (or the whole body when it was not a forward). */
  body: string;
  isForward: boolean;
};

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const HEADER_RE = /^\s*[*_]*(from|von|de)\s*:[*_]*\s*(.*)$/i;
const SEPARATORS = [
  /^-{2,}\s*(original message|forwarded message)\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
  /^begin forwarded message:\s*$/i,
  /^-{5,}\s*$/,
];

export function cleanSubject(s: string | null | undefined): string {
  let out = (s ?? "").trim();
  // Strip any number of leading FW:/Fwd:/RE: prefixes.
  for (;;) {
    const next = out.replace(/^\s*(fw|fwd|re|aw|wg)\s*:\s*/i, "");
    if (next === out) break;
    out = next;
  }
  return out.trim() || "(no subject)";
}

/** "#1042" or "[#1042]" or "Ticket 1042" in a subject. */
export function ticketNumberFromSubject(subject: string | null | undefined): number | null {
  const m = (subject ?? "").match(/(?:#|ticket\s+#?)(\d{3,7})\b/i);
  return m ? Number(m[1]) : null;
}

export function parseParty(raw: string): Party | null {
  const mailto = raw.match(/\[mailto:([^\]\s]+)\]/i)?.[1];
  const text = raw.replace(/[*_]/g, " ").replace(/\[mailto:[^\]]*\]/gi, "").trim();
  const angle = text.match(/<\s*(?:mailto:)?([^>\s]+@[^>\s]+)\s*>/i);
  const email = (angle?.[1] ?? mailto ?? text.match(EMAIL_RE)?.[0] ?? "").toLowerCase().replace(/^mailto:/, "");
  if (!email || !EMAIL_RE.test(email)) return null;
  let name = (angle ? text.slice(0, text.indexOf(angle[0])) : text.replace(email, "")).replace(/["'<>()]/g, "").trim();
  if (!name || name.toLowerCase() === email) name = "";
  return { name: name || null, email };
}

/**
 * Splits a forwarded email into the forwarder's note and the original message.
 * `ownDomains` are skipped when guessing the original sender (so the forwarder is never taken as the client).
 */
export function parseForward(subject: string, body: string, ownDomains: string[] = []): ParsedForward {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const own = ownDomains.map((d) => d.toLowerCase());
  const isOwn = (p: Party | null) => !!p && own.some((d) => p.email.endsWith("@" + d));

  // Find the first header block: an optional separator line followed (soon) by a From: line.
  let fromIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADER_RE);
    if (!m) continue;
    const party = parseParty(m[2]) ?? parseParty(lines[i + 1] ?? "");
    // Accept the first From: that is not one of our own addresses, else keep looking.
    if (party && !isOwn(party)) {
      fromIdx = i;
      break;
    }
    if (fromIdx < 0 && party) fromIdx = i;
  }

  const fwdSubject = /^\s*(fw|fwd)\s*:/i.test(subject);
  if (fromIdx < 0) {
    return { original: null, subject: cleanSubject(subject), note: "", body: body.trim(), isForward: fwdSubject };
  }

  // Note = everything above the separator (or above the From: line).
  let noteEnd = fromIdx;
  for (let j = fromIdx - 1; j >= Math.max(0, fromIdx - 3); j--) {
    if (SEPARATORS.some((re) => re.test(lines[j].trim()))) {
      noteEnd = j;
      break;
    }
  }
  const note = lines.slice(0, noteEnd).join("\n").trim();

  // Header block: the From: line plus the "Name: value" lines right after it (Sent, Date, To, Cc, Subject).
  const m = lines[fromIdx].match(HEADER_RE)!;
  const original = parseParty(m[2]) ?? parseParty(lines[fromIdx + 1] ?? "");
  let origSubject = "";
  let k = fromIdx + 1;
  for (; k < Math.min(lines.length, fromIdx + 15); k++) {
    const line = lines[k].replace(/[*_]/g, "").trim();
    if (line === "") break;
    const sm = line.match(/^(subject|betreff|asunto)\s*:\s*(.*)$/i);
    if (sm) origSubject = sm[2];
    else if (!/^[A-Za-z][\w -]{0,20}:/.test(line) && !parseParty(line)) break;
  }
  while (k < lines.length && lines[k].trim() === "") k++;
  const origBody = lines.slice(k).join("\n").trim();

  return {
    original: original && !isOwn(original) ? original : null,
    subject: cleanSubject(origSubject || subject),
    note,
    body: origBody,
    isForward: true,
  };
}

/** Trims a long body for storage in a ticket description. */
export function clip(text: string, max = 20000): string {
  return text.length > max ? text.slice(0, max) + "\n\n[trimmed]" : text;
}

export type ClientRef = { id: string; name: string; domain: string | null; tracking_domain?: string | null };

const LEGAL_SUFFIX = /[\s,]+(llc|l\.l\.c\.?|inc\.?|incorporated|co\.?|company|corp\.?|corporation|ltd\.?|pllc|llp|lp)$/i;

/** Lowercase words separated by single spaces; keeps dots inside words so domains survive. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/\bwww\./g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\.(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The ways a client is written in an email: full name, name without LLC/Inc, its domains. */
export function clientKeys(c: ClientRef): string[] {
  const keys = new Set<string>();
  const name = normalize(c.name);
  keys.add(name);
  keys.add(normalize(c.name.replace(LEGAL_SUFFIX, "")));
  for (const d of [c.domain, c.tracking_domain]) {
    if (!d) continue;
    const dom = normalize(d);
    keys.add(dom);
    const stem = dom.split(".")[0];
    if (stem.length >= 6) keys.add(stem);
  }
  return [...keys].filter((k) => k.length >= 4);
}

/**
 * Finds the one client named in the email, checking each text in order (subject first). A client
 * whose name contains another's wins ("Atlas Real Estate Inspections" over "Atlas"). If two
 * unrelated clients are named in the same place, nothing is guessed.
 */
export function findClientInText(texts: (string | null | undefined)[], clients: ClientRef[]): ClientRef | null {
  const keyed = clients.map((c) => ({ c, keys: clientKeys(c) }));
  for (const t of texts) {
    if (!t) continue;
    const hay = ` ${normalize(t)} `;
    const hits = keyed
      .map(({ c, keys }) => ({ c, key: keys.filter((k) => hay.includes(` ${k} `)).sort((a, b) => b.length - a.length)[0] }))
      .filter((h): h is { c: ClientRef; key: string } => !!h.key)
      .sort((a, b) => b.key.length - a.key.length);
    if (!hits.length) continue;
    const [top, ...rest] = hits;
    return rest.every((h) => h.key.length < top.key.length && ` ${top.key} `.includes(` ${h.key} `)) ? top.c : null;
  }
  return null;
}
