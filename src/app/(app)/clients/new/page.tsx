import type { Metadata } from "next";
import { requireStaff, staffName } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  const me = await requireStaff();
  const supabase = await createClient();
  const [{ data: packages }, { data: staff }] = await Promise.all([
    supabase.from("packages").select("id, name").eq("active", true).order("position"),
    supabase.from("staff").select("id, full_name, email").eq("active", true).order("full_name"),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">New client</h1>
      <div className="card p-6">
        <ClientForm isAdmin={me.role === "admin"} packages={packages ?? []} staff={(staff ?? []).map((s) => ({ id: s.id, name: staffName(s) }))} />
      </div>
    </div>
  );
}
