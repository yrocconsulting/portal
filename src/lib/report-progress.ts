export type ProgressItem = { kind: string; status: string; count: number | null; target: number | null };

/** An item counts as done when ticked, or when a counted item reaches its target. N/A items are left out. */
export function itemDone(it: ProgressItem, actionsDone = 0): boolean {
  if (it.status === "done") return true;
  if (it.status === "na") return false;
  if (it.kind === "actions") return it.target !== null && actionsDone >= it.target;
  if (it.kind === "count") return it.target !== null && (it.count ?? 0) >= it.target;
  return false;
}

export function progress(items: ProgressItem[], actionsDone = 0): { done: number; total: number } {
  const applicable = items.filter((i) => i.status !== "na");
  return { done: applicable.filter((i) => itemDone(i, actionsDone)).length, total: applicable.length };
}
