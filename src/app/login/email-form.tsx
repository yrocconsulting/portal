"use client";

import { useActionState } from "react";
import { signInWithEmail } from "./actions";

export function EmailForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInWithEmail, {});
  if (state.ok) {
    return <p className="rounded-lg bg-green/15 px-3 py-2 text-sm text-ink">Check your inbox for a sign in link.</p>;
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="next" value={next} />
      <input name="email" type="email" required placeholder="you@yrocconsulting.com" className="field" autoComplete="email" />
      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button className="btn-ghost w-full" disabled={pending}>
        {pending ? "Sending..." : "Email me a sign in link"}
      </button>
    </form>
  );
}
