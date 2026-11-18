"use client";

import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { saveBranding } from "./branding-actions";

/** The client's logo and brand color, used on their client-facing report. */
export function Branding({ clientId, logoUrl, color }: { clientId: string; logoUrl: string | null; color: string | null }) {
  const [hex, setHex] = useState(color ?? "");
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const valid = hex === "" || /^#[0-9a-f]{6}$/i.test(hex);

  async function upload(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      if (!f.type.startsWith("image/")) throw new Error("Choose an image file.");
      if (f.size > 4 * 1024 * 1024) throw new Error("The logo is over 4 MB.");
      const ext = (f.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `logos/${clientId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await createClient().storage.from("report-media").upload(path, f, { contentType: f.type });
      if (error) throw new Error(error.message);
      const r = await saveBranding(clientId, { logo_path: path });
      setMsg(r.error ? { error: r.error } : { ok: "Logo saved." });
    } catch (x) {
      setMsg({ error: (x as Error).message });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  }

  return (
    <section className="card p-4">
      <h2 className="mb-1 text-sm font-semibold">Report branding</h2>
      <p className="mb-3 text-xs text-muted">Shown on this client&apos;s monthly report. A transparent PNG or SVG logo works best.</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-40 items-center justify-center rounded-lg border border-line bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logoUrl ? <img src={logoUrl} alt="Client logo" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted">No logo</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`btn-ghost cursor-pointer py-1.5 text-xs ${busy ? "opacity-50" : ""}`}>
            {busy ? "Uploading..." : logoUrl ? "Replace logo" : "Upload logo"}
            <input ref={file} type="file" accept="image/*" className="hidden" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
          {logoUrl && (
            <button className="text-xs text-muted hover:text-red-700" disabled={pending} onClick={() => start(async () => void (await saveBranding(clientId, { logo_path: null })))}>
              Remove
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input type="color" value={valid && hex ? hex : "#3f8f1c"} onChange={(e) => setHex(e.target.value)} className="h-9 w-10 cursor-pointer rounded border border-line" aria-label="Brand color picker" />
          <input value={hex} onChange={(e) => setHex(e.target.value.trim())} placeholder="#c91f26" className="field w-28 py-1.5 font-mono text-xs" aria-label="Brand color" />
          <button
            className="btn-primary py-1.5 text-xs"
            disabled={!valid || pending}
            onClick={() =>
              start(async () => {
                const r = await saveBranding(clientId, { brand_color: hex || null });
                setMsg(r.error ? { error: r.error } : { ok: "Color saved." });
              })
            }
          >
            Save color
          </button>
        </div>
      </div>
      {msg && <p className={`mt-2 text-xs ${msg.error ? "text-red-700" : "text-green-d"}`}>{msg.error ?? msg.ok}</p>}
    </section>
  );
}
