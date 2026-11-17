"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addComment, deleteAttachment, deleteComment, recordAttachment, updateTicketField, updateTicketText } from "../actions";
import { createClient } from "@/lib/supabase/client";
import { fmtBytes } from "@/lib/format";

type Opt = { value: string; label: string };

type FieldProps = { ticketId: string; field: string; value: string; options: Opt[]; label: string };

/** A select that saves as soon as it changes. Remounts when the saved value changes on the server. */
export function FieldSelect(props: FieldProps) {
  return <FieldSelectInner key={props.value} {...props} />;
}

function FieldSelectInner({ ticketId, field, value, options, label }: { ticketId: string; field: string; value: string; options: Opt[]; label: string }) {
  const [pending, start] = useTransition();
  const [v, setV] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <label className="label">
        {label} {pending && <span className="normal-case tracking-normal text-steel">saving...</span>}
      </label>
      <select
        className="field"
        value={v}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value;
          setV(next);
          setErr(null);
          start(async () => {
            try {
              await updateTicketField(ticketId, field, next);
            } catch (x) {
              setErr((x as Error).message);
              setV(value);
            }
          });
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {err && <p className="mt-1 text-xs text-red-700">{err}</p>}
    </div>
  );
}

export function DueDate({ ticketId, value }: { ticketId: string; value: string }) {
  const [pending, start] = useTransition();
  return (
    <div>
      <label className="label">Due date {pending && <span className="normal-case tracking-normal text-steel">saving...</span>}</label>
      <input
        type="date"
        className="field"
        defaultValue={value}
        onChange={(e) => {
          const next = e.target.value;
          start(() => updateTicketField(ticketId, "due_date", next));
        }}
      />
    </div>
  );
}

/** Title and description, click Edit to change. */
export function TicketText({ id, title, description }: { id: string; title: string; description: string }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const action = (fd: FormData) =>
    start(async () => {
      const r = await updateTicketText({}, fd);
      if (r.ok) {
        setError(null);
        setEditing(false);
      } else setError(r.error ?? "Could not save.");
    });

  if (!editing) {
    return (
      <div className="group">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold">{title}</h1>
          <button onClick={() => setEditing(true)} className="btn-ghost shrink-0 px-2.5 py-1 text-xs">
            Edit
          </button>
        </div>
        {description ? (
          <div className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-ink/90">{description}</div>
        ) : (
          <p className="mt-3 text-sm text-muted italic">No details yet.</p>
        )}
      </div>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input name="title" defaultValue={title} required className="field text-lg font-semibold" />
      <textarea name="description" defaultValue={description} rows={8} className="field" />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function CommentBox({ ticketId, status, contactName }: { ticketId: string; status: string; contactName: string }) {
  const [state, action, pending] = useActionState(addComment, {});
  const [fromClient, setFromClient] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.n) ref.current?.reset();
  }, [state.n]);
  useEffect(() => {
    if (state.n) setFromClient(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [state.n]);
  const closed = status === "done" || status === "closed";
  return (
    <form ref={ref} action={action} className="card p-3">
      <input type="hidden" name="ticket_id" value={ticketId} />
      <textarea
        name="body"
        rows={3}
        required
        placeholder={fromClient ? "What did the client say? (call, text or email)" : "Add an internal note..."}
        className="field border-0 shadow-none focus:ring-0"
      />
      <div className="flex flex-wrap items-center gap-3 px-3 pb-2 text-sm text-muted">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="from_client" checked={fromClient} onChange={(e) => setFromClient(e.target.checked)} className="h-4 w-4 accent-ink" />
          Log a message from the client
        </label>
        {fromClient && <input name="client_name" defaultValue={contactName} placeholder="Client name" className="field w-48 py-1" />}
      </div>
      {state.error && <p className="px-3 text-sm text-red-700">{state.error}</p>}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        {!closed && (
          <button name="then_status" value="done" className="btn-ghost" disabled={pending}>
            Comment and mark done
          </button>
        )}
        <button className="btn-primary" disabled={pending}>
          {pending ? "Posting..." : "Comment"}
        </button>
      </div>
    </form>
  );
}

export function DeleteCommentButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="text-xs text-muted hover:text-red-700"
      disabled={pending}
      onClick={() => {
        if (confirm("Delete this comment?")) start(() => deleteComment(id));
      }}
    >
      Delete
    </button>
  );
}

type FileRow = { id: string; name: string; size: number | null; url: string | null };

export function Attachments({ ticketId, files }: { ticketId: string; files: FileRow[] }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    setErr(null);
    const supabase = createClient();
    try {
      for (const f of Array.from(list)) {
        if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name} is over 25 MB.`);
        const safe = f.name.replace(/[^\w.\-]+/g, "_");
        const path = `${ticketId}/${crypto.randomUUID()}-${safe}`;
        const { error } = await supabase.storage.from("attachments").upload(path, f, { contentType: f.type || undefined });
        if (error) throw new Error(error.message);
        await recordAttachment(ticketId, { path, name: f.name, size: f.size, type: f.type });
      }
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Files</h2>
        <label className="btn-ghost cursor-pointer px-2.5 py-1 text-xs">
          {busy ? "Uploading..." : "+ Attach"}
          <input ref={input} type="file" multiple className="hidden" disabled={busy} onChange={(e) => upload(e.target.files)} />
        </label>
      </div>
      {err && <p className="mb-2 text-sm text-red-700">{err}</p>}
      {files.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="truncate font-medium hover:text-green-d">
                {f.name}
              </a>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
                {fmtBytes(f.size)}
                <button
                  className="hover:text-red-700"
                  onClick={() => {
                    if (confirm(`Delete ${f.name}?`)) start(() => deleteAttachment(f.id));
                  }}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No files.</p>
      )}
    </div>
  );
}
