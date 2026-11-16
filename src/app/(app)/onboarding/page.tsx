import type { Metadata } from "next";
import { PriorityBadge } from "@/components/badges";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { TicketPriority } from "@/lib/types";
import { AddStepForm, DeleteTemplate, NewTemplateForm, StepControls } from "./parts";

export const metadata: Metadata = { title: "Onboarding checklists" };

type Step = { id: string; position: number; title: string; description: string | null; due_offset_days: number; priority: TicketPriority };

export default async function OnboardingPage() {
  await requireStaff();
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("onboarding_templates")
    .select("id, name, description, onboarding_steps(id, position, title, description, due_offset_days, priority)")
    .order("name");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Onboarding checklists</h1>
        <p className="mt-1 text-sm text-muted">Start one from a client&apos;s page. Each step becomes a ticket, due the set number of days after the start.</p>
      </div>

      {(templates ?? []).map((t) => {
        const steps = ((t.onboarding_steps ?? []) as Step[]).sort((a, b) => a.position - b.position);
        return (
          <section key={t.id} className="card">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div>
                <h2 className="font-semibold">{t.name}</h2>
                {t.description && <p className="text-sm text-muted">{t.description}</p>}
              </div>
              <DeleteTemplate id={t.id} />
            </header>
            <ol className="divide-y divide-line">
              {steps.map((s, i) => (
                <li key={s.id} className="flex items-start justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      <span className="mr-2 font-mono text-xs text-muted">{i + 1}.</span>
                      {s.title}
                    </p>
                    {s.description && <p className="mt-0.5 text-sm text-muted">{s.description}</p>}
                    <p className="mt-1 flex items-center gap-3 text-xs text-muted">
                      <span>Due day {s.due_offset_days}</span>
                      <PriorityBadge priority={s.priority} />
                    </p>
                  </div>
                  <StepControls id={s.id} first={i === 0} last={i === steps.length - 1} />
                </li>
              ))}
              {!steps.length && <li className="px-4 py-3 text-sm text-muted">No steps yet.</li>}
            </ol>
            <AddStepForm templateId={t.id} />
          </section>
        );
      })}

      <NewTemplateForm />
    </div>
  );
}
