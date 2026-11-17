"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { commitImport, previewImport, type CommitResult } from "./actions";

export function ImportFlow() {
  const [state, action, reading] = useActionState(previewImport, {});
  const [saving, start] = useTransition();
  const [result, setResult] = useState<CommitResult | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());

  if (result) {
    return (
      <div className="card space-y-3 p-6">
        <h2 className="text-lg font-semibold">Import finished</h2>
        <p className="text-sm">
          {result.created} clients added, {result.updated} updated, {result.contacts} contacts added.
        </p>
        {result.error && <p className="text-sm text-red-700">{result.error}</p>}
        {result.warnings.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <Link href="/clients?status=all" className="btn-primary">
          View clients
        </Link>
      </div>
    );
  }

  const records = state.records ?? [];
  const chosen = records.filter((r) => !skip.has(r.tab));

  return (
    <div className="space-y-5">
      <form action={action} className="card flex flex-wrap items-center gap-3 p-4">
        <input name="file" type="file" accept=".xlsx" required className="field w-auto flex-1" />
        <button className="btn-primary" disabled={reading}>
          {reading ? "Reading..." : "Preview"}
        </button>
        {state.error && <p className="w-full text-sm text-red-700">{state.error}</p>}
      </form>

      {records.length > 0 && (
        <section className="card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h2 className="font-semibold">{records.length} clients found</h2>
              <p className="text-xs text-muted">Logins and passwords in the sheet were skipped. Untick any client you don&apos;t want to import.</p>
            </div>
            <button
              className="btn-green"
              disabled={saving || !chosen.length}
              onClick={() => start(async () => setResult(await commitImport(chosen)))}
            >
              {saving ? "Importing..." : `Import ${chosen.length} clients`}
            </button>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
                  <th className="px-4 py-2.5" />
                  <th className="px-4 py-2.5">Client</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Contact</th>
                  <th className="px-4 py-2.5">Website</th>
                  <th className="px-4 py-2.5">Services</th>
                  <th className="px-4 py-2.5">Will</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {records.map((r) => (
                  <tr key={r.tab} className={skip.has(r.tab) ? "opacity-40" : ""}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-green-d"
                        checked={!skip.has(r.tab)}
                        onChange={(e) => {
                          const next = new Set(skip);
                          if (e.target.checked) next.delete(r.tab);
                          else next.add(r.tab);
                          setSkip(next);
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {r.name}
                        {r.white_label && (
                          <span className="ml-2 rounded-full bg-ink px-2 py-0.5 text-[10px] font-bold tracking-wider text-green uppercase">White label</span>
                        )}
                      </p>
                      <p className="text-xs text-muted">{[r.industry, `tab: ${r.tab}`].filter(Boolean).join(" · ")}</p>
                      {r.warnings.map((w) => (
                        <p key={w} className="text-xs text-amber-700">
                          {w}
                        </p>
                      ))}
                    </td>
                    <td className="px-4 py-3">{r.status === "former" ? "Former" : "Active"}</td>
                    <td className="px-4 py-3 text-muted">
                      {r.contact.name}
                      {r.contact.email && <span className="block text-xs">{r.contact.email}</span>}
                    </td>
                    <td className="max-w-48 truncate px-4 py-3 text-muted">{r.domain}</td>
                    <td className="px-4 py-3 text-xs text-muted">{r.services.join(", ")}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      {state.existing?.[r.tab] ? <span className="text-steel">Update {state.existing[r.tab]}</span> : <span className="text-green-d">Add new</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
