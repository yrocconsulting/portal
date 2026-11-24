"use client";

import { useState, useTransition } from "react";
import { setMyNotification } from "./actions";

/** One switch per kind of email. Each person chooses their own. */
export function NotificationSettings({ options }: { options: { kind: string; label: string; on: boolean }[] }) {
  const [state, setState] = useState(Object.fromEntries(options.map((o) => [o.kind, o.on])));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-line">
      {options.map((o) => (
        <li key={o.kind} className="flex items-center justify-between gap-4 py-3">
          <span className="text-sm">{o.label}</span>
          <button
            type="button"
            role="switch"
            aria-checked={state[o.kind]}
            aria-label={o.label}
            disabled={pending}
            onClick={() => {
              const next = !state[o.kind];
              setState({ ...state, [o.kind]: next });
              start(async () => {
                const r = await setMyNotification(o.kind, next);
                if (r.error) {
                  setState((s) => ({ ...s, [o.kind]: !next }));
                  setMsg(r.error);
                } else setMsg(next ? "On. You'll get these emails." : "Off. You won't get these emails.");
              });
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${state[o.kind] ? "bg-green-d" : "bg-line"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${state[o.kind] ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </li>
      ))}
      {msg && <li className="pt-2 text-xs text-muted" role="status">{msg}</li>}
    </ul>
  );
}
