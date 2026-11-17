const TZ = "America/Chicago";

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  // Plain dates (YYYY-MM-DD) are calendar dates, not instants.
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
}

export function fmtDateTime(d: string): string {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function timeAgo(d: string): string {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(d);
}

/** Today in Central time as YYYY-MM-DD (the office is in Sherman, TX). */
export function todayCentral(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function isOverdue(due: string | null, status: string): boolean {
  return !!due && !["done", "closed"].includes(status) && due < todayCentral();
}

export function fmtBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Form helpers: empty strings become null. */
export function str(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function cleanDomain(v: string | null): string | null {
  if (!v) return null;
  return v.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim() || null;
}

/** YYYY-MM-DD for n days ago (UTC). */
export function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
