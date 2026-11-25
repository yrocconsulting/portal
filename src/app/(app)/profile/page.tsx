import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { avatarUrls } from "@/lib/avatars";
import { NOTIFICATION_KINDS } from "@/lib/notify";
import { createClient } from "@/lib/supabase/server";
import { NotificationSettings } from "./notifications";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const me = await requireStaff();
  const urls = await avatarUrls([me.avatar_path]);
  const db = await createClient();
  const { data: prefs } = await db.from("staff").select("notify_assigned, notify_client_reply, notify_new_review").eq("id", me.id).single();
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">My profile</h1>
        <p className="mt-1 text-sm text-muted">Shown to the team in the portal only. {me.role === "admin" ? "You're an admin." : ""}</p>
      </div>
      <div className="card p-6">
        <ProfileForm mode="self" person={me} photoUrl={me.avatar_path ? urls[me.avatar_path] ?? null : null} />
      </div>
      <section className="card p-6" id="emails">
        <h2 className="font-semibold">Email me when</h2>
        <p className="mb-2 text-sm text-muted">Sent to {me.email} from the portal&apos;s no-reply address. Never about something you did yourself.</p>
        <NotificationSettings
          options={NOTIFICATION_KINDS.map(([kind, label, col]) => ({ kind, label, on: (prefs as Record<string, boolean> | null)?.[col] ?? true }))}
        />
      </section>
    </div>
  );
}
