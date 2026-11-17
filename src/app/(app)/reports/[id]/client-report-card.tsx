"use client";

import { useState, useTransition } from "react";
import { publishClientReport, saveClientNote, unpublishClientReport } from "../actions";

export function ClientReportCard({
  origin,
  reportId,
  note: initialNote,
  token,
  publishedAt,
  publishedBy,
  views,
  lastViewed,
  whiteLabel,
  changedSincePublish,
}: {
  origin: string;
  reportId: string;
  note: string;
  token: string | null;
  publishedAt: string | null;
  publishedBy: string;
  views: number;
  lastViewed: string | null;
  whiteLabel: boolean;
  changedSincePublish: boolean;
}) {
  const [note, setNote] = useState(initialNote);
  const [noteDirty, setNoteDirty] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const url = token ? `${origin}/r/${token}` : null;
  const when = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const publish = () =>
    start(async () => {
      setMsg(null);
      if (noteDirty) {
        const s = await saveClientNote(reportId, note);
        if (s.error) return setMsg(s.error);
        setNoteDirty(false);
      }
      const r = await publishClientReport(reportId);
      setMsg(r.error ?? (token ? "Updated. The same link now shows the latest version." : "Published. Copy the link below and send it to the client."));
    });

  return (
    <section className="card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-semibold">Client report</h2>
        {token ? (
          <span className="rounded-full bg-green/15 px-2 py-0.5 text-xs font-medium text-green-d">Published</span>
        ) : (
          <span className="rounded-full bg-bg px-2 py-0.5 text-xs font-medium text-muted">Not shared</span>
        )}
      </header>
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted">
          A polished page for the client built from this record: wins as the headline, Google and AI results, completed work with links, and next month&apos;s plan.
          Internal notes, unfinished items and staff names are never included.
          {whiteLabel && <b className="text-ink"> White-label client: the report has no Yroc name or logo.</b>}
        </p>
        <div>
          <label className="label" htmlFor="client_note">
            Message to the client (optional)
          </label>
          <textarea
            id="client_note"
            rows={2}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteDirty(true);
            }}
            placeholder="A short personal note shown under the heading."
            className="field"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/reports/${reportId}/client`} target="_blank" className="btn-ghost" onClick={async () => noteDirty && (await saveClientNote(reportId, note))}>
            Preview
          </a>
          <button className="btn-green" disabled={pending} onClick={publish}>
            {pending ? "Publishing..." : token ? "Update published report" : "Publish and get link"}
          </button>
          {token && (
            <button
              className="btn-ghost text-red-700"
              disabled={pending}
              onClick={() => {
                if (confirm("Switch this link off? The client won't be able to open it. Publishing again creates a new link.")) start(() => unpublishClientReport(reportId));
              }}
            >
              Turn off link
            </button>
          )}
        </div>
        {msg && <p className="text-sm text-green-d">{msg}</p>}
        {token && url && (
          <div className="space-y-1 rounded-lg bg-bg p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input readOnly value={url} className="field flex-1 font-mono text-xs" onFocus={(e) => e.target.select()} />
              <button
                className="btn-primary py-1.5 text-xs"
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <a href={url} target="_blank" className="btn-ghost py-1.5 text-xs">
                Open
              </a>
            </div>
            <p className="text-xs text-muted">
              Published {publishedAt ? when(publishedAt) : ""}
              {publishedBy ? ` by ${publishedBy}` : ""} · opened {views} time{views === 1 ? "" : "s"}
              {lastViewed ? `, last ${when(lastViewed)}` : ""}
            </p>
            {changedSincePublish && <p className="text-xs text-amber-700">This record has changed since it was published. Click Update to show the latest version.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
