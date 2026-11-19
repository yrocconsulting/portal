import Link from "next/link";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { Avatar } from "@/components/avatar";
import { requireStaff, staffName } from "@/lib/auth";
import { avatarUrls } from "@/lib/avatars";
import { createClient } from "@/lib/supabase/server";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, OPEN_STATUSES, SERVICES, type Client } from "@/lib/types";

export const metadata: Metadata = { title: "Clients" };

const SORTS = ["name", "lead", "package", "domain", "industry", "status", "services", "tickets"] as const;
type SortKey = (typeof SORTS)[number];
const STATUS_ORDER = { onboarding: 0, active: 1, paused: 2, former: 3 } as const;

function Th({ href, active, desc, right = false, className = "", children }: { href: string; active: boolean; desc: boolean; right?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <th className={`px-4 py-2.5 ${right ? "text-right" : ""} ${className}`}>
      <Link href={href} className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-ink ${active ? "text-ink" : ""}`}>
        {children}
        <span className={active ? "" : "opacity-0"}>{desc ? "▼" : "▲"}</span>
      </Link>
    </th>
  );
}

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const me = await requireStaff();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "current";
  const lead = typeof sp.lead === "string" ? sp.lead : "";
  const service = typeof sp.service === "string" ? sp.service : "";
  const sort: SortKey = (SORTS as readonly string[]).includes(sp.sort as string) ? (sp.sort as SortKey) : "name";
  const desc = sp.dir === "desc";

  const supabase = await createClient();
  let query = supabase.from("clients").select("*").order("name");
  if (status === "current") query = query.in("status", ["onboarding", "active"]);
  else if (status !== "all") query = query.eq("status", status);
  if (lead === "me") query = query.eq("lead_id", me.id);
  else if (lead === "none") query = query.is("lead_id", null);
  else if (lead) query = query.eq("lead_id", lead);
  if (service) query = query.contains("services", [service]);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,domain.ilike.%${safe}%,city.ilike.%${safe}%,industry.ilike.%${safe}%`);
  }
  const [{ data: clients }, { data: open }, { data: staff }, { data: packages }] = await Promise.all([
    query,
    supabase.from("tickets").select("client_id").in("status", OPEN_STATUSES).not("client_id", "is", null),
    supabase.from("staff").select("id, full_name, email, avatar_path").eq("active", true).order("full_name"),
    supabase.from("packages").select("id, name, position"),
  ]);
  const pkg = (id: string | null) => (packages ?? []).find((p) => p.id === id);
  const photos = await avatarUrls((staff ?? []).map((s) => s.avatar_path));
  const person = (id: string | null) => (staff ?? []).find((s) => s.id === id);

  const openBy = new Map<string, number>();
  (open ?? []).forEach((t) => openBy.set(t.client_id as string, (openBy.get(t.client_id as string) ?? 0) + 1));

  // Sorting: by the chosen column, empty values always last, then by name.
  const value = (c: Client): string | number | null => {
    switch (sort) {
      case "lead":
        return c.lead_id ? staffName(person(c.lead_id)).toLowerCase() : null;
      case "package":
        return pkg(c.package_id)?.position ?? null;
      case "domain":
        return c.domain;
      case "industry":
        return (c.industry ?? c.city)?.toLowerCase() ?? null;
      case "status":
        return STATUS_ORDER[c.status];
      case "services":
        return c.services.length ? [...c.services].sort().join(", ").toLowerCase() : null;
      case "tickets":
        return openBy.get(c.id) ?? 0;
      default:
        return c.name.toLowerCase();
    }
  };
  const rows = [...((clients ?? []) as Client[])].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) {
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return desc ? -cmp : cmp;
    }
    return a.name.localeCompare(b.name);
  });
  const params = { q, status, lead, service };
  const sortLink = (key: SortKey) => {
    const u = new URLSearchParams(Object.entries(params).filter(([, v]) => v && !(v === "current")) as [string, string][]);
    if (status !== "current") u.set("status", status);
    if (key !== "name" || sort !== "name" || !desc) {
      u.set("sort", key);
      // Numbers start high-to-low (best first); text starts A to Z.
      const firstDesc = key === "tickets";
      if (sort === key ? !desc : firstDesc) u.set("dir", "desc");
    }
    if (key === "name" && sort === "name" && desc) u.delete("sort");
    return `/clients?${u}`;
  };
  const th = (k: SortKey) => ({ href: sortLink(k), active: sort === k, desc: sort === k && desc });

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Clients</h1>
        <div className="flex gap-2">
          {me.role === "admin" && (
            <Link href="/clients/import" className="btn-ghost">
              Import from sheet
            </Link>
          )}
          <Link href="/clients/new" className="btn-green">
            + New client
          </Link>
        </div>
      </div>

      <form className="card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        {sort !== "name" && <input type="hidden" name="sort" value={sort} />}
        {desc && <input type="hidden" name="dir" value="desc" />}
        <input name="q" defaultValue={q} placeholder="Search name, domain, city or industry" className="field" />
        <select name="status" defaultValue={status} className="field">
          <option value="current">Active clients</option>
          <option value="all">All clients</option>
          {CLIENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CLIENT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select name="lead" defaultValue={lead} className="field">
          <option value="">Any lead</option>
          <option value="me">My clients</option>
          <option value="none">No lead</option>
          {(staff ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {staffName(s)}
            </option>
          ))}
        </select>
        <select name="service" defaultValue={service} className="field">
          <option value="">Any service</option>
          {SERVICES.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <button className="btn-primary">Filter</button>
      </form>

      <section className="card overflow-x-auto">
        {rows.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <Th {...th("name")} className="min-w-64">
                  Client
                </Th>
                <Th {...th("lead")}>Lead</Th>
                <Th {...th("package")}>Package</Th>
                <Th {...th("domain")} className="hidden 2xl:table-cell">
                  Domain
                </Th>
                <Th {...th("industry")} className="hidden 2xl:table-cell">
                  Industry
                </Th>
                <Th {...th("status")}>Status</Th>
                <Th {...th("services")}>Services</Th>
                <Th {...th("tickets")} right>
                  <span title="Open tickets">Tickets</span>
                </Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-bg/60">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${c.id}`} className="flex items-center gap-2 font-medium hover:text-green-d">
                      {c.name}
                      {c.white_label && <WhiteLabelBadge />}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {(() => {
                      const p = person(c.lead_id);
                      return p ? (
                        <span className="flex items-center gap-2">
                          <Avatar name={staffName(p)} url={p.avatar_path ? photos[p.avatar_path] : null} size={22} />
                          {staffName(p).split(" ")[0]}
                        </span>
                      ) : (
                        <span className="text-muted/50">none</span>
                      );
                    })()}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{pkg(c.package_id)?.name.replace(/^Search /, "") ?? <span className="text-muted/50">none</span>}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-muted 2xl:table-cell">{c.domain}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-muted 2xl:table-cell">{c.industry ?? c.city}</td>
                  <td className="px-4 py-3">{CLIENT_STATUS_LABEL[c.status]}</td>
                  <td className="max-w-48 truncate px-4 py-3 text-muted" title={c.services.join(", ")}>
                    {c.services.join(", ")}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{openBy.get(c.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted">No clients match these filters.</p>
        )}
        {rows.length > 0 && (
          <footer className="border-t border-line px-4 py-2 text-xs text-muted">
            {rows.length} client{rows.length === 1 ? "" : "s"} · click a column heading to sort, click again to reverse
          </footer>
        )}
      </section>
    </div>
  );
}
