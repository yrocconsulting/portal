import Link from "next/link";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { staffName } from "@/lib/auth";
import { fmtDate, isOverdue, timeAgo } from "@/lib/format";
import type { TicketRow } from "@/lib/types";

export function TicketTable({
  tickets,
  empty = "No tickets.",
  hideClient = false,
  compact = false,
}: {
  tickets: TicketRow[];
  empty?: string;
  hideClient?: boolean;
  compact?: boolean;
}) {
  if (!tickets.length) {
    return <p className="px-4 py-8 text-center text-sm text-muted">{empty}</p>;
  }
  if (compact) {
    return (
      <ul className="divide-y divide-line">
        {tickets.map((t) => {
          const overdue = isOverdue(t.due_date, t.status);
          return (
            <li key={t.id}>
              <Link href={`/tickets/${t.number}`} className="group flex items-start justify-between gap-4 px-4 py-3 hover:bg-bg/60">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium group-hover:text-green-d">
                    <span className="mr-2 font-mono text-xs text-muted">#{t.number}</span>
                    {t.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {[t.client?.name, staffName(t.assignee)].filter(Boolean).join(" · ")}
                    {t.due_date && <span className={overdue ? "font-semibold text-red-700" : ""}> · due {fmtDate(t.due_date)}</span>}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <StatusBadge status={t.status} />
                  <PriorityBadge priority={t.priority} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
            <th className="px-4 py-2.5">Ticket</th>
            {!hideClient && <th className="px-4 py-2.5">Client</th>}
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Priority</th>
            <th className="px-4 py-2.5">Assignee</th>
            <th className="px-4 py-2.5">Due</th>
            <th className="px-4 py-2.5 text-right">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {tickets.map((t) => {
            const overdue = isOverdue(t.due_date, t.status);
            return (
              <tr key={t.id} className="group hover:bg-bg/60">
                <td className="max-w-md px-4 py-3">
                  <Link href={`/tickets/${t.number}`} className="block">
                    <span className="mr-2 font-mono text-xs text-muted">#{t.number}</span>
                    <span className="font-medium group-hover:text-green-d">{t.title}</span>
                  </Link>
                </td>
                {!hideClient && (
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {t.client ? (
                      <Link href={`/clients/${t.client.id}`} className="hover:text-ink">
                        {t.client.name}
                      </Link>
                    ) : (
                      "None"
                    )}
                  </td>
                )}
                <td className="px-4 py-3">
                  <StatusBadge status={t.status} />
                </td>
                <td className="px-4 py-3">
                  <PriorityBadge priority={t.priority} />
                </td>
                <td className={`whitespace-nowrap px-4 py-3 ${t.assignee ? "" : "text-muted italic"}`}>{staffName(t.assignee)}</td>
                <td className={`whitespace-nowrap px-4 py-3 ${overdue ? "font-semibold text-red-700" : "text-muted"}`}>
                  {t.due_date ? fmtDate(t.due_date) : ""}
                  {overdue && " (overdue)"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-muted">{timeAgo(t.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
