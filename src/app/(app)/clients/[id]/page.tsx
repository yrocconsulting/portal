import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { ConfirmButton } from "@/components/confirm-button";
import { TicketTable } from "@/components/ticket-table";
import { requireStaff, staffName } from "@/lib/auth";
import { TICKET_ROW } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { credentialsReady } from "@/lib/crypto";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { CLIENT_STATUS_LABEL, LINK_FIELDS, OPEN_STATUSES, type Client, type Contact, type Credential, type TicketRow } from "@/lib/types";
import { deleteClientRecord, setArchived } from "../actions";
import { ClientForm } from "../client-form";
import { AiVisibility } from "@/components/ai-visibility";
import { SearchConsole } from "@/components/search-console";
import { trackedDomain } from "@/lib/visibility";
import { monthLabel } from "@/lib/reports";
import { Credentials } from "./credentials";
import { AddContactForm, DeleteContact, OnboardingForm } from "./parts";

export async function generateMetadata({ params }: PageProps<"/clients/[id]">): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Client" };
}

export default async function ClientPage({ params, searchParams }: PageProps<"/clients/[id]">) {
  const me = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const showAll = sp.tickets === "all";
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: c } = await supabase.from("clients").select("*").eq("id", id).maybeSingle<Client>();
  if (!c) notFound();

  let tq = supabase.from("tickets").select(TICKET_ROW).eq("client_id", id).order("updated_at", { ascending: false }).limit(100);
  if (!showAll) tq = tq.in("status", OPEN_STATUSES);

  const [{ data: tickets }, { data: contacts }, { data: templates }, { data: staff }, { data: packages }, { data: monthly }, { data: credRows }, { data: views }] = await Promise.all([
    tq,
    supabase.from("contacts").select("*").eq("client_id", id).order("is_primary", { ascending: false }).order("name"),
    supabase.from("onboarding_templates").select("id, name, onboarding_steps(count)").order("name"),
    supabase.from("staff").select("id, full_name, email").eq("active", true).order("full_name"),
    supabase.from("packages").select("id, name").order("position"),
    supabase.from("monthly_reports").select("id, month, status").eq("client_id", id).order("month", { ascending: false }).limit(24),
    supabase.from("client_credentials").select("id, client_id, kind, label, url, username, notes, updated_at, password_enc").eq("client_id", id).order("kind"),
    supabase.from("credential_views").select("action, created_at, staff:staff(full_name, email), credential:client_credentials(label, kind)").eq("client_id", id).order("created_at", { ascending: false }).limit(15),
  ]);

  // Never send encrypted passwords to the browser: only whether one exists.
  const creds: Credential[] = (credRows ?? []).map(({ password_enc, ...r }) => ({ ...r, has_password: !!password_enc }));
  const log = (views ?? []).map((v) => {
    const who = staffName(v.staff as unknown as { full_name: string | null; email: string } | null);
    const what = (v.credential as unknown as { label: string | null; kind: string } | null)?.label ?? "a login";
    const verb = { reveal: "viewed the password for", create: "added", update: "changed", delete: "deleted" }[v.action as string] ?? v.action;
    return `${fmtDateTime(v.created_at)}: ${who} ${verb} ${what}`;
  });
  const links = LINK_FIELDS.filter(([k]) => c.links?.[k]);
  const details: [string, React.ReactNode][] = [
    ["Industry", c.industry],
    ...(me.role === "admin"
      ? ([["Monthly fee", c.monthly_fee !== null ? `$${Number(c.monthly_fee).toLocaleString("en-US", { maximumFractionDigits: 2 })}/mo` : "Not set"]] as [string, string][])
      : []),
    ["Start date", c.start_date ? fmtDate(c.start_date) : null],
    ["Payment", c.payment_method],
    ["Phone", c.phone],
    ["Address", c.address],
    ["Locations", c.locations],
  ].filter(([, v]) => v) as [string, React.ReactNode][];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="text-sm text-muted">
        <Link href="/clients" className="hover:text-ink">
          Clients
        </Link>{" "}
        / {c.name}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{c.name}</h1>
            {c.white_label && <WhiteLabelBadge />}
            {c.status === "former" && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold tracking-wider text-slate-700 uppercase">Archived</span>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {[
              CLIENT_STATUS_LABEL[c.status],
              c.city,
              c.domain,
              c.white_label && c.partner ? `through ${c.partner}` : null,
              c.lead_id ? `Lead: ${staffName((staff ?? []).find((s) => s.id === c.lead_id))}` : null,
              c.account_manager_id ? `Account manager: ${staffName((staff ?? []).find((s) => s.id === c.account_manager_id))}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Link href={`/tickets/new?client=${c.id}`} className="btn-green">
          + New ticket
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <section className="card">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-semibold">{showAll ? "All tickets" : "Open tickets"}</h2>
              <Link href={showAll ? `/clients/${c.id}` : `/clients/${c.id}?tickets=all`} className="text-sm text-green-d hover:underline">
                {showAll ? "Open only" : "Show all"}
              </Link>
            </header>
            <TicketTable tickets={(tickets ?? []) as TicketRow[]} hideClient empty="No open tickets for this client." />
          </section>


          <AiVisibility domain={trackedDomain(c)} clientId={c.id} />

          <SearchConsole client={c} />

          {(details.length > 0 || c.website || c.drive_url || links.length > 0) && (
            <section className="card p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                {c.website && (
                  <a href={c.website} target="_blank" rel="noreferrer" className="btn-ghost py-1 text-xs">
                    Website
                  </a>
                )}
                {c.drive_url && (
                  <a href={c.drive_url} target="_blank" rel="noreferrer" className="btn-ghost py-1 text-xs">
                    Google Drive
                  </a>
                )}
                {links.map(([k, label]) => (
                  <a key={k} href={c.links[k]} target="_blank" rel="noreferrer" className="btn-ghost py-1 text-xs">
                    {label}
                  </a>
                ))}
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {details.map(([k, v]) => (
                  <div key={k} className={k === "Locations" || k === "Address" ? "sm:col-span-2" : ""}>
                    <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{k}</dt>
                    <dd className="whitespace-pre-wrap">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <details className="card group" open={false}>
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold">
              Client details
              <span className="text-sm font-normal text-green-d group-open:hidden">Edit</span>
            </summary>
            <div className="border-t border-line p-4">
              <ClientForm isAdmin={me.role === "admin"} client={c} packages={packages ?? []} staff={(staff ?? []).map((s) => ({ id: s.id, name: staffName(s) }))} />
            </div>
          </details>

          {c.notes && (
            <section className="card p-4">
              <h2 className="mb-2 text-sm font-semibold">Notes</h2>
              <p className="whitespace-pre-wrap text-sm">{c.notes}</p>
            </section>
          )}
        </div>

        <aside className="space-y-6">
          <section className="card">
            <h2 className="border-b border-line px-4 py-3 font-semibold">Contacts</h2>
            {(contacts ?? []).length ? (
              <ul className="divide-y divide-line">
                {((contacts ?? []) as Contact[]).map((p) => (
                  <li key={p.id} className="px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {p.name}
                        {p.is_primary && <span className="ml-2 rounded bg-green/20 px-1.5 py-0.5 text-[10px] font-semibold text-green-d uppercase">Primary</span>}
                      </span>
                      <DeleteContact id={p.id} clientId={c.id} />
                    </div>
                    {p.title && <p className="text-xs text-muted">{p.title}</p>}
                    {p.email && (
                      <a href={`mailto:${p.email}`} className="block text-muted hover:text-ink">
                        {p.email}
                      </a>
                    )}
                    {p.phone && <p className="text-muted">{p.phone}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">No contacts yet.</p>
            )}
            <AddContactForm clientId={c.id} />
          </section>

          <section className="card">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-semibold">Monthly reports</h2>
              <Link href="/reports" className="text-sm text-green-d hover:underline">
                All clients
              </Link>
            </header>
            <p className="px-4 pt-3 text-xs text-muted">Package: {(packages ?? []).find((p) => p.id === c.package_id)?.name ?? "none set (choose one in Client details)"}</p>
            {(monthly ?? []).length ? (
              <ul className="divide-y divide-line">
                {(monthly ?? []).map((m) => (
                  <li key={m.id}>
                    <Link href={`/reports/${m.id}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-bg/60">
                      {monthLabel((m.month as string).slice(0, 7))}
                      <span className={`text-xs ${m.status === "complete" ? "text-green-d" : "text-amber-700"}`}>{m.status === "complete" ? "Archived" : "In progress"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">No monthly reports yet.</p>
            )}
          </section>

          <Credentials clientId={c.id} creds={creds} ready={credentialsReady()} log={log} />

          <section className="card p-4">
            <h2 className="mb-1 font-semibold">Onboarding</h2>
            <p className="mb-3 text-sm text-muted">Creates one ticket per checklist step, with due dates counted from today.</p>
            <OnboardingForm
              clientId={c.id}
              templates={(templates ?? []).map((t) => ({ id: t.id, name: t.name, steps: (t.onboarding_steps as unknown as { count: number }[])[0]?.count ?? 0 }))}
              staff={(staff ?? []).map((s) => ({ id: s.id, label: staffName(s) }))}
              defaultAssignee={c.lead_id ?? ""}
            />
          </section>

          {c.services.length > 0 && (
            <section className="card p-4">
              <h2 className="mb-2 font-semibold">Services</h2>
              <ul className="flex flex-wrap gap-1.5">
                {c.services.map((s) => (
                  <li key={s} className="rounded-full bg-bg px-2.5 py-1 text-xs font-medium">
                    {s}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <form action={setArchived}>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="archive" value={c.status === "former" ? "0" : "1"} />
            {c.status === "former" ? (
              <button className="btn-ghost w-full text-xs">Restore to active clients</button>
            ) : (
              <ConfirmButton message="Archive this client? They leave the active list, but their details, logins and tickets are kept." className="btn-ghost w-full text-xs">
                Archive client
              </ConfirmButton>
            )}
          </form>

          {me.role === "admin" && (
            <form action={deleteClientRecord}>
              <input type="hidden" name="id" value={c.id} />
              <ConfirmButton message="Permanently delete this client and all their details and logins? Their tickets stay but lose the client link. To keep the information, use Archive instead." className="btn-danger w-full text-xs">Delete client</ConfirmButton>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
