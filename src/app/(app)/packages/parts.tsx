"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { deleteItem, duplicatePackage, saveItem, savePackage } from "./actions";

export type PkgItem = {
  id: string;
  section: string | null;
  name: string;
  frequency: string | null;
  kind: string;
  target: number | null;
  target_label: string | null;
  level: string | null;
  optional: boolean;
  notes: string | null;
  done_when: string | null;
  client_facing: boolean;
};

function ItemFields({ it, sections }: { it?: PkgItem; sections: string[] }) {
  const [kind, setKind] = useState(it?.kind ?? "check");
  return (
    <div className="grid gap-2 sm:grid-cols-6">
      <input name="name" defaultValue={it?.name} required placeholder="Deliverable" className="field sm:col-span-3" />
      <input name="section" defaultValue={it?.section ?? ""} list="sections" placeholder="Section" className="field sm:col-span-2" />
      <datalist id="sections">
        {sections.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <input name="frequency" defaultValue={it?.frequency ?? "Monthly"} placeholder="Frequency" className="field" />
      <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="field sm:col-span-2">
        <option value="check">Done / not done</option>
        <option value="count">Count against a target</option>
        <option value="actions">Search Growth Actions log</option>
      </select>
      {kind !== "check" ? (
        <>
          <input name="target" type="number" min={0} defaultValue={it?.target ?? ""} placeholder="Target / month" className="field" />
          <input name="target_label" defaultValue={it?.target_label ?? ""} placeholder='Label, e.g. "2 per week"' className="field" />
        </>
      ) : (
        <span className="hidden sm:col-span-2 sm:block" />
      )}
      <input name="level" defaultValue={it?.level ?? ""} placeholder="Level (Core, Advanced...)" className="field" />
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" name="optional" defaultChecked={it?.optional} className="h-4 w-4" /> Optional add-on
      </label>
      <input name="notes" defaultValue={it?.notes ?? ""} placeholder="What to do (shown on the monthly record)" className="field sm:col-span-6" />
      <input name="done_when" defaultValue={it?.done_when ?? ""} placeholder="Definition of done" className="field sm:col-span-5" />
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" name="client_facing" defaultChecked={it?.client_facing} className="h-4 w-4" /> Client sees this
      </label>
    </div>
  );
}

export function ItemRow({ it, sections }: { it: PkgItem; sections: string[] }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(saveItem, {});
  const [, start] = useTransition();
  const done = useRef(() => setEditing(false));
  useEffect(() => {
    if (state.ok) done.current();
  }, [state.ok]);
  if (editing) {
    return (
      <li className="bg-bg/60 px-4 py-3">
        <form action={action} className="space-y-2">
          <input type="hidden" name="id" value={it.id} />
          <ItemFields it={it} sections={sections} />
          {state.error && <p className="text-xs text-red-700">{state.error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary py-1 text-xs" disabled={pending}>
              Save
            </button>
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-2 text-sm">
      <span className="min-w-0">
        <span className="font-medium">{it.name}</span>
        {it.client_facing && <span className="ml-2 rounded bg-green/20 px-1.5 py-0.5 text-[11px] font-semibold text-green-d">Client sees this</span>}
        {it.level && <span className="ml-2 rounded bg-steel/10 px-1.5 py-0.5 text-[11px] font-semibold text-steel">{it.level}</span>}
        {it.optional && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">Optional</span>}
        <span className="block text-xs text-muted">
          {[it.frequency, it.kind === "count" ? `target ${it.target}/month${it.target_label ? ` (${it.target_label})` : ""}` : it.kind === "actions" ? `actions log, target ${it.target}/month` : it.target_label]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span className="flex shrink-0 gap-3 text-xs text-muted">
        <button className="hover:text-ink" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          className="hover:text-red-700"
          onClick={() => {
            if (confirm(`Remove "${it.name}" from this package? Past monthly records keep it.`)) start(() => deleteItem(it.id));
          }}
        >
          Remove
        </button>
      </span>
    </li>
  );
}

export function AddItem({ packageId, sections }: { packageId: string; sections: string[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(saveItem, {});
  const close = useRef(() => setOpen(false));
  useEffect(() => {
    if (state.ok) close.current();
  }, [state.ok]);
  if (!open)
    return (
      <button className="text-sm text-green-d hover:underline" onClick={() => setOpen(true)}>
        + Add deliverable
      </button>
    );
  return (
    <form action={action} className="space-y-2 rounded-lg bg-bg p-3">
      <input type="hidden" name="package_id" value={packageId} />
      <ItemFields sections={sections} />
      {state.error && <p className="text-xs text-red-700">{state.error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary py-1 text-xs" disabled={pending}>
          Add
        </button>
        <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function PackageHeader({ pkg }: { pkg: { id: string; name: string; price_monthly: number | null; description: string | null } }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(savePackage, {});
  const [dup, start] = useTransition();
  const close = useRef(() => setEditing(false));
  useEffect(() => {
    if (state.ok) close.current();
  }, [state.ok]);
  if (editing)
    return (
      <form action={action} className="grid gap-2 p-4 sm:grid-cols-[1fr_140px_2fr_auto]">
        <input type="hidden" name="id" value={pkg.id} />
        <input name="name" defaultValue={pkg.name} required className="field" />
        <input name="price_monthly" defaultValue={pkg.price_monthly ?? ""} placeholder="$ / month" className="field" />
        <input name="description" defaultValue={pkg.description ?? ""} placeholder="Best for..." className="field" />
        <span className="flex gap-2">
          <button className="btn-primary" disabled={pending}>
            Save
          </button>
          <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </span>
        {state.error && <p className="text-xs text-red-700 sm:col-span-4">{state.error}</p>}
      </form>
    );
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div>
        <h2 className="text-lg font-bold">{pkg.name}</h2>
        <p className="text-sm text-muted">
          {pkg.price_monthly ? `$${Number(pkg.price_monthly).toLocaleString("en-US")}/mo` : ""}
          {pkg.description ? ` · ${pkg.description}` : ""}
        </p>
      </div>
      <span className="flex gap-3 text-xs">
        <button className="text-muted hover:text-ink" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="text-muted hover:text-ink" disabled={dup} onClick={() => start(() => duplicatePackage(pkg.id))}>
          {dup ? "Copying..." : "Duplicate"}
        </button>
      </span>
    </div>
  );
}

export function NewPackage() {
  const [state, action, pending] = useActionState(savePackage, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state.ok]);
  return (
    <form ref={form} action={action} className="card grid gap-2 p-4 sm:grid-cols-[1fr_140px_2fr_auto]">
      <input name="name" required placeholder="New package name" className="field" />
      <input name="price_monthly" placeholder="$ / month" className="field" />
      <input name="description" placeholder="Best for..." className="field" />
      <button className="btn-primary" disabled={pending}>
        Add package
      </button>
      {state.error && <p className="text-xs text-red-700 sm:col-span-4">{state.error}</p>}
    </form>
  );
}
