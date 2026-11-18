"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { PLATFORMS } from "@/lib/visibility";
import { addMedia, quoteFromAnswer, removeMedia, removeQuote, saveDesign, saveQuote, updateMedia } from "./design-actions";

export type DesignMedia = { id: string; kind: string; caption: string | null; url: string };
export type DesignQuote = { id: string; platform: string; prompt: string | null; quote: string; note: string | null; cited_urls: string[] };

const KIND_LABEL: Record<string, string> = {
  ai: "AI results (ProRankTracker)",
  gsc: "Search Console",
  pr: "Press release / distribution",
  other: "Other",
};

function Msg({ m }: { m: { ok?: string; error?: string } | null }) {
  if (!m) return null;
  return <p className={`text-xs ${m.error ? "text-red-700" : "text-green-d"}`}>{m.error ?? m.ok}</p>;
}

function QuoteRow({ reportId, q, readOnly }: { reportId: string; q: DesignQuote; readOnly: boolean }) {
  const [f, setF] = useState({ platform: q.platform, prompt: q.prompt ?? "", quote: q.quote, note: q.note ?? "", cited_urls: q.cited_urls.join("\n") });
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const set = (p: Partial<typeof f>) => {
    setF({ ...f, ...p });
    setDirty(true);
    setMsg(null);
  };
  return (
    <li className="space-y-2 rounded-lg border border-line p-3" data-quote>
      <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
        <select value={f.platform} disabled={readOnly} onChange={(e) => set({ platform: e.target.value })} className="field py-1.5 text-sm" aria-label="Platform">
          {PLATFORMS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input value={f.prompt} readOnly={readOnly} onChange={(e) => set({ prompt: e.target.value })} placeholder="The prompt it answered (optional)" className="field py-1.5 text-sm" />
      </div>
      <textarea value={f.quote} readOnly={readOnly} onChange={(e) => set({ quote: e.target.value })} rows={3} className="field text-sm" aria-label="Quote" />
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={f.note} readOnly={readOnly} onChange={(e) => set({ note: e.target.value })} placeholder="Line under the quote (optional)" className="field py-1.5 text-sm" />
        <textarea
          value={f.cited_urls}
          readOnly={readOnly}
          onChange={(e) => set({ cited_urls: e.target.value })}
          rows={1}
          placeholder="Client pages it cited, one per line"
          className="field py-1.5 font-mono text-xs"
          aria-label="Cited pages"
        />
      </div>
      {!readOnly && (
        <div className="flex items-center justify-end gap-3">
          <Msg m={msg} />
          <button className="text-xs text-muted hover:text-red-700" disabled={pending} onClick={() => start(async () => void (await removeQuote(reportId, q.id)))}>
            Remove
          </button>
          <button
            className="btn-primary py-1 text-xs"
            disabled={!dirty || pending}
            onClick={() =>
              start(async () => {
                const r = await saveQuote(reportId, q.id, f);
                setMsg(r.error ? { error: r.error } : { ok: "Saved." });
                if (!r.error) setDirty(false);
              })
            }
          >
            Save quote
          </button>
        </div>
      )}
    </li>
  );
}

export function DesignCard({
  reportId,
  readOnly,
  heroTitle,
  defaultTitle,
  gscDisplay,
  gscAuto,
  hasGsc,
  media,
  quotes,
  clientName,
}: {
  reportId: string;
  readOnly: boolean;
  heroTitle: string;
  defaultTitle: string;
  gscDisplay: string;
  gscAuto: boolean;
  hasGsc: boolean;
  media: DesignMedia[];
  quotes: DesignQuote[];
  clientName: string;
}) {
  const [title, setTitle] = useState(heroTitle);
  const [gsc, setGsc] = useState(gscDisplay);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);

  const [kind, setKind] = useState("ai");
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [upMsg, setUpMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const [platform, setPlatform] = useState("chatgpt");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [qMsg, setQMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pulling, startPull] = useTransition();

  const showing = gsc === "show" || (gsc === "auto" && gscAuto);

  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setUploading(true);
    setUpMsg(null);
    const supabase = createClient();
    try {
      for (const f of Array.from(list)) {
        if (!f.type.startsWith("image/")) throw new Error(`${f.name} isn't an image.`);
        if (f.size > 8 * 1024 * 1024) throw new Error(`${f.name} is over 8 MB.`);
        const ext = (f.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `reports/${reportId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("report-media").upload(path, f, { contentType: f.type });
        if (error) throw new Error(error.message);
        const r = await addMedia(reportId, path, kind, caption);
        if (r.error) throw new Error(r.error);
      }
      setCaption("");
      setUpMsg({ ok: "Added." });
    } catch (x) {
      setUpMsg({ error: (x as Error).message });
    } finally {
      setUploading(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <details className="card group/design" data-design>
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 group-open/design:border-b group-open/design:border-line">
        <span>
          <span className="font-semibold">Client report design</span>
          <span className="ml-2 text-xs text-muted">
            {heroTitle ? "Headline set" : "Default headline"} · {media.length} screenshot{media.length === 1 ? "" : "s"} · {quotes.length} AI quote{quotes.length === 1 ? "" : "s"}
          </span>
        </span>
        <span className="text-sm text-green-d">
          <span className="group-open/design:hidden">Show</span>
          <span className="hidden group-open/design:inline">Hide</span>
        </span>
      </summary>
      <div className="space-y-6 p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <div>
            <label className="label" htmlFor="hero_title">
              Headline
            </label>
            <input
              id="hero_title"
              value={title}
              readOnly={readOnly}
              onChange={(e) => {
                setTitle(e.target.value);
                setMsg(null);
              }}
              placeholder={defaultTitle}
              className="field"
            />
            <p className="mt-1 text-xs text-muted">
              Put *asterisks* around the words to show in the client&apos;s color, e.g. When AI gets asked who to call, *it says {clientName}.* Leave empty for the default.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="gsc_display">
              Search Console section
            </label>
            <select id="gsc_display" value={gsc} disabled={readOnly || !hasGsc} onChange={(e) => setGsc(e.target.value)} className="field">
              <option value="auto">Automatic (only when it&apos;s up)</option>
              <option value="show">Always show</option>
              <option value="hide">Hide</option>
            </select>
            <p className="mt-1 text-xs text-muted">
              {!hasGsc ? "No Search Console data for this month." : showing ? "Showing on the report." : "Hidden: clicks and impressions aren't up this month."}
            </p>
          </div>
        </div>
        {!readOnly && (
          <div className="flex items-center justify-end gap-3">
            <Msg m={msg} />
            <button
              className="btn-primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await saveDesign(reportId, { hero_title: title, gsc_display: gsc });
                  setMsg(r.error ? { error: r.error } : { ok: "Saved." });
                })
              }
            >
              Save headline and settings
            </button>
          </div>
        )}

        <details className="group/shots space-y-3 border-t border-line pt-5" open={media.length < 4}>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
            <span>
              Screenshots <span className="font-normal text-muted">({media.length})</span>
            </span>
            <span className="text-xs font-normal text-green-d">
              <span className="group-open/shots:hidden">Show</span>
              <span className="hidden group-open/shots:inline">Hide</span>
            </span>
          </summary>
          {media.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {media.map((m) => (
                <li key={m.id} className="overflow-hidden rounded-lg border border-line" data-media>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.caption ?? "Screenshot"} className="h-36 w-full bg-bg object-contain" />
                  <div className="space-y-1 p-2 text-xs">
                    <select
                      defaultValue={m.kind}
                      disabled={readOnly}
                      onChange={(e) => start(async () => void (await updateMedia(reportId, m.id, e.target.value, m.caption ?? "")))}
                      className="field py-1 text-xs"
                      aria-label="Section"
                    >
                      {Object.entries(KIND_LABEL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-muted">{m.caption ?? "No caption"}</span>
                      {!readOnly && (
                        <button className="shrink-0 text-muted hover:text-red-700" onClick={() => start(async () => void (await removeMedia(reportId, m.id)))}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!readOnly && (
            <div className="grid gap-2 rounded-lg bg-bg p-3 sm:grid-cols-[220px_1fr_auto]">
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="field" aria-label="Screenshot section">
                {Object.entries(KIND_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)" className="field" />
              <label className={`btn-ghost cursor-pointer ${uploading ? "opacity-50" : ""}`}>
                {uploading ? "Uploading..." : "Add screenshot"}
                <input ref={file} type="file" accept="image/*" multiple className="hidden" disabled={uploading} onChange={(e) => upload(e.target.files)} />
              </label>
              <div className="sm:col-span-3">
                <Msg m={upMsg} />
              </div>
            </div>
          )}
          <p className="text-xs text-muted">Search Console screenshots only show when the Search Console section does.</p>
        </details>

        <details className="group/quotes space-y-3 border-t border-line pt-5" open={quotes.length < 3}>
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold">
            <span>
              What AI said about {clientName} <span className="font-normal text-muted">({quotes.length})</span>
            </span>
            <span className="text-xs font-normal text-green-d">
              <span className="group-open/quotes:hidden">Show</span>
              <span className="hidden group-open/quotes:inline">Hide</span>
            </span>
          </summary>
          {quotes.length > 0 && (
            <ul className="space-y-3">
              {quotes.map((q) => (
                <QuoteRow key={q.id} reportId={reportId} q={q} readOnly={readOnly} />
              ))}
            </ul>
          )}
          {!readOnly && (
            <div className="space-y-2 rounded-lg bg-bg p-3">
              <p className="text-xs text-muted">
                Fastest: use the{" "}
                <a href="/capture" target="_blank" className="font-semibold text-green-d hover:underline">
                  ProRankTracker button
                </a>{" "}
                on a result pop-up. Or open a result in ProRankTracker, copy the AI&apos;s answer and paste it here. The exact words naming {clientName} become a quote, and any of the
                client&apos;s pages it cited are listed as proof. Check it before publishing.
              </p>
              <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
                <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="field" aria-label="Answer platform">
                  {PLATFORMS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="The prompt (optional)" className="field" aria-label="Answer prompt" />
              </div>
              <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={5} placeholder="Paste the AI answer from ProRankTracker" className="field text-sm" aria-label="AI answer" />
              <div className="flex flex-wrap items-center justify-end gap-3">
                <Msg m={qMsg} />
                <button
                  className="btn-ghost text-xs"
                  onClick={() => start(async () => void (await saveQuote(reportId, null, { platform, prompt, quote: "Type the quote here", note: "", cited_urls: "" })))}
                >
                  Add a quote by hand
                </button>
                <button
                  className="btn-green"
                  disabled={pulling || answer.trim().length < 20}
                  onClick={() =>
                    startPull(async () => {
                      const r = await quoteFromAnswer(reportId, platform, prompt, answer);
                      if (r.error) setQMsg({ error: r.error });
                      else {
                        setQMsg({ ok: r.by === "claude" ? "Quote added (picked by Claude). Check it below." : "Quote added. Check it below." });
                        setAnswer("");
                        setPrompt("");
                      }
                    })
                  }
                >
                  {pulling ? "Reading..." : "Pull the quote"}
                </button>
              </div>
            </div>
          )}
        </details>
      </div>
    </details>
  );
}
