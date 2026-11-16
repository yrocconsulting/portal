"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { inviteStaff, revokeInvite, updateStaff } from "./actions";

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteStaff, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);
  return (
    <form ref={ref} action={action} className="grid gap-3 p-4 sm:grid-cols-[2fr_1fr_auto]">
      <input name="email" type="email" required placeholder="name@yrocconsulting.com" className="field" />
      <select name="role" defaultValue="member" className="field">
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <button className="btn-primary" disabled={pending}>
        {pending ? "Inviting..." : "Invite"}
      </button>
      {state.error && <p className="text-sm text-red-700 sm:col-span-3">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-d sm:col-span-3">Invited. They can now sign in with Microsoft 365 or an email link.</p>}
    </form>
  );
}

export function StaffControls({ id, role, active }: { id: string; role: "admin" | "member"; active: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const run = (patch: { role?: "admin" | "member"; active?: boolean }) =>
    start(async () => {
      try {
        setErr(null);
        await updateStaff(id, patch);
      } catch (x) {
        setErr((x as Error).message);
      }
    });
  return (
    <span className="flex items-center justify-end gap-2">
      <select className="field w-auto py-1 text-xs" value={role} disabled={pending} onChange={(e) => run({ role: e.target.value as "admin" | "member" })}>
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </select>
      <button
        className={active ? "btn-danger px-2.5 py-1 text-xs" : "btn-ghost px-2.5 py-1 text-xs"}
        disabled={pending}
        onClick={() => {
          if (!active || confirm("Remove portal access for this person? Their tickets stay assigned until you reassign them.")) run({ active: !active });
        }}
      >
        {active ? "Deactivate" : "Reactivate"}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </span>
  );
}

export function RevokeInvite({ email }: { email: string }) {
  const [pending, start] = useTransition();
  return (
    <button className="text-xs text-muted hover:text-red-700" disabled={pending} onClick={() => start(() => revokeInvite(email))}>
      Revoke
    </button>
  );
}
