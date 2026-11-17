import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { requireAdmin, staffName } from "@/lib/auth";
import { avatarUrls } from "@/lib/avatars";
import { fmtDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { Staff } from "@/lib/types";
import { InviteForm, RevokeInvite, StaffControls } from "./parts";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const [{ data: staff }, { data: invites }] = await Promise.all([
    supabase.from("staff").select("id, email, full_name, role, active, created_at, job_title, phone, avatar_path").order("active", { ascending: false }).order("full_name"),
    supabase.from("staff_invites").select("email, role, created_at").order("created_at"),
  ]);

  const urls = await avatarUrls((staff ?? []).map((s) => s.avatar_path));
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
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={staffName(s)} url={s.avatar_path ? urls[s.avatar_path] : null} size={40} />
                <span className="min-w-0">
                  <span className="block font-medium">
                    {staffName(s)}
                    {!s.active && <span className="ml-2 text-xs font-semibold text-red-700">No access</span>}
                  </span>
                  <span className="block truncate text-xs text-muted">{[s.job_title, s.email, s.phone].filter(Boolean).join(" · ")}</span>
                </span>
              </span>
              <span className="flex items-center gap-3">
                <Link href={`/team/${s.id}`} className="text-xs font-medium text-green-d hover:underline">
                  Edit profile
                </Link>
                {s.id === me.id ? <span className="text-xs text-muted">You ({s.role})</span> : <StaffControls id={s.id} role={s.role} active={s.active} />}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
