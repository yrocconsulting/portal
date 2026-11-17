"use client";

import { useActionState, useState } from "react";
import { createClientRecord, updateClientRecord } from "./actions";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, LINK_FIELDS, SERVICES, type Client } from "@/lib/types";

export function ClientForm({
  client,
  packages = [],
  staff = [],
  isAdmin = false,
}: {
  isAdmin?: boolean;
  client?: Client;
  packages?: { id: string; name: string }[];
  staff?: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(client ? updateClientRecord : createClientRecord, {});
  const [wl, setWl] = useState(client?.white_label ?? false);

  return (
    <form action={action} className="space-y-5">
      {client && <input type="hidden" name="id" value={client.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">
            Business name
          </label>
          <input id="name" name="name" required defaultValue={client?.name} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="domain">
            Domain
          </label>
          <input id="domain" name="domain" defaultValue={client?.domain ?? ""} placeholder="example.com" className="field" />
          <p className="mt-1 text-xs text-muted">Used to match forwarded emails and weekly AI visibility results.</p>
        </div>
        <div>
          <label className="label" htmlFor="tracking_domain">
            Tracked domain (if different)
          </label>
          <input id="tracking_domain" name="tracking_domain" defaultValue={client?.tracking_domain ?? ""} placeholder="Domain used in ProRankTracker" className="field" />
          <p className="mt-1 text-xs text-muted">Only needed when ProRankTracker tracks a different domain than the website.</p>
        </div>
        <div>
          <label className="label" htmlFor="status">
            Status
          </label>
          <select id="status" name="status" defaultValue={client?.status ?? "active"} className="field">
            {CLIENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CLIENT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="lead_id">
            Lead (fulfillment)
          </label>
          <select id="lead_id" name="lead_id" defaultValue={client?.lead_id ?? ""} className="field">
            <option value="">Nobody yet</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">New tickets for this client go to them by default.</p>
        </div>
        <div>
          <label className="label" htmlFor="account_manager_id">
            Account manager
          </label>
          <select id="account_manager_id" name="account_manager_id" defaultValue={client?.account_manager_id ?? ""} className="field">
            <option value="">Nobody yet</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="package_id">
            Package
          </label>
          <select id="package_id" name="package_id" defaultValue={client?.package_id ?? ""} className="field">
            <option value="">No package</option>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">Sets the deliverables on their monthly reports.</p>
        </div>
        <div>
          <label className="label" htmlFor="city">
            City
          </label>
          <input id="city" name="city" defaultValue={client?.city ?? ""} placeholder="Sherman, TX" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Phone
          </label>
          <input id="phone" name="phone" defaultValue={client?.phone ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="website">
            Website
          </label>
          <input id="website" name="website" type="url" defaultValue={client?.website ?? ""} placeholder="https://" className="field" />
        </div>
        <div>
          <label className="label" htmlFor="industry">
            Industry
          </label>
          <input id="industry" name="industry" defaultValue={client?.industry ?? ""} className="field" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="address">
            Address
          </label>
          <input id="address" name="address" defaultValue={client?.address ?? ""} className="field" />
        </div>
        {isAdmin && (
          <div>
            <label className="label" htmlFor="monthly_fee">
              Monthly fee ($)
            </label>
            <input
              id="monthly_fee"
              name="monthly_fee"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              defaultValue={client?.monthly_fee ?? ""}
              placeholder="e.g. 3000"
              className="field"
            />
            {client?.package && <p className="mt-1 text-xs text-muted">From the client sheet: {client.package}</p>}
          </div>
        )}
        <div>
          <label className="label" htmlFor="payment_method">
            Payment method
          </label>
          <input id="payment_method" name="payment_method" defaultValue={client?.payment_method ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="start_date">
            Start date
          </label>
          <input id="start_date" name="start_date" type="date" defaultValue={client?.start_date ?? ""} className="field" />
        </div>
        <div>
          <label className="label" htmlFor="drive_url">
            Google Drive folder
          </label>
          <input id="drive_url" name="drive_url" type="url" defaultValue={client?.drive_url ?? ""} placeholder="https://drive.google.com/..." className="field" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="locations">
            Locations
          </label>
          <textarea id="locations" name="locations" rows={2} defaultValue={client?.locations ?? ""} placeholder="One per line" className="field" />
        </div>
      </div>

      <fieldset>
        <legend className="label">Online profiles</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {LINK_FIELDS.map(([k, label]) => (
            <input key={k} name={`link_${k}`} type="url" defaultValue={client?.links?.[k] ?? ""} placeholder={`${label} link`} className="field" />
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-line p-4">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="white_label" checked={wl} onChange={(e) => setWl(e.target.checked)} className="mt-0.5 h-4 w-4 accent-ink" />
          <span>
            <span className="font-semibold">White-label client</span>
            <span className="block text-muted">Served through an agency partner. Never named on the website or used as a case study.</span>
          </span>
        </label>
        {wl && (
          <div className="mt-3">
            <label className="label" htmlFor="partner">
              Agency partner
            </label>
            <input id="partner" name="partner" defaultValue={client?.partner ?? ""} className="field" />
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="label">Services</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {SERVICES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="services" value={s} defaultChecked={client?.services.includes(s)} className="h-4 w-4 accent-green-d" />
              {s}
            </label>
          ))}
        </div>
      </fieldset>

      {!client && (
        <fieldset className="rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Primary contact (optional)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="contact_name" placeholder="Name" className="field" />
            <input name="contact_title" placeholder="Title" className="field" />
            <input name="contact_email" type="email" placeholder="Email" className="field" />
            <input name="contact_phone" placeholder="Phone" className="field" />
          </div>
        </fieldset>
      )}

      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea id="notes" name="notes" rows={4} defaultValue={client?.notes ?? ""} className="field" />
      </div>

      {state.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state.ok && <p className="text-sm text-green-d">Saved.</p>}
      <div className="flex justify-end">
        <button className="btn-green" disabled={pending}>
          {pending ? "Saving..." : client ? "Save changes" : "Create client"}
        </button>
      </div>
    </form>
  );
}
