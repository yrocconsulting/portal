"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import type { Angle } from "@/lib/drafts/claude";
import { chooseAngle, postToTicket, retryAngles, saveDraftText, saveHouseStyle, startDraft } from "./actions";

/** Refreshes the page every few seconds while Claude works. */
export function Poller({ label }: { label: string }) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    const r = setInterval(() => router.refresh(), 4000);
    return () => {
      clearInterval(t);
      clearInterval(r);
    };
  }, [router]);
  return (
    <div className="card flex items-center gap-3 p-5 text-sm" role="status">
      <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-green-d" />
      <span>
        {label} <span className="text-muted">({seconds}s, usually under {label.startsWith("Writing") ? "3 minutes" : "a minute"})</span>
      </span>
    </div>
  );
}

export function NewDraftForm({
  clients,
  defaultClient,
  defaultKind,
  ticketId,
  kinds,
}: {
  clients: { id: string; name: string }[];
  defaultClient: string;
  defaultKind: string;
  ticketId: string | null;
  kinds: [string, string][];
}) {
  const [state, action, pending] = useActionState(startDraft, {});
  return (
    <form action={action} className="card space-y-4 p-5">
      {ticketId && <input type="hidden" name="ticket_id" value={ticketId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="client_id">
            Client
          </label>
          <select id="client_id" name="client_id" defaultValue={defaultClient} required className="field">
            <option value="">Choose a client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="kind">
            What to write
          </label>
          <select id="kind" name="kind" defaultValue={defaultKind} className="field">
            {kinds.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="brief">
          Direction (optional)
        </label>
        <textarea
          id="brief"
          name="brief"
          rows={3}
          placeholder="Anything Claude should know: news to announce, a service to push, an event, facts from the client, things to avoid."
          className="field"
        />
      </div>
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">Claude reads the client&apos;s tracked AI prompts, Search Console queries and recent wins, then suggests 3 angles.</p>
        <button className="btn-green" disabled={pending}>
          {pending ? "Starting..." : "Suggest angles"}
        </button>
      </div>
    </form>
  );
}

export function AnglePicker({ id, angles, brief: initialBrief, error }: { id: string; angles: Angle[]; brief: string | null; error: string | null }) {
  const [picked, setPicked] = useState(0);
  const [edits, setEdits] = useState<Angle[]>(angles);
  const [brief, setBrief] = useState(initialBrief ?? "");
  const [pending, start] = useTransition();
  const [, startRetry] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const a = edits[picked];
  const set = (patch: Partial<Angle>) => setEdits((all) => all.map((x, i) => (i === picked ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-4">
      {error && <p className="card border-red-200 bg-red-50 p-4 text-sm text-red-800">The draft didn&apos;t finish: {error}</p>}
      <ul className="grid gap-3 lg:grid-cols-3">
        {edits.map((x, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => setPicked(i)}
              className={`card h-full w-full p-4 text-left ${i === picked ? "border-ink ring-2 ring-ink" : "hover:border-steel"}`}
              aria-pressed={i === picked}
            >
              <p className="text-[11px] font-semibold tracking-wide text-steel uppercase">Angle {i + 1}</p>
              <p className="mt-1 font-semibold">{x.title}</p>
              <p className="mt-1 text-sm">{x.hook}</p>
              <p className="mt-2 text-xs text-muted">{x.why}</p>
              <ul className="mt-2 space-y-1">
                {x.target_prompts.map((p) => (
                  <li key={p} className="rounded bg-bg px-2 py-1 font-mono text-[11px] text-ink/80">
                    {p}
                  </li>
                ))}
              </ul>
              {x.needs.length > 0 && <p className="mt-2 text-xs text-amber-800">Needs: {x.needs.join("; ")}</p>}
            </button>
          </li>
        ))}
      </ul>
      <div className="card space-y-3 p-4">
        <p className="text-sm font-semibold">Tweak angle {picked + 1} before writing (optional)</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={a.headline} onChange={(e) => set({ headline: e.target.value })} className="field" aria-label="Working headline" />
          <input value={a.hook} onChange={(e) => set({ hook: e.target.value })} className="field" aria-label="Hook" />
        </div>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={2}
          placeholder="Extra direction or facts for the draft (e.g. the owner's name and title, the launch date)."
          className="field"
          aria-label="Direction"
        />
        {msg && <p className="text-sm text-red-700">{msg}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="btn-ghost text-xs" onClick={() => startRetry(() => retryAngles(id))}>
            Suggest 3 new angles
          </button>
          <button
            type="button"
            className="btn-green"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await chooseAngle(id, a, brief || null);
                if (r?.error) setMsg(r.error);
              })
            }
          >
            {pending ? "Starting..." : `Write the draft from angle ${picked + 1}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DraftEditor({ id, body: initialBody, notes: initialNotes, posted }: { id: string; body: string; notes: string; posted: boolean }) {
  const [body, setBody] = useState(initialBody);
  const [notes, setNotes] = useState(initialNotes);
  const [dirty, setDirty] = useState(false);
  const [saving, start] = useTransition();
  const [posting, startPost] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const confirms = (body.match(/\[\[CONFIRM:[^\]]*\]\]/g) ?? []).length;
  const copy = async () => {
    await navigator.clipboard.writeText(body);
    setMsg({ ok: "Copied to the clipboard." });
  };
  return (
    <div className="space-y-4">
      <div className="card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="font-semibold">Draft</h2>
          <span className={`text-xs font-semibold ${confirms ? "text-amber-700" : "text-green-d"}`}>
            {confirms ? `${confirms} [[CONFIRM]] placeholder${confirms === 1 ? "" : "s"} to fill in` : "No placeholders left"}
          </span>
        </header>
        <textarea
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setDirty(true);
            setMsg(null);
          }}
          rows={28}
          className="block w-full resize-y border-0 bg-white px-4 py-3 font-mono text-[13px] leading-relaxed focus:ring-0"
          aria-label="Draft text"
        />
      </div>
      <div className="card">
        <header className="border-b border-line px-4 py-3">
          <h2 className="font-semibold">Notes for the team</h2>
        </header>
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
          rows={10}
          className="block w-full resize-y border-0 bg-white px-4 py-3 font-mono text-[12px] leading-relaxed focus:ring-0"
          aria-label="Notes for the team"
        />
      </div>
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-white/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
        {msg?.ok && <span className="text-xs text-green-d">{msg.ok}</span>}
        {msg?.error && <span className="text-xs text-red-700">{msg.error}</span>}
        <button type="button" className="btn-ghost" onClick={copy}>
          Copy draft
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={!dirty || saving}
          onClick={() =>
            start(async () => {
              const r = await saveDraftText(id, body, notes);
              if (r.error) setMsg({ error: r.error });
              else {
                setDirty(false);
                setMsg({ ok: "Saved." });
              }
            })
          }
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {!posted && (
          <button
            type="button"
            className="btn-green"
            disabled={posting || dirty}
            title={dirty ? "Save your edits first" : undefined}
            onClick={() =>
              startPost(async () => {
                const r = await postToTicket(id);
                if (r?.error) setMsg({ error: r.error });
              })
            }
          >
            {posting ? "Posting..." : "Post to ticket for review"}
          </button>
        )}
      </div>
    </div>
  );
}

export function HouseStyleForm({ style }: { style: string }) {
  const [state, action, pending] = useActionState(saveHouseStyle, {});
  return (
    <form action={action} className="space-y-2">
      <textarea
        name="style"
        rows={6}
        defaultValue={style}
        placeholder={"e.g.\n- Write in first person plural for the client (\"we\").\n- Press releases: always end with the client's phone number.\n- Never mention prices."}
        className="field"
      />
      <div className="flex items-center justify-end gap-3">
        {state.error && <span className="text-xs text-red-700">{state.error}</span>}
        {state.ok && <span className="text-xs text-green-d">Saved.</span>}
        <button className="btn-primary" disabled={pending}>
          {pending ? "Saving..." : "Save house style"}
        </button>
      </div>
    </form>
  );
}
