"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { decodeCapture, mentionsOf, platformKey, type Captured } from "@/lib/capture";
import { PLATFORMS } from "@/lib/visibility";
import { captureTargets, saveCapture } from "./actions";

type Targets = Awaited<ReturnType<typeof captureTargets>>;

function Setup({ code }: { code: string }) {
  const a = useRef<HTMLAnchorElement>(null);
  // React won't render javascript: links, so the bookmark's address is set directly.
  useEffect(() => {
    a.current?.setAttribute("href", code);
  }, [code]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">ProRankTracker button</h1>
      <p className="text-sm text-muted">
        A bookmark that sends an AI answer from ProRankTracker to the client&apos;s monthly report, so it can be used as a quote. It only reads the result you have open,
        when you click it. No ProRankTracker password is stored and nothing runs on its own.
      </p>
      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">Set it up once</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Show your bookmarks bar (Chrome or Edge: Ctrl+Shift+B, Mac: Cmd+Shift+B).</li>
          <li>
            Drag this button onto the bookmarks bar:{" "}
            <a ref={a} className="btn-green ml-1 inline-flex cursor-grab" onClick={(e) => e.preventDefault()} title="Drag me to your bookmarks bar">
              Send to Yroc Portal
            </a>
          </li>
        </ol>
        <h2 className="pt-2 font-semibold">Use it</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>In ProRankTracker, click a green check mark to open the result (the &ldquo;Appearances&rdquo; pop-up).</li>
          <li>Click &ldquo;Send to Yroc Portal&rdquo; in your bookmarks bar.</li>
          <li>A portal tab opens with the client and month filled in. Untick anything you don&apos;t want, then save.</li>
        </ol>
      </section>
    </div>
  );
}

export function Capture({ code }: { code: string }) {
  const [data, setData] = useState<Captured | null | "none">(null);
  const [targets, setTargets] = useState<Targets | null>(null);
  const [clientId, setClientId] = useState("");
  const [month, setMonth] = useState("");
  const [platform, setPlatform] = useState("");
  const [picked, setPicked] = useState<{ text: string; on: boolean }[]>([]);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; reportId?: string; added?: number } | null>(null);

  useEffect(() => {
    const d = location.hash.length > 1 ? decodeCapture(location.hash) : null;
    // Reading the address happens after mount on purpose (it's browser-only).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(d ?? "none");
    if (!d) return;
    setPlatform(platformKey(d.platform) ?? "");
    setPicked(mentionsOf(d).map((text) => ({ text, on: true })));
    captureTargets(d.prompt).then((t) => {
      setTargets(t);
      setClientId(t.suggested ?? "");
      setMonth(t.month);
    });
  }, []);

  if (data === null) return null;
  if (data === "none") return <Setup code={code} />;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="text-2xl font-bold">From ProRankTracker</h1>
      <section className="card space-y-4 p-5">
        <p className="text-sm">
          <span className="text-muted">Prompt:</span> <b>{data.prompt}</b>
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="cap_client">
              Client
            </label>
            <select id="cap_client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="field">
              <option value="">Choose a client</option>
              {(targets?.clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.white_label ? " (white label)" : ""}
                </option>
              ))}
            </select>
            {targets && !targets.suggested && <p className="mt-1 text-xs text-amber-700">Couldn&apos;t match the prompt to a client. Choose one.</p>}
          </div>
          <div>
            <label className="label" htmlFor="cap_month">
              Report month
            </label>
            <input id="cap_month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="field" />
          </div>
          <div>
            <label className="label" htmlFor="cap_platform">
              AI platform
            </label>
            <select id="cap_platform" value={platform} onChange={(e) => setPlatform(e.target.value)} className="field">
              <option value="">Choose</option>
              {PLATFORMS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <p className="label">Mentions to use as quotes</p>
          {picked.length ? (
            <ul className="space-y-2">
              {picked.map((p, i) => (
                <li key={i}>
                  <label className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
                    <input
                      type="checkbox"
                      checked={p.on}
                      onChange={(e) => setPicked(picked.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))}
                      className="mt-0.5 h-4 w-4 accent-green-d"
                    />
                    <span>{p.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-amber-700">No mentions found in that pop-up. Make sure a result was open when you clicked the button.</p>
          )}
        </div>
        {data.links.length > 0 && (
          <p className="text-xs text-muted">
            Links in the result: {data.links.length}. The client&apos;s own pages will show as &ldquo;cited&rdquo; on the report.
          </p>
        )}

        {msg?.error && <p className="text-sm text-red-700">{msg.error}</p>}
        {msg?.reportId ? (
          <p className="rounded-lg bg-green/10 p-3 text-sm text-green-d">
            {msg.added ? `Added ${msg.added} quote${msg.added === 1 ? "" : "s"}.` : "Those quotes were already on the report."}{" "}
            <Link href={`/reports/${msg.reportId}`} className="font-semibold underline">
              Open the monthly report
            </Link>{" "}
            to check them before publishing. You can close this tab.
          </p>
        ) : (
          <div className="flex justify-end">
            <button
              className="btn-green"
              disabled={pending || !clientId || !platform || !picked.some((p) => p.on)}
              onClick={() =>
                start(async () => {
                  setMsg(await saveCapture({ clientId, month, platform, prompt: data.prompt, quotes: picked.filter((p) => p.on).map((p) => p.text), links: data.links }));
                })
              }
            >
              {pending ? "Saving..." : "Add to the monthly report"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
