"use client";

import { useTransition } from "react";
import { completeReport, refreshReportResults, reopenReport } from "../actions";

export function ReportButtons({ id, status, isAdmin }: { id: string; status: string; isAdmin: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <a href={`/reports/${id}/print`} target="_blank" className="btn-ghost">
        Print / PDF
      </a>
      {status !== "complete" && (
        <>
          <button className="btn-ghost" disabled={pending} onClick={() => start(() => refreshReportResults(id))}>
            Refresh results
          </button>
          <button
            className="btn-primary"
            disabled={pending}
            onClick={() => {
              if (confirm("Mark this month complete? Save first. It will be archived read-only; an admin can reopen it.")) start(() => completeReport(id));
            }}
          >
            Mark complete
          </button>
        </>
      )}
      {status === "complete" && isAdmin && (
        <button className="btn-ghost" disabled={pending} onClick={() => start(() => reopenReport(id))}>
          Reopen for editing
        </button>
      )}
    </div>
  );
}
