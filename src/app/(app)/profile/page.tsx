import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { avatarUrls } from "@/lib/avatars";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "My profile" };

export default async function ProfilePage() {
  const me = await requireStaff();
  const urls = await avatarUrls([me.avatar_path]);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">My profile</h1>
        <p className="mt-1 text-sm text-muted">Shown to the team in the portal only. {me.role === "admin" ? "You're an admin." : ""}</p>
      </div>
      <div className="card p-6">
        <ProfileForm mode="self" person={me} photoUrl={me.avatar_path ? urls[me.avatar_path] ?? null : null} />
      </div>
    </div>
  );
}
