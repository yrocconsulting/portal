-- Who looks after each client. Both optional and easy to change; anyone can still work any client.
alter table public.clients
  add column lead_id            uuid references public.staff (id) on delete set null,  -- does the fulfillment work
  add column account_manager_id uuid references public.staff (id) on delete set null;  -- client contact, sends reports
create index clients_lead_idx on public.clients (lead_id);
