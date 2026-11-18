"use client";

import { useTransition } from "react";
import { retryAngles } from "../actions";

export function RetryButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn-primary" disabled={pending} onClick={() => start(() => retryAngles(id))}>
      {pending ? "Starting..." : "Try again"}
    </button>
  );
}
