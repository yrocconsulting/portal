"use client";

import { useActionState, useState } from "react";
import { createTicket } from "../actions";
import { PRIORITIES, PRIORITY_LABEL, TYPES, TYPE_LABEL } from "@/lib/types";

type Opt = { id: string; label: string };
type ContactOpt = Opt & { client_id: string };

export function TicketForm({
  staff,
  clients,
  contacts,
  me,
  defaultClient,
}: {
  staff: Opt[];
  clients: (Opt & { lead: string | null })[];
  contacts: ContactOpt[];
  me: string;
  defaultClient: string;
}) {
  const [state, action, pending] = useActionState(createTicket, {});
  const [client, setClient] = useState(defaultClient);
  const leadOf = (id: string) => clients.find((c) => c.id === id)?.lead ?? null;
  // Defaults to the client's lead; stays as chosen once someone picks an assignee by hand.
  const [assignee, setAssignee] = useState(leadOf(defaultClient) ?? me);
  const [assigneeTouched, setAssigneeTouched] = useState(false);
  const clientContacts = contacts.filter((c) => c.client_id === client);

  return (
    <form action={action} className="card space-y-5 p-6">
      <div>
        <label className="label" htmlFor="title">
          Title
        </label>
        <input id="title" name="title" required autoFocus className="field text-base" placeholder="What needs to happen?" />
      </div>
      <div>
        <label className="label" htmlFor="description">
          Details
        </label>
        <textarea id="description" name="description" rows={6} className="field" placeholder="Context, links, what done looks like" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="client_id">
            Client
          </label>
          <select
            id="client_id"
            name="client_id"
            value={client}
            onChange={(e) => {
              setClient(e.target.value);
              if (!assigneeTouched) setAssignee(leadOf(e.target.value) ?? me);
            }}
            className="field"
          >
            <option value="">No client (internal)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="contact_id">
            Contact
          </label>
          <select id="contact_id" name="contact_id" className="field" disabled={!clientContacts.length} key={client}>
            <option value="">{clientContacts.length ? "Choose a contact" : "No contacts on file"}</option>
            {clientContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="assignee_id">
            Assignee
          </label>
          <select
            id="assignee_id"
            name="assignee_id"
            value={assignee}
            onChange={(e) => {
              setAssignee(e.target.value);
              setAssigneeTouched(true);
            }}
            className="field"
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="due_date">
            Due date
          </label>
          <input id="due_date" name="due_date" type="date" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="priority">
            Priority
          </label>
          <select id="priority" name="priority" defaultValue="normal" className="field">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="type">
            Type
          </label>
          <select id="type" name="type" defaultValue="task" className="field">
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex justify-end">
        <button className="btn-green" disabled={pending}>
          {pending ? "Creating..." : "Create ticket"}
        </button>
      </div>
    </form>
  );
}
