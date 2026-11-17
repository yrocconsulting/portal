import type { Metadata } from "next";
import { requireStaff, staffName } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AddStepForm, DeleteTemplate, NewTemplateForm, StepRow, TemplateHeader, type Step } from "./parts";

export const metadata: Metadata = { title: "Onboarding checklists" };

export default async function OnboardingPage() {
  await requireStaff();
  const supabase = await createClient();
  const [{ data: templates }, { data: staff }] = await Promise.all([
    supabase
      .from("onboarding_templates")
      .select("id, name, description, onboarding_steps(id, position, title, description, due_offset_days, priority, assign_to, assign_staff_id)")
      .order("name"),
    supabase.from("staff").select("id, full_name, email").eq("active", true).order("full_name"),
  ]);
  const people = (staff ?? []).map((s) => ({ id: s.id, name: staffName(s) }));

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Onboarding checklists</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Start one from a client&apos;s page. Each step becomes a ticket, due the set number of days after the start, and goes to the person set on the step
          (&quot;Client&apos;s lead&quot; and &quot;Account manager&quot; use whoever is set on that client). Click Edit on a step to change it.
        </p>
      </div>

      {(templates ?? []).map((t) => {
        const steps = ((t.onboarding_steps ?? []) as Step[]).sort((a, b) => a.position - b.position);
        return (
          <section key={t.id} className="card">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
              <TemplateHeader id={t.id} name={t.name} description={t.description} />
              <DeleteTemplate id={t.id} />
            </header>
            <ol className="divide-y divide-line">
              {steps.map((s, i) => (
                <StepRow key={s.id} step={s} index={i} first={i === 0} last={i === steps.length - 1} people={people} />
              ))}
              {!steps.length && <li className="px-4 py-3 text-sm text-muted">No steps yet.</li>}
            </ol>
            <AddStepForm templateId={t.id} people={people} />
          </section>
        );
      })}

      <NewTemplateForm />
    </div>
  );
}
