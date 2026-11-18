"use client";

import { useState, useTransition } from "react";
import { answerCheckin } from "../../checkins/actions";

/** Records that someone was in touch with the client (resets the check-in reminder). */
export function LogCheckin({ clientId }: { clientId: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn-ghost py-1.5 text-xs"
      disabled={pending || done}
      onClick={() =>
        start(async () => {
          await answerCheckin(clientId, "yes", false);
          setDone(true);
        })
      }
    >
      {done ? "Check-in logged" : pending ? "Logging..." : "Log a check-in"}
    </button>
  );
}
