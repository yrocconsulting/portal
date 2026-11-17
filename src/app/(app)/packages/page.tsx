import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AddItem, ItemRow, NewPackage, PackageHeader, type PkgItem } from "./parts";

export const metadata: Metadata = { title: "Packages" };

export default async function PackagesPage({ searchParams }: PageProps<"/packages">) {
  await requireAdmin();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: packages }, { data: items }, { data: counts }] = await Promise.all([
    supabase.from("packages").select("*").order("position").order("name"),
    supabase.from("package_items").select("*").order("position"),
    supabase.from("clients").select("package_id").neq("status", "former").not("package_id", "is", null),
  ]);
  const selected = typeof sp.p === "string" ? sp.p : packages?.[0]?.id;
  const pkg = (packages ?? []).find((p) => p.id === selected);
  const its = ((items ?? []) as (PkgItem & { package_id: string })[]).filter((i) => i.package_id === pkg?.id);
  const sections = Array.from(new Set((items ?? []).map((i) => i.section).filter(Boolean))) as string[];
  const grouped = new Map<string, PkgItem[]>();
  for (const it of its) grouped.set(it.section ?? "Other", [...(grouped.get(it.section ?? "Other") ?? []), it]);
  const clientsOn = (id: string) => (counts ?? []).filter((c) => c.package_id === id).length;

  return (
    <div className="mx-auto max-w-[1440px] space-y-5">
      <div className="text-sm text-muted">
        <Link href="/reports" className="hover:text-ink">
          Monthly reports
        </Link>{" "}
        / Packages
      </div>
      <div>
        <h1 className="text-2xl font-bold">Packages and deliverables</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Each client is on a package. Every month their record is created from the package&apos;s deliverables. Changes here apply to new months only: past and
          archived months keep their own copy.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {(packages ?? []).map((p) => (
          <Link key={p.id} href={`/packages?p=${p.id}`} className={p.id === pkg?.id ? "btn-primary" : "btn-ghost"}>
            {p.name}
            <span className="text-xs opacity-70">{clientsOn(p.id)} clients</span>
          </Link>
        ))}
      </nav>

      {pkg && (
        <section className="card">
          <PackageHeader pkg={pkg} />
          {[...grouped.entries()].map(([section, list]) => (
            <div key={section} className="border-t border-line">
              <h3 className="bg-bg/60 px-4 py-2 text-xs font-semibold tracking-wide text-muted uppercase">{section}</h3>
              <ul className="divide-y divide-line">
                {list.map((it) => (
                  <ItemRow key={it.id} it={it} sections={sections} />
                ))}
              </ul>
            </div>
          ))}
          <div className="border-t border-line p-4">
            <AddItem packageId={pkg.id} sections={sections} />
          </div>
        </section>
      )}

      <NewPackage />
    </div>
  );
}
