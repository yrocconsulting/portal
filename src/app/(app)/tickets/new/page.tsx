import type { Metadata } from "next";
import { requireStaff, staffName } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TicketForm } from "./ticket-form";

export const metadata: Metadata = { title: "New ticket" };

export default async function NewTicketPage({ searchParams }: PageProps<"/tickets/new">) {
  const me = await requireStaff();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: staff }, { data: clients }, { data: contacts }] = await Promise.all([
    supabase.from("staff").select("id, full_name, email").eq("active", true).order("full_name"),
    supabase.from("clients").select("id, name").neq("status", "former").order("name"),
    supabase.from("contacts").select("id, name, client_id").order("name"),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">New ticket</h1>
      <TicketForm
        me={me.id}
        defaultClient={typeof sp.client === "string" ? sp.client : ""}
        staff={(staff ?? []).map((s) => ({ id: s.id, label: staffName(s) }))}
        clients={(clients ?? []).map((c) => ({ id: c.id, label: c.name }))}
        contacts={(contacts ?? []).map((c) => ({ id: c.id, label: c.name, client_id: c.client_id }))}
      />
    </div>
  );
}
