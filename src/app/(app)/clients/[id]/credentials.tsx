"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { deleteCredential, revealPassword, saveCredential } from "./credentials-actions";
import { CREDENTIAL_KINDS, type Credential } from "@/lib/types";

const KIND_LABEL = Object.fromEntries(CREDENTIAL_KINDS) as Record<string, string>;

function CredentialForm({ clientId, cred, onDone, ready }: { clientId: string; cred?: Credential; onDone: () => void; ready: boolean }) {
  const [state, action, pending] = useActionState(saveCredential, {});
  const done = useRef(onDone);
  useEffect(() => {
    if (state.ok) done.current();
  }, [state.ok]);
  return (
    <form action={action} className="space-y-2 p-4" autoComplete="off">
      {cred && <input type="hidden" name="id" value={cred.id} />}
      <input type="hidden" name="client_id" value={clientId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="kind" defaultValue={cred?.kind ?? "website"} className="field">
          {CREDENTIAL_KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input name="label" defaultValue={cred?.label ?? ""} placeholder="Name, e.g. WordPress admin" className="field" />
        <input name="url" defaultValue={cred?.url ?? ""} placeholder="Login page link" className="field sm:col-span-2" />
        <input name="username" defaultValue={cred?.username ?? ""} placeholder="Username or email" className="field" autoComplete="off" />
        <input
          name="password"
          type="password"
          placeholder={!ready ? "Password storage not switched on" : cred?.has_password ? "New password (leave blank to keep)" : "Password"}
          className="field"
          autoComplete="new-password"
          disabled={!ready}
        />
        <textarea name="notes" defaultValue={cred?.notes ?? ""} rows={2} placeholder="Notes (2FA goes to..., PIN hint, etc.)" className="field sm:col-span-2" />
      </div>
      {cred?.has_password && (
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" name="clear_password" className="h-3.5 w-3.5" /> Remove the saved password
        </label>
      )}
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary py-1.5" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </button>
        <button type="button" className="btn-ghost py-1.5" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Row({ cred, clientId, ready }: { cred: Credential; clientId: string; ready: boolean }) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (editing) return <CredentialForm clientId={clientId} cred={cred} ready={ready} onDone={() => setEditing(false)} />;

  const reveal = () =>
    start(async () => {
      const r = await revealPassword(cred.id);
      if (r.password !== undefined) {
        setShown(r.password);
        setTimeout(() => setShown(null), 30000); // hide again after 30 seconds
      } else setMsg(r.error ?? "Couldn't show it.");
    });

  return (
    <li className="space-y-1 px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">
          {cred.label || KIND_LABEL[cred.kind] || "Login"}
          <span className="ml-2 text-xs font-normal text-muted">{KIND_LABEL[cred.kind]}</span>
        </p>
        <span className="flex shrink-0 gap-3 text-xs text-muted">
          <button className="hover:text-ink" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button
            className="hover:text-red-700"
            onClick={() => {
              if (confirm("Delete this login?")) start(() => deleteCredential(cred.id, clientId));
            }}
          >
            Delete
          </button>
        </span>
      </div>
      {cred.url && (
        <a href={/^https?:\/\//i.test(cred.url) ? cred.url : `https://${cred.url}`} target="_blank" rel="noreferrer" className="block truncate text-xs text-steel hover:underline">
          {cred.url}
        </a>
      )}
      {cred.username && (
        <p className="flex items-center gap-2">
          <span className="w-16 text-xs text-muted">User</span>
          <span className="font-mono text-xs">{cred.username}</span>
          <button className="text-xs text-muted hover:text-ink" onClick={() => navigator.clipboard.writeText(cred.username!)}>
            Copy
          </button>
        </p>
      )}
      {cred.has_password && (
        <p className="flex items-center gap-2">
          <span className="w-16 text-xs text-muted">Password</span>
          <span className="font-mono text-xs">{shown ?? "••••••••••"}</span>
          {shown === null ? (
            <button className="text-xs text-muted hover:text-ink" disabled={pending} onClick={reveal}>
              {pending ? "..." : "Reveal"}
            </button>
          ) : (
            <>
              <button className="text-xs text-muted hover:text-ink" onClick={() => navigator.clipboard.writeText(shown)}>
                Copy
              </button>
              <button className="text-xs text-muted hover:text-ink" onClick={() => setShown(null)}>
                Hide
              </button>
            </>
          )}
        </p>
      )}
      {cred.notes && <p className="whitespace-pre-wrap text-xs text-muted">{cred.notes}</p>}
      {msg && <p className="text-xs text-red-700">{msg}</p>}
    </li>
  );
}

export function Credentials({ clientId, creds, ready, log }: { clientId: string; creds: Credential[]; ready: boolean; log: string[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="card">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-semibold">Logins</h2>
        {!adding && (
          <button className="text-sm text-green-d hover:underline" onClick={() => setAdding(true)}>
            + Add login
          </button>
        )}
      </header>
      {!ready && <p className="border-b border-line bg-amber-50 px-4 py-2 text-xs text-amber-800">Saving passwords is switched off until CREDENTIALS_KEY is set in Vercel. Usernames and links still work.</p>}
      {adding && <CredentialForm clientId={clientId} ready={ready} onDone={() => setAdding(false)} />}
      {creds.length ? (
        <ul className="divide-y divide-line">
          {creds.map((c) => (
            <Row key={c.id} cred={c} clientId={clientId} ready={ready} />
          ))}
        </ul>
      ) : (
        !adding && <p className="px-4 py-3 text-sm text-muted">No logins saved.</p>
      )}
      {log.length > 0 && (
        <details className="border-t border-line px-4 py-2 text-xs text-muted">
          <summary className="cursor-pointer">Access history</summary>
          <ul className="mt-1 space-y-0.5">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
