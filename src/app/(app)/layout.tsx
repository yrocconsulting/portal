import Image from "next/image";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { requireStaff, staffName } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireStaff();
  return (
    <div className="min-h-screen md:flex">
      <aside className="flex flex-col gap-4 bg-ink px-3 py-4 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:gap-6 md:py-6">
        <div className="flex items-center justify-between px-2 md:block">
          <Link href="/" className="block">
            <Image src="/logo-white.png" alt="Yroc Consulting" width={120} height={36} priority />
            <span className="mt-1 hidden text-[10px] font-semibold tracking-[0.2em] text-white/40 uppercase md:block">Portal</span>
          </Link>
          <form action="/auth/signout" method="post" className="md:hidden">
            <button className="text-xs text-white/60 hover:text-white">Sign out</button>
          </form>
        </div>
        <Nav isAdmin={me.role === "admin"} />
        <div className="mt-auto hidden border-t border-white/10 px-2 pt-4 md:block">
          <p className="truncate text-sm font-medium text-white">{staffName(me)}</p>
          <p className="truncate text-xs text-white/50">{me.email}</p>
          <form action="/auth/signout" method="post" className="mt-3">
            <button className="text-xs font-medium text-white/60 hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
