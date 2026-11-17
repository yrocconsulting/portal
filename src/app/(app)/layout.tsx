import Image from "next/image";
import Link from "next/link";
import { Nav } from "@/components/nav";
import { Avatar } from "@/components/avatar";
import { requireStaff, staffName } from "@/lib/auth";
import { avatarUrls } from "@/lib/avatars";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireStaff();
  const urls = await avatarUrls([me.avatar_path]);
  return (
    <div className="min-h-screen md:flex">
      <aside className="flex flex-col gap-4 bg-ink px-3 py-4 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:gap-6 md:py-6">
        <div className="flex items-center justify-between px-2 md:block">
          <Link href="/" className="block">
            <Image src="/logo-white.png" alt="Yroc Consulting" width={120} height={36} priority />
            <span className="mt-1 hidden text-[10px] font-semibold tracking-[0.2em] text-white/40 uppercase md:block">Portal</span>
          </Link>
          <span className="flex items-center gap-3 md:hidden">
            <Link href="/profile" aria-label="My profile">
              <Avatar name={staffName(me)} url={me.avatar_path ? urls[me.avatar_path] : null} size={28} />
            </Link>
            <form action="/auth/signout" method="post">
              <button className="text-xs text-white/60 hover:text-white">Sign out</button>
            </form>
          </span>
        </div>
        <Nav isAdmin={me.role === "admin"} />
        <div className="mt-auto hidden border-t border-white/10 px-2 pt-4 md:block">
          <Link href="/profile" className="group flex items-center gap-3" title="My profile">
            <Avatar name={staffName(me)} url={me.avatar_path ? urls[me.avatar_path] : null} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-white group-hover:text-green">{staffName(me)}</span>
              <span className="block truncate text-xs text-white/50">{me.job_title || me.email}</span>
            </span>
          </Link>
          <form action="/auth/signout" method="post" className="mt-3">
            <button className="text-xs font-medium text-white/60 hover:text-white">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
