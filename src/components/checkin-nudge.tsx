"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { answerCheckin } from "@/app/(app)/checkins/actions";
import { answerPressRelease } from "@/app/(app)/checkins/pr-actions";

type Kind = "checkin" | "press_release";

const COPY: Record<Kind, { yes: string; no: string; thanksYes: string; thanksNo: string; ariaYes: string; ariaNo: string }> = {
  checkin: {
    yes: "👍 Yes",
    no: "👎 Not yet",
    thanksYes: "Thanks! Noted.",
    thanksNo: "No problem, I'll ask again in a few days.",
    ariaYes: "Yes, I've been in touch",
    ariaNo: "Not yet, remind me in a few days",
  },
  press_release: {
    yes: "👍 Submitted",
    no: "👎 Not yet",
    thanksYes: "Nice! Ticked on this month's report.",
    thanksNo: "No problem, I'll ask again in a couple of days.",
    ariaYes: "Yes, the press release is submitted",
    ariaNo: "Not yet, remind me in a couple of days",
  },
};

/** A small speech bubble over a client's name with thumbs up / down: a check-in or this month's press release. */
export function CheckinNudge({ kind = "checkin", clientId, clientName, daysSince }: { kind?: Kind; clientId: string; clientName: string; daysSince: number | null }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<null | "yes" | "no">(null);
  const [reportId, setReportId] = useState<string | undefined>();
  const copy = COPY[kind];
  if (done) {
    return (
      <p className="absolute top-full left-0 z-20 mt-2 w-max max-w-64 rounded-lg bg-ink px-3 py-1.5 text-xs text-white shadow-lg" role="status">
        {done === "yes" ? copy.thanksYes : copy.thanksNo}
        {done === "yes" && reportId && (
          <>
            {" "}
            <Link href={`/reports/${reportId}`} className="underline hover:text-green">
              Add the link
            </Link>
          </>
        )}
      </p>
    );
  }
  const answer = (a: "yes" | "no") =>
    start(async () => {
      setDone(a);
      if (kind === "press_release") setReportId((await answerPressRelease(clientId, a)).reportId);
      else await answerCheckin(clientId, a);
    });
  const label = kind === "press_release" ? `Press release for ${clientName}` : `Check in with ${clientName}`;
  return (
    <div className="absolute top-full left-0 z-20 mt-3 w-64 rounded-xl bg-ink p-3 text-white shadow-xl shadow-ink/25" role="dialog" aria-label={label}>
      {kind === "press_release" ? (
        <>
          <p className="text-sm leading-snug">
            Has <b>{clientName}</b> had their press release this month?
          </p>
          <p className="mt-0.5 text-xs text-white/60">Nothing on the PR task in this month&apos;s report yet.</p>
        </>
      ) : (
        <>
          <p className="text-sm leading-snug">
            Checked in with <b>{clientName}</b> lately?
          </p>
          <p className="mt-0.5 text-xs text-white/60">{daysSince === null ? "No contact logged yet." : `Last contact ${daysSince} day${daysSince === 1 ? "" : "s"} ago.`}</p>
        </>
      )}
      <div className="mt-2 flex gap-2">
        <button disabled={pending} onClick={() => answer("yes")} className="flex-1 rounded-lg bg-green px-2 py-1 text-sm font-semibold text-ink hover:brightness-95" aria-label={copy.ariaYes}>
          {copy.yes}
        </button>
        <button disabled={pending} onClick={() => answer("no")} className="flex-1 rounded-lg bg-white/10 px-2 py-1 text-sm font-semibold hover:bg-white/20" aria-label={copy.ariaNo}>
          {copy.no}
        </button>
      </div>
      {/* the bubble's tail, pointing up at the client's name */}
      <span className="absolute bottom-full left-6 h-0 w-0 border-x-8 border-b-8 border-x-transparent border-b-ink" />
    </div>
  );
}
