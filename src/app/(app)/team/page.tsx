import type { Metadata } from "next";
import { requireAdmin, staffName } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Staff } from "@/lib/types";
import { InviteForm, RevokeInvite, StaffControls } from "./parts";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const [{ data: staff }, { data: invites }] = await Promise.all([
    supabase.from("staff").select("id, email, full_name, role, active, created_at").order("active", { ascending: false }).order("full_name"),
    supabase.from("staff_invites").select("email, role, created_at").order("created_at"),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="mt-1 text-sm text-muted">Only invited email addresses can use the portal. Admins can invite people and delete tickets and clients.</p>
      </div>

      <section className="card">
        <h2 className="border-b border-line px-4 py-3 font-semibold">Invite someone</h2>
        <InviteForm />
        {(invites ?? []).length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {(invites ?? []).map((i) => (
              <li key={i.email} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span>
                  {i.email} <span className="text-xs text-muted">({i.role}, invited {fmtDate(i.created_at)}, not signed in yet)</span>
                </span>
                <RevokeInvite email={i.email} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="border-b border-line px-4 py-3 font-semibold">People</h2>
        <ul className="divide-y divide-line">
          {((staff ?? []) as (Staff & { created_at: string })[]).map((s) => (
            <li key={s.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm ${s.active ? "" : "opacity-60"}`}>
              <span>
                <span className="font-medium">{staffName(s)}</span>
                <span className="ml-2 text-muted">{s.email}</span>
                {!s.active && <span className="ml-2 text-xs font-semibold text-red-700">No access</span>}
              </span>
              {s.id === me.id ? <span className="text-xs text-muted">You ({s.role})</span> : <StaffControls id={s.id} role={s.role} active={s.active} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
