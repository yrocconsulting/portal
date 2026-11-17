"use client";

import { useState, useTransition } from "react";
import { syncNow } from "./actions";

export function SyncButton() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<{ message?: string; error?: string } | null>(null);
  return (
    <div className="space-y-1 text-right">
      <button className="btn-primary" disabled={pending} onClick={() => start(async () => setR(await syncNow()))}>
        {pending ? "Syncing..." : "Sync now"}
      </button>
      {r?.message && <p className="text-xs text-green-d">{r.message}</p>}
      {r?.error && <p className="max-w-md text-xs text-red-700">{r.error}</p>}
    </div>
  );
}
