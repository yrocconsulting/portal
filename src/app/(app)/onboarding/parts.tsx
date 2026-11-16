"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { addStep, createTemplate, deleteStep, deleteTemplate, moveStep } from "./actions";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/types";

function useResetOnOk(ok?: number) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (ok) ref.current?.reset();
  }, [ok]);
  return ref;
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

export function AddStepForm({ templateId }: { templateId: string }) {
  const [state, action, pending] = useActionState(addStep, {});
  const ref = useResetOnOk(state.ok);
  return (
    <form ref={ref} action={action} className="grid gap-2 border-t border-line p-4 sm:grid-cols-[2fr_100px_120px_auto]">
      <input type="hidden" name="template_id" value={templateId} />
      <input name="title" required placeholder="New step" className="field" />
      <input name="due_offset_days" type="number" min={0} max={365} defaultValue={7} className="field" title="Due this many days after onboarding starts" />
      <select name="priority" defaultValue="normal" className="field">
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
      <button className="btn-ghost" disabled={pending}>
        Add step
      </button>
      <textarea name="description" rows={2} placeholder="Instructions for whoever picks it up (optional)" className="field sm:col-span-4" />
      {state.error && <p className="text-sm text-red-700 sm:col-span-4">{state.error}</p>}
    </form>
  );
}

export function StepControls({ id, first, last }: { id: string; first: boolean; last: boolean }) {
  const [pending, start] = useTransition();
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
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
