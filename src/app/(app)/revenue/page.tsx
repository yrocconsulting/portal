import Link from "next/link";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { requireAdmin, staffName } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { monthLabel } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { CLIENT_STATUS_LABEL, type ClientStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Revenue" };

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Expected monthly revenue from client fees (admins only). Expected, not received: payments come later. */
export default async function RevenuePage() {
  await requireAdmin();
  const supabase = await createClient();
  await supabase.rpc("snapshot_revenue"); // keep this month's total current
  const [{ data: clients }, { data: staff }, { data: packages }, { data: months }, { data: changes }] = await Promise.all([
    supabase.from("clients").select("id, name, status, white_label, monthly_fee, lead_id, package_id, package, start_date").order("name"),
    supabase.from("staff").select("id, full_name, email"),
    supabase.from("packages").select("id, name, position, price_monthly"),
    supabase.from("revenue_months").select("*").order("month", { ascending: false }).limit(24),
    supabase.from("client_fee_history").select("client_id, old_fee, new_fee, changed_at, changed_by").order("changed_at", { ascending: false }).limit(15),
  ]);
  const all = clients ?? [];
  const live = all.filter((c) => c.status === "onboarding" || c.status === "active");
  const paused = all.filter((c) => c.status === "paused" && c.monthly_fee);
  const paying = live.filter((c) => c.monthly_fee !== null).sort((a, b) => Number(b.monthly_fee) - Number(a.monthly_fee));
  const missing = live.filter((c) => c.monthly_fee === null);
  const total = paying.reduce((a, c) => a + Number(c.monthly_fee), 0);
  const name = (id: string | null) => staffName((staff ?? []).find((s) => s.id === id)) || "No lead";
  const clientName = (id: string) => all.find((c) => c.id === id)?.name ?? "Deleted client";

  const group = (key: (c: (typeof paying)[number]) => string) => {
    const m = new Map<string, { total: number; count: number }>();
    for (const c of paying) {
      const k = key(c);
      const g = m.get(k) ?? { total: 0, count: 0 };
      g.total += Number(c.monthly_fee);
      g.count++;
      m.set(k, g);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  };
  const byPackage = group((c) => (packages ?? []).find((p) => p.id === c.package_id)?.name ?? "No package");
  const byLead = group((c) => (c.lead_id ? name(c.lead_id) : "No lead"));
  const prev = (months ?? [])[1];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Revenue</h1>
        <p className="mt-1 text-sm text-muted">
          What should come in each month from active and onboarding clients&apos; monthly fees. Admins only. Set a client&apos;s fee under Client details.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card p-5">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Expected per month</p>
          <p className="mt-1 font-display text-4xl font-bold">{usd(total)}</p>
          {prev && Number(prev.expected) !== total && (
            <p className={`text-sm font-semibold ${total > Number(prev.expected) ? "text-green-d" : "text-red-700"}`}>
              {total > Number(prev.expected) ? "▲" : "▼"} {usd(Math.abs(total - Number(prev.expected)))} vs {monthLabel((prev.month as string).slice(0, 7))}
            </p>
          )}
        </div>
        <div className="card p-5">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Per year at this rate</p>
          <p className="mt-1 font-display text-4xl font-bold">{usd(total * 12)}</p>
          <p className="text-sm text-muted">{paying.length ? `Average ${usd(Math.round(total / paying.length))} per client` : ""}</p>
        </div>
        <div className={`card p-5 ${missing.length ? "border-amber-300 bg-amber-50" : ""}`}>
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Fee not set</p>
          <p className="mt-1 font-display text-4xl font-bold">{missing.length}</p>
          <p className="text-sm text-muted">{missing.length ? "Active clients missing a monthly fee (listed below)" : "Every active client has a fee"}</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {[
          ["By package", byPackage],
          ["By lead", byLead],
        ].map(([title, rows]) => (
          <section key={title as string} className="card">
            <h2 className="border-b border-line px-4 py-3 font-semibold">{title as string}</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {(rows as [string, { total: number; count: number }][]).map(([k, g]) => (
                  <tr key={k}>
                    <td className="px-4 py-2.5">{k}</td>
                    <td className="px-4 py-2.5 text-right text-muted">
                      {g.count} client{g.count === 1 ? "" : "s"}
                    </td>
                    <td className="w-24 px-4 py-2.5">
                      <span className="block h-2 rounded-full bg-bg">
                        <span className="block h-2 rounded-full bg-green-d" style={{ width: `${total ? (g.total / total) * 100 : 0}%` }} />
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold">{usd(g.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <section className="card overflow-x-auto">
        <h2 className="border-b border-line px-4 py-3 font-semibold">Clients by monthly fee</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Client</th>
              <th className="px-4 py-2.5">Lead</th>
              <th className="px-4 py-2.5">Package</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5 text-right">Monthly fee</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {[...paying, ...missing].map((c) => (
              <tr key={c.id} className={c.monthly_fee === null ? "bg-amber-50/60" : ""}>
                <td className="px-4 py-2.5">
                  <Link href={`/clients/${c.id}`} className="flex items-center gap-2 font-medium hover:text-green-d">
                    {c.name}
                    {c.white_label && <WhiteLabelBadge />}
                  </Link>
                  {c.monthly_fee === null && c.package && <span className="text-xs text-muted">Sheet says: {c.package}</span>}
                </td>
                <td className="px-4 py-2.5 text-muted">{c.lead_id ? name(c.lead_id) : ""}</td>
                <td className="px-4 py-2.5 text-muted">{(packages ?? []).find((p) => p.id === c.package_id)?.name ?? ""}</td>
                <td className="px-4 py-2.5">{CLIENT_STATUS_LABEL[c.status as ClientStatus]}</td>
                <td className="px-4 py-2.5 text-right font-semibold">{c.monthly_fee === null ? <span className="text-amber-700">Not set</span> : usd(Number(c.monthly_fee))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink">
              <td className="px-4 py-3 font-semibold" colSpan={4}>
                Expected per month
              </td>
              <td className="px-4 py-3 text-right font-display text-lg font-bold">{usd(total)}</td>
            </tr>
          </tfoot>
        </table>
        {paused.length > 0 && (
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            Not counted (paused): {paused.map((c) => `${c.name} (${usd(Number(c.monthly_fee))})`).join(", ")}
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <h2 className="border-b border-line px-4 py-3 font-semibold">Month by month</h2>
          {(months ?? []).length ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {(months ?? []).map((m) => (
                  <tr key={m.month}>
                    <td className="px-4 py-2.5">{monthLabel((m.month as string).slice(0, 7))}</td>
                    <td className="px-4 py-2.5 text-right text-muted">{m.missing_fee ? `${m.missing_fee} without a fee` : ""}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">{usd(Number(m.expected))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-3 text-sm text-muted">Starts this month.</p>
          )}
          <p className="border-t border-line px-4 py-2 text-xs text-muted">Saved daily from client fees; each month keeps its last value.</p>
        </section>

        <section className="card">
          <h2 className="border-b border-line px-4 py-3 font-semibold">Recent fee changes</h2>
          {(changes ?? []).length ? (
            <ul className="divide-y divide-line text-sm">
              {(changes ?? []).map((ch, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span>
                    <span className="font-medium">{clientName(ch.client_id)}</span>
                    <span className="block text-xs text-muted">
                      {fmtDate(ch.changed_at)}
                      {ch.changed_by ? ` · ${name(ch.changed_by)}` : ""}
                    </span>
                  </span>
                  <span className="text-right text-muted">
                    {ch.old_fee === null ? "Set to " : `${usd(Number(ch.old_fee))} → `}
                    <b className="text-ink">{ch.new_fee === null ? "removed" : usd(Number(ch.new_fee))}</b>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-muted">No changes yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
