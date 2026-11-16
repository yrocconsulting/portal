import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { WhiteLabelBadge } from "@/components/badges";
import { ConfirmButton } from "@/components/confirm-button";
import { TicketTable } from "@/components/ticket-table";
import { requireStaff, staffName } from "@/lib/auth";
import { TICKET_ROW } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { CLIENT_STATUS_LABEL, OPEN_STATUSES, type Client, type Contact, type TicketRow } from "@/lib/types";
import { deleteClientRecord } from "../actions";
import { ClientForm } from "../client-form";
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

  const [{ data: tickets }, { data: contacts }, { data: templates }, { data: staff }] = await Promise.all([
    tq,
    supabase.from("contacts").select("*").eq("client_id", id).order("is_primary", { ascending: false }).order("name"),
    supabase.from("onboarding_templates").select("id, name, onboarding_steps(count)").order("name"),
    supabase.from("staff").select("id, full_name, email").eq("active", true).order("full_name"),
  ]);

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
          </div>
          <p className="mt-1 text-sm text-muted">
            {[CLIENT_STATUS_LABEL[c.status], c.city, c.domain, c.white_label && c.partner ? `through ${c.partner}` : null].filter(Boolean).join(" · ")}
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

          <details className="card group" open={false}>
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold">
              Client details
              <span className="text-sm font-normal text-green-d group-open:hidden">Edit</span>
            </summary>
            <div className="border-t border-line p-4">
              <ClientForm client={c} />
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

          <section className="card p-4">
            <h2 className="mb-1 font-semibold">Onboarding</h2>
            <p className="mb-3 text-sm text-muted">Creates one ticket per checklist step, with due dates counted from today.</p>
            <OnboardingForm
              clientId={c.id}
              templates={(templates ?? []).map((t) => ({ id: t.id, name: t.name, steps: (t.onboarding_steps as unknown as { count: number }[])[0]?.count ?? 0 }))}
              staff={(staff ?? []).map((s) => ({ id: s.id, label: staffName(s) }))}
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

          {me.role === "admin" && (
            <form action={deleteClientRecord}>
              <input type="hidden" name="id" value={c.id} />
              <ConfirmButton message="Delete this client? Their tickets stay but lose the client link." className="btn-danger w-full text-xs">Delete client</ConfirmButton>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
