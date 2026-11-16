import { PRIORITY_LABEL, STATUS_LABEL, type TicketPriority, type TicketStatus } from "@/lib/types";

const STATUS_STYLE: Record<TicketStatus, string> = {
  new: "bg-sky-50 text-sky-800 ring-sky-200",
  in_progress: "bg-amber-50 text-amber-800 ring-amber-200",
  waiting: "bg-violet-50 text-violet-800 ring-violet-200",
  review: "bg-steel/10 text-steel ring-steel/30",
  done: "bg-green/15 text-green-d ring-green/40",
  closed: "bg-slate-100 text-slate-600 ring-slate-200",
};

const PRIORITY_STYLE: Record<TicketPriority, string> = {
  low: "text-slate-500",
  normal: "text-slate-700",
  high: "text-orange-700",
  urgent: "text-red-700 font-semibold",
};

const PRIORITY_DOT: Record<TicketPriority, string> = {
  low: "bg-slate-300",
  normal: "bg-slate-500",
  high: "bg-orange-500",
  urgent: "bg-red-600",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs ${PRIORITY_STYLE[priority]}`}>
      <span className={`h-2 w-2 rounded-full ${PRIORITY_DOT[priority]}`} />
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function WhiteLabelBadge() {
  return (
    <span
      title="White-label client: never name them on the website or in case studies."
      className="inline-flex items-center rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold tracking-wider text-green uppercase"
    >
      White label
    </span>
  );
}
