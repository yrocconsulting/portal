"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; icon: React.ReactNode };

const I = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  ticket: <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4zM13 5v14" />,
  clients: <path d="M3 21V7l9-4 9 4v14M9 21v-6h6v6M7 10h.01M12 10h.01M17 10h.01" />,
  onboarding: <path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />,
  team: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
};

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );
}

export function Nav({ isAdmin }: { isAdmin: boolean }) {
  const path = usePathname();
  const items: Item[] = [
    { href: "/", label: "Dashboard", icon: <Icon d={I.home} /> },
    { href: "/tickets", label: "Tickets", icon: <Icon d={I.ticket} /> },
    { href: "/clients", label: "Clients", icon: <Icon d={I.clients} /> },
    { href: "/onboarding", label: "Onboarding", icon: <Icon d={I.onboarding} /> },
    ...(isAdmin ? [{ href: "/team", label: "Team", icon: <Icon d={I.team} /> }] : []),
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((it) => {
        const active = it.href === "/" ? path === "/" : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={`flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span className={active ? "text-green" : ""}>{it.icon}</span>
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
