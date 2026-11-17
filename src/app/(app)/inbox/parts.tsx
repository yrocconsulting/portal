"use client";

import { useState, useTransition } from "react";
import { checkNow, connectMailbox } from "./actions";

export function RunButton({ kind }: { kind: "check" | "connect" }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ message?: string; error?: string } | null>(null);
  return (
    <div className="space-y-2">
      <button
        className={kind === "check" ? "btn-primary" : "btn-ghost"}
        disabled={pending}
        onClick={() => start(async () => setResult(await (kind === "check" ? checkNow() : connectMailbox())))}
      >
        {pending ? "Working..." : kind === "check" ? "Check helpdesk now" : "Reconnect mailbox"}
      </button>
      {result?.message && <p className="text-sm text-green-d">{result.message}</p>}
      {result?.error && <p className="text-sm text-red-700">{result.error}</p>}
    </div>
  );
}
