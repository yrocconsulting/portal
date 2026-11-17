import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdmin, staffName } from "@/lib/auth";
import { avatarUrls } from "@/lib/avatars";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "../../profile/profile-form";

export const metadata: Metadata = { title: "Edit team member" };

export default async function EditStaffPage({ params }: PageProps<"/team/[id]">) {
  const me = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: person } = await supabase.from("staff").select("id, email, full_name, job_title, phone, avatar_path, role, active").eq("id", id).maybeSingle();
  if (!person) notFound();
  const urls = await avatarUrls([person.avatar_path]);
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="text-sm text-muted">
        <Link href="/team" className="hover:text-ink">
          Team
        </Link>{" "}
        / {staffName(person)}
      </div>
      <h1 className="text-2xl font-bold">{person.id === me.id ? "My profile" : staffName(person)}</h1>
      <div className="card p-6">
        <ProfileForm mode={person.id === me.id ? "self" : "admin"} person={person} photoUrl={person.avatar_path ? urls[person.avatar_path] ?? null : null} />
      </div>
      <p className="text-xs text-muted">They can also change these details themselves under My profile.</p>
    </div>
  );
}
