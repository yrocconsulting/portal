-- Claude-assisted writing: press releases, articles, service pages and FAQ content.
-- Flow: staff start a draft for a client, Claude suggests 3 angles from the client's tracked AI prompts,
-- Search Console queries and recent wins, a person picks one, Claude writes the piece (reading the
-- client's live website), and a person posts it to a ticket for review. Nothing is published or sent.

create table public.ai_drafts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  ticket_id   uuid references public.tickets (id) on delete set null,
  kind        text not null check (kind in ('press_release', 'article', 'service_page', 'faq')),
  status      text not null default 'angles_pending'
              check (status in ('angles_pending', 'angles_ready', 'draft_pending', 'draft_ready', 'posted', 'failed')),
  brief       text,                      -- the person's own direction
  angles      jsonb,                     -- Claude's three suggestions
  angle       jsonb,                     -- the one picked (possibly edited)
  title       text,
  body        text,                      -- the piece, Markdown
  notes       text,                      -- notes for the team: prompts targeted, facts to confirm, schema
  sources     text[] not null default '{}',  -- pages Claude read
  error       text,
  usage       jsonb not null default '{}',   -- tokens and estimated cost, per step
  created_by  uuid references public.staff (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index ai_drafts_client_idx on public.ai_drafts (client_id, created_at desc);

alter table public.ai_drafts enable row level security;
create policy ai_drafts_staff on public.ai_drafts for all to authenticated using (public.is_staff()) with check (public.is_staff());
create trigger ai_drafts_touch before update on public.ai_drafts for each row execute function public.touch_updated_at();

-- Staff can post a Claude draft to a ticket; it shows as Claude's, posted by them.
create policy comments_insert_claude on public.ticket_comments for insert to authenticated
  with check (public.is_staff() and author_kind = 'claude' and author_id = auth.uid());

-- House style for drafts, editable by admins (added to Claude's instructions).
create policy settings_staff_read_style on public.app_settings for select to authenticated
  using (public.is_staff() and key = 'draft_style');
create policy settings_admin_write_style on public.app_settings for all to authenticated
  using (public.is_admin() and key = 'draft_style') with check (public.is_admin() and key = 'draft_style');
