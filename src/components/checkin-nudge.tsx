"use client";

import { useState, useTransition } from "react";
import { answerCheckin } from "@/app/(app)/checkins/actions";

/** A small speech bubble over a client's name: "Checked in lately?" with thumbs up / down. */
export function CheckinNudge({ clientId, clientName, daysSince }: { clientId: string; clientName: string; daysSince: number | null }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<null | "yes" | "no">(null);
  if (done) {
    return (
      <p className="absolute top-full left-0 z-20 mt-2 w-max max-w-64 rounded-lg bg-ink px-3 py-1.5 text-xs text-white shadow-lg" role="status">
        {done === "yes" ? "Thanks! Noted." : "No problem, I'll ask again in a few days."}
      </p>
    );
  }
  const answer = (a: "yes" | "no") =>
    start(async () => {
      setDone(a);
      await answerCheckin(clientId, a);
    });
  return (
    <div className="absolute top-full left-0 z-20 mt-3 w-64 rounded-xl bg-ink p-3 text-white shadow-xl shadow-ink/25" role="dialog" aria-label={`Check in with ${clientName}`}>
      <p className="text-sm leading-snug">
        Checked in with <b>{clientName}</b> lately?
      </p>
      <p className="mt-0.5 text-xs text-white/60">{daysSince === null ? "No contact logged yet." : `Last contact ${daysSince} day${daysSince === 1 ? "" : "s"} ago.`}</p>
      <div className="mt-2 flex gap-2">
        <button disabled={pending} onClick={() => answer("yes")} className="flex-1 rounded-lg bg-green px-2 py-1 text-sm font-semibold text-ink hover:brightness-95" aria-label="Yes, I've been in touch">
          👍 Yes
        </button>
        <button disabled={pending} onClick={() => answer("no")} className="flex-1 rounded-lg bg-white/10 px-2 py-1 text-sm font-semibold hover:bg-white/20" aria-label="Not yet, remind me in a few days">
          👎 Not yet
        </button>
      </div>
      {/* the bubble's tail, pointing up at the client's name */}
      <span className="absolute bottom-full left-6 h-0 w-0 border-x-8 border-b-8 border-x-transparent border-b-ink" />
    </div>
  );
}
