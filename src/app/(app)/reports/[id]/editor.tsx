"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { addAction, deleteAction, saveReport } from "../actions";
import { itemDone } from "@/lib/report-progress";

export type EditorItem = {
  id: string;
  section: string | null;
  name: string;
  frequency: string | null;
  kind: "check" | "count" | "actions";
  target: number | null;
  target_label: string | null;
  level: string | null;
  optional: boolean;
  guidance: string | null;
  done_when: string | null;
  client_facing: boolean;
  status: "todo" | "done" | "na";
  count: number | null;
  links: string[];
  notes: string | null;
};
export type EditorAction = { id: string; action_type: string | null; title: string; url: string | null; notes: string | null; done_on: string | null; by: string };
type Report = { id: string; wins: string | null; summary: string | null; next_priorities: string | null; organic_leads: number | null };

const STATUS = [
  ["todo", "Not done"],
  ["done", "Done"],
  ["na", "N/A"],
] as const;

function ActionsLog({ reportId, actions, types, target, readOnly }: { reportId: string; actions: EditorAction[]; types: { name: string; category: string | null }[]; target: number | null; readOnly: boolean }) {
  const [state, action, pending] = useActionState(addAction, {});
  const [, start] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state.ok]);
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-display text-2xl font-bold">{actions.length}</span>
        {target !== null && <span className="text-muted"> of {target} delivered this month</span>}
      </p>
      {actions.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {actions.map((a) => (
            <li key={a.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{a.title}</span>
                {a.action_type && <span className="ml-2 rounded bg-bg px-1.5 py-0.5 text-[11px] text-muted">{a.action_type}</span>}
                {a.url && (
                  <a href={a.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-steel hover:underline">
                    {a.url}
                  </a>
                )}
                {a.notes && <span className="block text-xs text-muted">{a.notes}</span>}
                <span className="block text-[11px] text-muted">
                  {a.done_on ? `${a.done_on} · ` : ""}
                  {a.by}
                </span>
              </span>
              {!readOnly && (
                <button
                  className="shrink-0 text-xs text-muted hover:text-red-700"
                  onClick={() => {
                    if (confirm("Remove this action?")) start(() => deleteAction(a.id, reportId));
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <form ref={form} action={action} className="grid gap-2 rounded-lg bg-bg p-3 sm:grid-cols-[180px_1fr_1fr_140px_auto]">
          <input type="hidden" name="report_id" value={reportId} />
          <select name="action_type" className="field" defaultValue="">
            <option value="">Type of action</option>
            {types.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
          <input name="title" required placeholder="What was done, e.g. Roof Replacement Austin page" className="field" />
          <input name="url" placeholder="Link (optional)" className="field" />
          <input name="done_on" type="date" className="field" />
          <button className="btn-primary" disabled={pending}>
            {pending ? "Adding..." : "Add"}
          </button>
          {state.error && <p className="text-sm text-red-700 sm:col-span-5">{state.error}</p>}
        </form>
      )}
    </div>
  );
}

export function ReportEditor({
  report,
  items: initial,
  actions,
  types,
  readOnly,
}: {
  report: Report;
  items: EditorItem[];
  actions: EditorAction[];
  types: { name: string; category: string | null }[];
  readOnly: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [text, setText] = useState({ wins: report.wins ?? "", summary: report.summary ?? "", next_priorities: report.next_priorities ?? "", organic_leads: report.organic_leads?.toString() ?? "" });
  const [dirty, setDirty] = useState(false);
  const [saving, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: boolean; error?: string } | null>(null);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (id: string, patch: Partial<EditorItem>) => {
    setItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    setDirty(true);
    setMsg(null);
  };
  const sections = useMemo(() => {
    const m = new Map<string, EditorItem[]>();
    for (const it of items) m.set(it.section ?? "Other", [...(m.get(it.section ?? "Other") ?? []), it]);
    return [...m.entries()];
  }, [items]);
  const actionsItem = items.find((i) => i.kind === "actions");
  // Work through the SOP in order: the first task that isn't done or N/A is next up.
  const nextId = readOnly ? null : items.find((i) => i.kind !== "actions" && i.status === "todo" && !itemDone(i))?.id ?? null;

  const save = () =>
    start(async () => {
      const r = await saveReport(report.id, {
        wins: text.wins,
        summary: text.summary,
        next_priorities: text.next_priorities,
        organic_leads: text.organic_leads === "" ? null : Number(text.organic_leads),
        items: items.map((i) => ({ id: i.id, status: i.status, count: i.count, links: i.links, notes: i.notes })),
      });
      setMsg(r.error ? { error: r.error } : { ok: true });
      if (!r.error) setDirty(false);
    });

  const field = (k: keyof typeof text, label: string, hint: string, rows = 4) => (
    <div>
      <label className="label" htmlFor={k}>
        {label}
      </label>
      <textarea
        id={k}
        rows={rows}
        value={text[k]}
        readOnly={readOnly}
        placeholder={readOnly ? "" : hint}
        onChange={(e) => {
          setText({ ...text, [k]: e.target.value });
          setDirty(true);
          setMsg(null);
        }}
        className="field"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {actionsItem && (
        <section className="card p-4">
          <h2 className="mb-1 font-semibold">Search Growth Actions</h2>
          {actionsItem.guidance && <p className="mb-3 text-xs text-muted">{actionsItem.guidance}</p>}
          <ActionsLog reportId={report.id} actions={actions} types={types} target={actionsItem.target} readOnly={readOnly} />
        </section>
      )}

      {sections.map(([section, its]) => {
        const list = its.filter((i) => i.kind !== "actions");
        if (!list.length) return null;
        const done = list.filter((i) => itemDone(i)).length;
        const applicable = list.filter((i) => i.status !== "na").length;
        return (
          <section key={section} className="card">
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="font-semibold">{section}</h2>
              <span className="text-xs text-muted">
                {done} of {applicable} done
              </span>
            </header>
            <ul className="divide-y divide-line">
              {list.map((it) => {
                const ok = itemDone(it);
                const next = it.id === nextId;
                return (
                  <li
                    key={it.id}
                    className={`grid gap-3 px-4 py-3 lg:grid-cols-[1fr_auto] ${it.status === "na" ? "opacity-50" : ""} ${next ? "bg-green/10 shadow-[inset_4px_0_0_#3F8F1C]" : ""}`}
                    data-next={next ? "true" : undefined}
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-green-d" : "bg-line"}`} />
                        {next && <span className="rounded bg-green-d px-1.5 py-0.5 text-[11px] font-semibold text-white">Next up</span>}
                        {it.name}
                        {it.client_facing && <span className="rounded bg-green/20 px-1.5 py-0.5 text-[11px] font-semibold text-green-d" title="Shows on the client report when done">Client sees this</span>}
                        {it.target_label && it.kind === "check" && <span className="text-[11px] text-muted">{it.target_label}</span>}
                        {it.level && <span className="rounded bg-steel/10 px-1.5 py-0.5 text-[11px] font-semibold text-steel">{it.level}</span>}
                        {it.optional && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">Optional add-on</span>}
                        {it.frequency && it.frequency !== "Monthly" && <span className="text-[11px] text-muted">{it.frequency}</span>}
                      </p>
                      {it.guidance && <p className={`text-xs text-muted ${next ? "" : "line-clamp-1"}`}>{it.guidance}</p>}
                      {it.done_when && (next || !ok) && (
                        <p className={`text-xs ${next ? "text-ink" : "text-muted line-clamp-1"}`}>
                          <span className="font-semibold">Done when:</span> {it.done_when}
                        </p>
                      )}
                      {!readOnly && it.links.filter(Boolean).length === 0 && !it.notes && !open.has(it.id) && (
                        <button type="button" className="text-xs text-muted hover:text-green-d" onClick={() => setOpen(new Set(open).add(it.id))}>
                          + Add links/notes
                        </button>
                      )}
                      {(readOnly ? it.links.length > 0 || it.notes : it.links.filter(Boolean).length > 0 || it.notes || open.has(it.id)) && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {readOnly ? (
                            <>
                              {it.links.length > 0 && (
                                <ul className="space-y-0.5 text-xs">
                                  {it.links.map((l) => (
                                    <li key={l} className="truncate">
                                      <a href={l} target="_blank" rel="noreferrer" className="text-steel hover:underline">
                                        {l}
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {it.notes && <p className="whitespace-pre-wrap text-xs">{it.notes}</p>}
                            </>
                          ) : (
                            <>
                              <textarea
                                rows={1}
                                value={it.links.join("\n")}
                                onChange={(e) => set(it.id, { links: e.target.value.split("\n") })}
                                placeholder="Links to the work, one per line"
                                className="field py-1.5 text-xs"
                              />
                              <textarea rows={1} value={it.notes ?? ""} onChange={(e) => set(it.id, { notes: e.target.value })} placeholder="Notes" className="field py-1.5 text-xs" />
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-start gap-3">
                      {it.kind === "count" && (
                        <label className="flex items-center gap-1.5 text-xs text-muted">
                          <input
                            type="number"
                            min={0}
                            value={it.count ?? ""}
                            readOnly={readOnly}
                            onChange={(e) => set(it.id, { count: e.target.value === "" ? null : Number(e.target.value) })}
                            className="field w-20 py-1 text-right"
                            aria-label={`${it.name} delivered`}
                          />
                          of {it.target}
                          {it.target_label && <span className="hidden xl:inline">({it.target_label})</span>}
                        </label>
                      )}
                      <div className="inline-flex overflow-hidden rounded-lg border border-line text-xs">
                        {STATUS.map(([v, l]) => (
                          <button
                            key={v}
                            type="button"
                            disabled={readOnly}
                            onClick={() => set(it.id, { status: v })}
                            className={`px-2.5 py-1.5 ${it.status === v ? (v === "done" ? "bg-green-d text-white" : v === "na" ? "bg-slate-500 text-white" : "bg-ink text-white") : "bg-white text-muted hover:bg-bg"} disabled:cursor-default`}
                          >
                            {l}
                          </button>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <section className="card space-y-4 p-4">
        <h2 className="font-semibold">Wins and summary</h2>
        {field("wins", "Wins this month", "Highlights worth celebrating: rankings gained, new AI citations, leads, launches. These will feed the client-facing report later.", 4)}
        {field("summary", "What shipped, changed or was learned", "Short summary of the month's work and anything learned.", 4)}
        {field("next_priorities", "Next month's priorities", "What we'll focus on next month.", 3)}
        <div className="max-w-48">
          <label className="label" htmlFor="organic_leads">
            Organic leads / conversions
          </label>
          <input
            id="organic_leads"
            type="number"
            min={0}
            value={text.organic_leads}
            readOnly={readOnly}
            onChange={(e) => {
              setText({ ...text, organic_leads: e.target.value });
              setDirty(true);
            }}
            className="field"
          />
        </div>
      </section>

      {!readOnly && (
        <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-3 border-t border-line bg-white/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
          {msg?.ok && !dirty && <span className="text-xs text-green-d">Saved.</span>}
          {msg?.error && <span className="text-xs text-red-700">{msg.error}</span>}
          <button className="btn-green" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
