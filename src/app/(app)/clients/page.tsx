import Link from "next/link";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { Avatar } from "@/components/avatar";
import { requireStaff, staffName } from "@/lib/auth";
import { avatarUrls } from "@/lib/avatars";
import { createClient } from "@/lib/supabase/server";
import { trackedDomain } from "@/lib/visibility";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, OPEN_STATUSES, type Client } from "@/lib/types";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const me = await requireStaff();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = typeof sp.status === "string" ? sp.status : "current";
  const lead = typeof sp.lead === "string" ? sp.lead : "";

  const supabase = await createClient();
  let query = supabase.from("clients").select("*").order("name");
  if (status === "current") query = query.in("status", ["onboarding", "active"]);
  else if (status !== "all") query = query.eq("status", status);
  if (lead === "me") query = query.eq("lead_id", me.id);
  else if (lead === "none") query = query.is("lead_id", null);
  else if (lead) query = query.eq("lead_id", lead);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,domain.ilike.%${safe}%,city.ilike.%${safe}%,industry.ilike.%${safe}%`);
  }
  const [{ data: clients }, { data: open }, { data: latest }, { data: staff }] = await Promise.all([
    query,
    supabase.from("tickets").select("client_id").in("status", OPEN_STATUSES).not("client_id", "is", null),
    supabase.from("prt_reports").select("report_date").order("report_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("staff").select("id, full_name, email, avatar_path").eq("active", true).order("full_name"),
  ]);
  const photos = await avatarUrls((staff ?? []).map((s) => s.avatar_path));
  const person = (id: string | null) => (staff ?? []).find((s) => s.id === id);
  const { data: vis } = latest
    ? await supabase.from("prt_site_results").select("domain, visibility").eq("report_date", latest.report_date)
    : { data: [] as { domain: string; visibility: number }[] };
  const visBy = new Map((vis ?? []).map((v) => [v.domain, v.visibility]));

  const openBy = new Map<string, number>();
  (open ?? []).forEach((t) => openBy.set(t.client_id as string, (openBy.get(t.client_id as string) ?? 0) + 1));

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

      <form className="card grid gap-3 p-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
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
        <button className="btn-primary">Filter</button>
      </form>

      <section className="card overflow-x-auto">
        {(clients ?? []).length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <th className="min-w-72 px-4 py-2.5">Client</th>
                <th className="px-4 py-2.5">Lead</th>
                <th className="px-4 py-2.5">Domain</th>
                <th className="px-4 py-2.5">Industry</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Services</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right">AI visibility</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right">Open tickets</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {((clients ?? []) as Client[]).map((c) => (
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
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{c.domain}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{c.industry ?? c.city}</td>
                  <td className="px-4 py-3">{CLIENT_STATUS_LABEL[c.status]}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-muted" title={c.services.join(", ")}>
                    {c.services.join(", ")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(() => {
                      const v = visBy.get(trackedDomain(c) ?? "");
                      return v === undefined ? <span className="text-muted/50">none</span> : <Link href={`/clients/${c.id}#ai-visibility`} className="hover:text-green-d">{v}%</Link>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{openBy.get(c.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-muted">No clients yet.</p>
        )}
      </section>
    </div>
  );
}
