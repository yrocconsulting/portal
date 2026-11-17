import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ClientForm } from "../client-form";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireStaff();
  const supabase = await createClient();
  const { data: packages } = await supabase.from("packages").select("id, name").eq("active", true).order("position");
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">New client</h1>
      <div className="card p-6">
        <ClientForm packages={packages ?? []} />
      </div>
    </div>
  );
}
