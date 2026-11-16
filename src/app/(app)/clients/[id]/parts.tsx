"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { addContact, deleteContact, startOnboarding } from "../actions";

export function AddContactForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(addContact, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);
  return (
    <form ref={ref} action={action} className="space-y-2 border-t border-line p-4">
      <input type="hidden" name="client_id" value={clientId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <input name="name" required placeholder="Name" className="field" />
        <input name="title" placeholder="Title" className="field" />
        <input name="email" type="email" placeholder="Email" className="field" />
        <input name="phone" placeholder="Phone" className="field" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="is_primary" className="h-4 w-4 accent-ink" /> Primary contact
        </label>
        <button className="btn-ghost" disabled={pending}>
          {pending ? "Adding..." : "Add contact"}
        </button>
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
    </form>
  );
}

export function DeleteContact({ id, clientId }: { id: string; clientId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="text-xs text-muted hover:text-red-700"
      disabled={pending}
      onClick={() => {
        if (confirm("Remove this contact?")) start(() => deleteContact(id, clientId));
      }}
    >
      Remove
    </button>
  );
}

export function OnboardingForm({
  clientId,
  templates,
  staff,
}: {
  clientId: string;
  templates: { id: string; name: string; steps: number }[];
  staff: { id: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(startOnboarding, {});
  if (!templates.length) return <p className="text-sm text-muted">No onboarding checklists yet.</p>;
  return (
    <form
      action={action}
      className="space-y-3"
      onSubmit={(e) => {
        if (!confirm("Create the onboarding tickets for this client?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="client_id" value={clientId} />
      <select name="template_id" className="field">
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.steps} steps)
          </option>
        ))}
      </select>
      <select name="assignee_id" className="field" defaultValue="">
        <option value="">Leave tickets unassigned</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            Assign all to {s.label}
          </option>
        ))}
      </select>
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Creating..." : "Start onboarding"}
      </button>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.ok !== undefined && !state.error && <p className="text-sm text-green-d">Created {state.ok} tickets.</p>}
    </form>
  );
}
