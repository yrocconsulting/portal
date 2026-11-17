"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { PriorityBadge } from "@/components/badges";
import { addStep, createTemplate, deleteStep, deleteTemplate, moveStep, renameTemplate, updateStep } from "./actions";
import { PRIORITIES, PRIORITY_LABEL, type TicketPriority } from "@/lib/types";

export type Person = { id: string; name: string };
export type Step = {
  id: string;
  position: number;
  title: string;
  description: string | null;
  due_offset_days: number;
  priority: TicketPriority;
  assign_to: "lead" | "account_manager" | "starter" | "staff" | "none";
  assign_staff_id: string | null;
};

const ASSIGN_LABEL: Record<Step["assign_to"], string> = {
  lead: "Client's lead",
  account_manager: "Account manager",
  starter: "Whoever starts onboarding",
  staff: "Specific person",
  none: "Unassigned",
};

export function assignLabel(s: Pick<Step, "assign_to" | "assign_staff_id">, people: Person[]): string {
  if (s.assign_to === "staff") return people.find((p) => p.id === s.assign_staff_id)?.name ?? "Specific person (no longer on the team)";
  return ASSIGN_LABEL[s.assign_to];
}

function useResetOnOk(ok?: number) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (ok) ref.current?.reset();
  }, [ok]);
  return ref;
}

function AssignSelect({ step, people }: { step?: Step; people: Person[] }) {
  const value = step ? (step.assign_to === "staff" ? `staff:${step.assign_staff_id}` : step.assign_to) : "lead";
  return (
    <select name="assign_to" defaultValue={value} className="field" title="Who gets this step's ticket">
      <option value="lead">Client&apos;s lead</option>
      <option value="account_manager">Account manager</option>
      <option value="starter">Whoever starts onboarding</option>
      <option value="none">Unassigned</option>
      <optgroup label="Specific person">
        {people.map((p) => (
          <option key={p.id} value={`staff:${p.id}`}>
            {p.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function StepFields({ step, people }: { step?: Step; people: Person[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[2fr_90px_110px_1.3fr]">
      <input name="title" required defaultValue={step?.title} placeholder="Step" className="field" />
      <label className="relative">
        <input
          name="due_offset_days"
          type="number"
          min={0}
          max={365}
          defaultValue={step?.due_offset_days ?? 7}
          className="field pr-10"
          title="Due this many days after onboarding starts"
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted">days</span>
      </label>
      <select name="priority" defaultValue={step?.priority ?? "normal"} className="field">
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
      <AssignSelect step={step} people={people} />
      <textarea name="description" rows={2} defaultValue={step?.description ?? ""} placeholder="Instructions for whoever picks it up (optional)" className="field sm:col-span-4" />
    </div>
  );
}

export function StepRow({ step, index, first, last, people }: { step: Step; index: number; first: boolean; last: boolean; people: Person[] }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(updateStep, {});
  const close = useRef(() => setEditing(false));
  useEffect(() => {
    if (state.ok) close.current();
  }, [state.ok]);

  if (editing) {
    return (
      <li className="bg-bg/60 px-4 py-3">
        <form action={action} className="space-y-2">
          <input type="hidden" name="id" value={step.id} />
          <StepFields step={step} people={people} />
          {state.error && <p className="text-sm text-red-700">{state.error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary py-1.5 text-xs" disabled={pending}>
              {pending ? "Saving..." : "Save step"}
            </button>
            <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          <span className="mr-2 font-mono text-xs text-muted">{index + 1}.</span>
          {step.title}
        </p>
        {step.description && <p className="mt-0.5 text-sm text-muted">{step.description}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>Due day {step.due_offset_days}</span>
          <PriorityBadge priority={step.priority} />
          <span className="rounded bg-steel/10 px-1.5 py-0.5 font-medium text-steel">Goes to: {assignLabel(step, people)}</span>
        </p>
      </div>
      <StepControls id={step.id} first={first} last={last} onEdit={() => setEditing(true)} />
    </li>
  );
}

export function NewTemplateForm() {
  const [state, action, pending] = useActionState(createTemplate, {});
  const ref = useResetOnOk(state.ok);
  return (
    <form ref={ref} action={action} className="card grid gap-3 p-4 sm:grid-cols-[1fr_2fr_auto]">
      <input name="name" required placeholder="Checklist name, e.g. Website build" className="field" />
      <input name="description" placeholder="What it is for (optional)" className="field" />
      <button className="btn-primary" disabled={pending}>
        {pending ? "Adding..." : "Add checklist"}
      </button>
      {state.error && <p className="text-sm text-red-700 sm:col-span-3">{state.error}</p>}
    </form>
  );
}

export function TemplateHeader({ id, name, description }: { id: string; name: string; description: string | null }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(renameTemplate, {});
  const close = useRef(() => setEditing(false));
  useEffect(() => {
    if (state.ok) close.current();
  }, [state.ok]);
  if (editing) {
    return (
      <form action={action} className="grid flex-1 gap-2 sm:grid-cols-[1fr_2fr_auto]">
        <input type="hidden" name="id" value={id} />
        <input name="name" required defaultValue={name} className="field" />
        <input name="description" defaultValue={description ?? ""} placeholder="What it is for (optional)" className="field" />
        <span className="flex gap-2">
          <button className="btn-primary py-1.5 text-xs" disabled={pending}>
            Save
          </button>
          <button type="button" className="btn-ghost py-1.5 text-xs" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </span>
        {state.error && <p className="text-sm text-red-700 sm:col-span-3">{state.error}</p>}
      </form>
    );
  }
  return (
    <div className="flex items-start gap-3">
      <div>
        <h2 className="font-semibold">{name}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      <button className="text-xs text-muted hover:text-ink" onClick={() => setEditing(true)}>
        Rename
      </button>
    </div>
  );
}

export function AddStepForm({ templateId, people }: { templateId: string; people: Person[] }) {
  const [state, action, pending] = useActionState(addStep, {});
  const ref = useResetOnOk(state.ok);
  return (
    <form ref={ref} action={action} className="space-y-2 border-t border-line p-4">
      <input type="hidden" name="template_id" value={templateId} />
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">Add a step</p>
      <StepFields people={people} />
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-ghost" disabled={pending}>
        {pending ? "Adding..." : "Add step"}
      </button>
    </form>
  );
}

export function StepControls({ id, first, last, onEdit }: { id: string; first: boolean; last: boolean; onEdit: () => void }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
      <button onClick={onEdit} className="hover:text-ink">
        Edit
      </button>
      <button disabled={pending || first} onClick={() => start(() => moveStep(id, -1))} className="hover:text-ink disabled:opacity-30" aria-label="Move up">
        ↑
      </button>
      <button disabled={pending || last} onClick={() => start(() => moveStep(id, 1))} className="hover:text-ink disabled:opacity-30" aria-label="Move down">
        ↓
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (confirm("Delete this step?")) start(() => deleteStep(id));
        }}
        className="hover:text-red-700"
      >
        Delete
      </button>
    </span>
  );
}

export function DeleteTemplate({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (confirm("Delete this checklist? Tickets already created stay.")) start(() => deleteTemplate(id));
      }}
      className="text-xs text-muted hover:text-red-700"
    >
      Delete checklist
    </button>
  );
}
