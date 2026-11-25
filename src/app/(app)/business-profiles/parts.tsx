"use client";

import { useState, useTransition } from "react";
import { disconnectGbp, setProfileClient, syncGbpNow } from "./actions";

export function SyncButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ message?: string; error?: string } | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button className="btn-primary" disabled={pending} onClick={() => start(async () => setMsg(await syncGbpNow()))}>
        {pending ? "Syncing..." : "Sync now"}
      </button>
      {msg && <span className={`max-w-md text-right text-xs ${msg.error ? "text-red-700" : "text-green-d"}`}>{msg.error ?? msg.message}</span>}
    </span>
  );
}

export function DisconnectButton() {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn-ghost text-xs text-red-700"
      disabled={pending}
      onClick={() => {
        if (confirm("Disconnect the Google account? Synced numbers and reviews stay; nothing new comes in until you connect again.")) start(() => disconnectGbp());
      }}
    >
      Disconnect
    </button>
  );
}

export function ClientPicker({ name, clientId, clients }: { name: string; clientId: string | null; clients: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  return (
    <select
      defaultValue={clientId ?? ""}
      disabled={pending}
      onChange={(e) => start(() => setProfileClient(name, e.target.value || null))}
      className="field py-1 text-sm"
      aria-label="Client for this profile"
    >
      <option value="">Not a client</option>
      {clients.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
