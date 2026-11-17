"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { normName, readClientWorkbook, type ImportRecord } from "@/lib/import/clients-xlsx";
import { createClient } from "@/lib/supabase/server";

export type PreviewState = { records?: ImportRecord[]; existing?: Record<string, string>; error?: string };
export type CommitResult = { created: number; updated: number; contacts: number; warnings: string[]; error?: string };

/** Step 1: read the uploaded workbook and show what would change. Nothing is saved. */
export async function previewImport(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  await requireAdmin();
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose the .xlsx file first." };
  if (!/\.xlsx$/i.test(file.name)) return { error: "Download the sheet as Excel (.xlsx): File > Download > Microsoft Excel." };
  if (file.size > 9 * 1024 * 1024) return { error: "That file is over 9 MB." };
  try {
    const records = await readClientWorkbook(await file.arrayBuffer());
    if (!records.length) return { error: "No client tabs found in that file." };
    const supabase = await createClient();
    const { data: clients } = await supabase.from("clients").select("id, name, domain");
    const existing: Record<string, string> = {};
    for (const r of records) {
      const hit = (clients ?? []).find((c) => (r.domain && c.domain === r.domain) || normName(c.name) === normName(r.name));
      if (hit) existing[r.tab] = hit.name;
    }
    return { records, existing };
  } catch (e) {
    return { error: `Couldn't read that file: ${(e as Error).message}` };
  }
}

const s = (v: unknown, max = 2000): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Step 2: save the previewed records. Adds new clients and fills in existing ones (matched by domain or name). */
export async function commitImport(records: ImportRecord[]): Promise<CommitResult> {
  await requireAdmin();
  const out: CommitResult = { created: 0, updated: 0, contacts: 0, warnings: [] };
  if (!Array.isArray(records) || records.length > 500) return { ...out, error: "Nothing to import." };
  const supabase = await createClient();
  const { data: all } = await supabase.from("clients").select("id, name, domain, status, services, links");
  const clients = all ?? [];

  for (const raw of records) {
    const name = s(raw?.name, 200);
    if (!name) continue;
    const domain = s(raw.domain, 200)?.toLowerCase() ?? null;
    const existing = clients.find((c) => (domain && c.domain === domain) || normName(c.name) === normName(name));
    const domainTaken = !!domain && clients.some((c) => c.domain === domain && c.id !== existing?.id);
    if (domainTaken) out.warnings.push(`${name}: ${domain} is already used by another client, so the domain was left blank.`);

    const links: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.links ?? {})) {
      const url = s(v, 500);
      if (url && /^https?:\/\//i.test(url)) links[k] = url;
    }
    const fields: Record<string, unknown> = {
      white_label: !!raw.white_label,
      address: s(raw.address),
      industry: s(raw.industry, 200),
      package: s(raw.package),
      payment_method: s(raw.payment_method, 200),
      drive_url: s(raw.drive_url, 500),
      locations: s(raw.locations),
      website: s(raw.website, 500),
      phone: s(raw.phone, 50),
      start_date: /^\d{4}-\d{2}-\d{2}$/.test(raw.start_date ?? "") ? raw.start_date : null,
    };
    // Only overwrite with values the sheet actually has.
    for (const k of Object.keys(fields)) if (fields[k] === null) delete fields[k];
    if (domain && !domainTaken) fields.domain = domain;
    const services = Array.from(new Set([...((existing?.services as string[]) ?? []), ...(raw.services ?? []).filter((x) => typeof x === "string")]));

    let clientId: string;
    if (existing) {
      const status = raw.status === "former" ? "former" : existing.status === "former" ? "active" : existing.status;
      const { error } = await supabase
        .from("clients")
        .update({ ...fields, status, services, links: { ...((existing.links as Record<string, string>) ?? {}), ...links } })
        .eq("id", existing.id);
      if (error) {
        out.warnings.push(`${name}: ${error.message}`);
        continue;
      }
      clientId = existing.id;
      out.updated++;
    } else {
      const { data, error } = await supabase
        .from("clients")
        .insert({ name, ...fields, status: raw.status === "former" ? "former" : "active", services, links })
        .select("id, name, domain, status, services, links")
        .single();
      if (error) {
        out.warnings.push(`${name}: ${error.message}`);
        continue;
      }
      clients.push(data);
      clientId = data.id;
      out.created++;
    }

    // Primary contact: match by email, then by name; otherwise add one.
    const cName = s(raw.contact?.name, 200);
    const cEmail = s(raw.contact?.email, 200)?.toLowerCase() ?? null;
    const cPhone = s(raw.contact?.phone, 50);
    if (cName || cEmail) {
      const { data: contacts } = await supabase.from("contacts").select("id, name, email, is_primary").eq("client_id", clientId);
      const match = (contacts ?? []).find((c) => (cEmail && c.email === cEmail) || (cName && c.name.toLowerCase() === cName.toLowerCase()));
      const patch = { ...(cEmail ? { email: cEmail } : {}), ...(cPhone ? { phone: cPhone } : {}) };
      if (match) {
        if (Object.keys(patch).length) await supabase.from("contacts").update(patch).eq("id", match.id);
      } else {
        await supabase.from("contacts").insert({
          client_id: clientId,
          name: cName ?? cEmail!,
          ...patch,
          is_primary: !(contacts ?? []).some((c) => c.is_primary),
        });
        out.contacts++;
      }
    }
  }
  revalidatePath("/", "layout");
  return out;
}
